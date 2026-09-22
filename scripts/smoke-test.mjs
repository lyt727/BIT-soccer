// 绿茵BIT V2 接口冒烟测试：node scripts/smoke-test.mjs
// 前置：服务已启动，演示库已初始化（手机号验证码登录）

const BASE = process.env.API_BASE || 'http://localhost:3000';
const results = [];

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  -> ${extra}` : ''}`);
}

async function login(phone) {
  const sent = await call('POST', '/api/auth/send-code', { body: { phone, scene: 'login' } });
  const code = sent.data?.demoCode;
  if (!code) return { status: sent.status, data: null };
  const logged = await call('POST', '/api/auth/login-code', { body: { phone, code } });
  return { status: logged.status, data: logged.data };
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

const health = await call('GET', '/api/health');
check('健康检查', health.status === 200);

const adminLogin = await login('13900000001');
const adminToken = adminLogin.data?.token;
check('管理员手机号验证码登录', adminLogin.status === 200 && Boolean(adminToken),
  `role=${adminLogin.data?.user?.role}`);

// ---- 账号体系：手机号 + 姓名 + 密码 ----
const pwdLogin = await call('POST', '/api/auth/login-password',
  { body: { phone: '13900000001', password: '123456' } });
check('手机号 + 密码登录', pwdLogin.status === 200 && Boolean(pwdLogin.data?.token));
check('登录响应不含密码散列', !JSON.stringify(pwdLogin.data || {}).includes('password_hash'));
const pwdWrong = await call('POST', '/api/auth/login-password',
  { body: { phone: '13900000001', password: 'definitely-wrong' } });
check('错误密码被拒绝(401)', pwdWrong.status === 401);
const pwdNoUser = await call('POST', '/api/auth/login-password',
  { body: { phone: '13000000000', password: 'whatever' } });
check('未注册号码不泄露号码是否存在',
  pwdNoUser.status === 401 && pwdNoUser.data?.error === pwdWrong.data?.error);

const newAccount = await call('POST', '/api/admin/users', {
  token: adminToken,
  body: { phone: '13900000777', name: '测试录入员', role: 'data_operator' },
});
check('管理员新建账号并返回初始密码',
  newAccount.status === 201 && typeof newAccount.data?.password === 'string'
  && newAccount.data.password.length >= 6);
const newAccountLogin = await call('POST', '/api/auth/login-password',
  { body: { phone: '13900000777', password: newAccount.data?.password } });
check('新建账号可用初始密码登录', newAccountLogin.status === 200,
  `role=${newAccountLogin.data?.user?.role}`);
const resetPwd = await call('PATCH', `/api/admin/users/${newAccount.data?.id}`,
  { token: adminToken, body: { password: 'reset-by-admin' } });
check('管理员重置成员密码', resetPwd.status === 200);
const resetLogin = await call('POST', '/api/auth/login-password',
  { body: { phone: '13900000777', password: 'reset-by-admin' } });
check('重置后新密码生效', resetLogin.status === 200);
const weakPwd = await call('POST', '/api/auth/register',
  { body: { phone: '13900000666', name: '弱密码', password: '123' } });
check('注册密码不足 6 位被拒绝', weakPwd.status === 400);

const events = await call('GET', '/api/events', { token: adminToken });
check('赛事列表含演示赛事', events.status === 200 && events.data?.length >= 2);

const pending = await call('GET', '/api/events/evt_demo2/registrations?status=pending', { token: adminToken });
check('读取待审核整队报名', pending.status === 200 && pending.data?.[0]?.memberCount >= 2,
  `pending=${pending.data?.length} members=${pending.data?.[0]?.memberCount}`);

const reviewId = pending.data?.[0]?.id;
const adminJoin = await call('POST', `/api/registrations/${reviewId}/join`, {
  token: adminToken,
  body: {
    name: '张伟',
    roles: ['manager'],
    jerseyNo: '',
    file: { originalName: '张伟学生卡.jpg', dataUrl: PNG },
  },
});
check('管理员可加入任意球队', adminJoin.status === 201, adminJoin.data?.message);
if (adminJoin.status === 201) {
  const adminCancel = await call('DELETE', `/api/registrations/${reviewId}/me`, {
    token: adminToken,
  });
  check('管理员可取消报名', adminCancel.status === 200, adminCancel.data?.message);
}
const approve = await call('POST', `/api/registrations/${reviewId}/review`,
  { token: adminToken, body: { action: 'approve' } });
check('管理员审核通过报名', approve.status === 200 && approve.data?.status === 'approved');

const playerLogin = await login('13800138002');
const playerToken = playerLogin.data?.token;
check('参赛球员验证码登录', playerLogin.status === 200 && Boolean(playerToken),
  `role=${playerLogin.data?.user?.role}`);

const publicRegs = await call('GET', '/api/events/evt_demo2/registrations', { token: playerToken });
const joinTarget = publicRegs.data?.find((r) => r.status === 'pending');
check('未审核球队对球员可见', publicRegs.status === 200 && Boolean(joinTarget));
if (joinTarget) {
  const joinPhone = '13900000009';
  const joinCode = (await call('POST', '/api/auth/send-code',
    { body: { phone: joinPhone, scene: 'register' } })).data?.demoCode;
  const joinReg = await call('POST', '/api/auth/register',
    { body: { phone: joinPhone, name: '测试球员', password: 'test-1234', code: joinCode } });
  const joinToken = joinReg.data?.token;
  const joined = await call('POST', `/api/registrations/${joinTarget.id}/join`, {
    token: joinToken,
    body: {
      name: '刘洋',
      roles: ['player'],
      jerseyNo: '10',
      file: { originalName: '刘洋学生卡.jpg', dataUrl: PNG },
    },
  });
  check('球员可加入任意球队', joined.status === 201, joined.data?.message);
  const selfCard = await call('PATCH', `/api/registrations/${joinTarget.id}/me`, {
    token: joinToken,
    body: {
      name: '刘洋',
      jerseyNo: '10',
      file: { originalName: '刘洋学生卡.jpg', dataUrl: PNG },
    },
  });
  check('队员单独完善本人信息', selfCard.status === 200);
  const cancel = await call('DELETE', `/api/registrations/${joinTarget.id}/me`, {
    token: joinToken,
  });
  check('球员可取消报名', cancel.status === 200, cancel.data?.message);
}

const denied = await call('POST', `/api/registrations/${reviewId}/review`,
  { token: playerToken, body: { action: 'approve' } });
check('参赛球员审核被拒绝(403)', denied.status === 403);

const playerCreate = await call('POST', '/api/admin/users', {
  token: playerToken,
  body: { phone: '13900000555', name: '越权建号', role: 'admin' },
});
check('参赛球员新建账号被拒绝(403)', playerCreate.status === 403);

const aiDenied = await call('POST', '/api/ai/recognize',
  { token: playerToken, body: { eventId: 'evt_demo1', images: [{ dataUrl: PNG }] } });
check('参赛球员调用 AI 识图被拒绝(403)', aiDenied.status === 403);

const noteDenied = await call('PATCH', '/api/matches/mt_evt1_gA3/note',
  { token: playerToken, body: { specialNote: '球员无权修改' } });
check('参赛球员修改特殊情况被拒绝(403)', noteDenied.status === 403);
const staffDenied = await call('PATCH', '/api/matches/mt_evt1_gA3/staff',
  { token: playerToken, body: { matchStaff: { supervisor: '球员无权修改' } } });
check('参赛球员修改比赛工作人员被拒绝(403)', staffDenied.status === 403);

const opLogin = await login('13900000003');
const opToken = opLogin.data?.token;
check('数据录入员验证码登录', opLogin.status === 200 && Boolean(opToken));
check('权限包含关系（球员能力 ⊆ 数据录入员）',
  ['registration.submit', 'stats.view', 'match.view', 'result.record', 'ai.recognize']
    .every((p) => opLogin.data?.user?.permissions?.includes(p)));

const koCreate = await call('POST', '/api/events/evt_demo1/matches', {
  token: opToken,
  body: {
    stage: 'knockout',
    knockoutRound: '半决赛',
    teamAId: 'reg_e1_1',
    teamBId: 'reg_e1_3',
    date: '2026-10-01',
    time: '19:00',
    venue: '西操场 1 号场',
    referee: '赵明',
    assistant1: '钱进',
    assistant2: '孙立',
    fourthOfficial: '周舟',
  },
});
check('数据录入员可添加淘汰赛并选择轮次',
  koCreate.status === 201 && koCreate.data?.stage === 'knockout'
  && koCreate.data?.knockoutRound === '半决赛');
if (koCreate.status === 201) {
  const del = await call('DELETE', `/api/matches/${koCreate.data.id}`, { token: opToken });
  check('数据录入员可删除淘汰赛', del.status === 200);
}
const groupDenied = await call('POST', '/api/events/evt_demo1/matches', {
  token: opToken,
  body: {
    stage: 'group',
    groupName: 'A',
    teamAId: 'reg_e1_1',
    teamBId: 'reg_e1_3',
    date: '2026-10-02',
    time: '19:00',
    venue: '西操场 1 号场',
    referee: '赵明',
    assistant1: '钱进',
    assistant2: '孙立',
    fourthOfficial: '周舟',
  },
});
check('数据录入员添加小组赛被拒绝(403)', groupDenied.status === 403);

const minimalMatch = await call('POST', '/api/events/evt_demo1/matches', {
  token: adminToken,
  body: {
    stage: 'group',
    groupName: 'C',
    teamAId: 'reg_e1_1',
    teamBId: 'reg_e1_2',
  },
});
check('仅必填项（阶段/轮次/主客队）可创建比赛',
  minimalMatch.status === 201 && minimalMatch.data?.groupName === 'C');
if (minimalMatch.status === 201) {
  await call('DELETE', `/api/matches/${minimalMatch.data.id}`, { token: adminToken });
}

const noteOk = await call('PATCH', '/api/matches/mt_evt1_gA3/note',
  { token: opToken, body: { specialNote: '数据录入员补充：双方按规则换边' } });
check('数据录入员可编辑特殊情况说明', noteOk.status === 200
  && noteOk.data?.specialNote === '数据录入员补充：双方按规则换边');
const staffOk = await call('PATCH', '/api/matches/mt_evt1_gA3/staff', {
  token: opToken,
  body: {
    matchStaff: {
      supervisor: '刘建国',
      photographer: '陈摄影',
      videographer: '王摄像',
      commentator: '李解说',
      reporter: '赵战报',
    },
  },
});
check('数据录入员可填写比赛工作人员', staffOk.status === 200
  && staffOk.data?.matchStaff?.supervisor === '刘建国'
  && staffOk.data?.matchStaff?.reporter === '赵战报');
const staffStats = await call('GET', '/api/events/evt_demo1/staff-stats', { token: opToken });
check('赛事工作人员统计（裁判+其他角色）',
  staffStats.status === 200
  && staffStats.data?.referees?.some((r) => r.role === '主裁判' && r.name)
  && staffStats.data?.staff?.some((r) => r.role === '比赛监督' && r.matches >= 1));

// ---- 红黄牌榜与停赛台账 ----
const cardStats = await call('GET', '/api/events/evt_demo1/card-stats', { token: playerToken });
check('球员可读红黄牌榜', cardStats.status === 200
  && cardStats.data?.reds?.length >= 1 && cardStats.data?.yellows?.length >= 1,
  `红牌 ${cardStats.data?.reds?.length} 黄牌 ${cardStats.data?.yellows?.length}`);
check('红牌榜含停赛状态', cardStats.data?.reds?.some((r) => r.status === 'pending'));
check('红牌榜状态不存在空白（二选一）',
  cardStats.data?.reds?.every((r) => r.statusLabel === '下一轮停赛' || r.statusLabel === '已执行停赛'),
  `状态：${[...new Set((cardStats.data?.reds || []).map((r) => r.statusLabel))].join('/')}`);
check('红牌榜只含有红牌的球员', cardStats.data?.reds?.every((r) => r.redCards > 0));
const servedRow = cardStats.data?.yellows?.find((y) => y.status === 'served');
check('累计黄牌按清零值扣减', Boolean(servedRow)
  && servedRow.currentYellows < servedRow.totalYellows,
  `总=${servedRow?.totalYellows} 累计=${servedRow?.currentYellows}`);
check('停赛台账返回完整字段', Array.isArray(cardStats.data?.suspensions)
  && cardStats.data.suspensions.every((s) => s.statusLabel && s.reasonLabel));

const suspDenied = await call('POST', '/api/events/evt_demo1/suspensions',
  { token: opToken, body: { registrationId: 'reg_e1_1', player: '测试', reason: 'red_card' } });
check('数据录入员登记停赛被拒绝(403)', suspDenied.status === 403);

const theTeam = (await call('GET', '/api/events/evt_demo1/registrations', { token: adminToken }))
  .data.find((t) => t.id === 'reg_e1_1');
const suspMember = (theTeam?.members || []).find((m) => m.roles.includes('player'));
const suspNew = await call('POST', '/api/events/evt_demo1/suspensions', {
  token: adminToken,
  body: {
    registrationId: 'reg_e1_1', player: suspMember?.name,
    playerNo: suspMember?.jerseyNo, reason: 'yellow_accumulation', note: '冒烟测试',
  },
});
check('管理员登记停赛', suspNew.status === 201, suspNew.data?.error || '');
const beforeServe = (await call('GET', '/api/events/evt_demo1/card-stats', { token: adminToken }))
  .data.yellows.find((y) => y.player === suspMember?.name);
const served = await call('PATCH', `/api/suspensions/${suspNew.data?.id}`,
  { token: adminToken, body: { status: 'served' } });
check('标记已完成停赛并清零累计黄牌',
  served.status === 200 && served.data?.clearedYellow === (beforeServe?.currentYellows ?? 0),
  `清零=${served.data?.clearedYellow}`);
const afterServe = (await call('GET', '/api/events/evt_demo1/card-stats', { token: adminToken }))
  .data.yellows.find((y) => y.player === suspMember?.name);
check('清零后累计黄牌归零、总黄牌不变',
  afterServe?.currentYellows === 0
  && afterServe?.totalYellows === beforeServe?.totalYellows,
  `累计=${afterServe?.currentYellows} 总=${afterServe?.totalYellows}`);
const suspDel = await call('DELETE', `/api/suspensions/${suspNew.data?.id}`, { token: adminToken });
check('删除停赛记录', suspDel.status === 200);

// 累计黄牌门槛（管理员可设定，只影响榜单说明）
const thrSet = await call('PATCH', '/api/events/evt_demo1',
  { token: adminToken, body: { yellowThreshold: 3 } });
const thrRead = await call('GET', '/api/events/evt_demo1/card-stats', { token: adminToken });
check('管理员可设定累计黄牌门槛',
  thrSet.status === 200 && thrRead.data?.yellowThreshold === 3,
  `yellowThreshold=${thrRead.data?.yellowThreshold}`);
const thrBad = await call('PATCH', '/api/events/evt_demo1',
  { token: adminToken, body: { yellowThreshold: 99 } });
check('门槛非法值被拒绝(400)', thrBad.status === 400, thrBad.data?.error);
const thrDenied = await call('PATCH', '/api/events/evt_demo1',
  { token: opToken, body: { yellowThreshold: 4 } });
check('数据录入员修改门槛被拒绝(403)', thrDenied.status === 403);
await call('PATCH', '/api/events/evt_demo1',
  { token: adminToken, body: { yellowThreshold: 2 } });
check('多张牌演示数据（至少一人累计 2 张以上）',
  cardStats.data?.yellows?.some((y) => y.totalYellows >= 2)
  && cardStats.data?.reds?.some((r) => r.redCards >= 2));

// 红牌状态二选一（按球员直接设置）
const redRow = cardStats.data.reds[0];
const setServed = await call('POST', '/api/events/evt_demo1/suspensions/status', {
  token: adminToken,
  body: {
    registrationId: redRow.registrationId, player: redRow.player,
    playerNo: redRow.playerNo, reason: 'red_card', status: 'served',
  },
});
check('管理员可把红牌状态改为已执行停赛', setServed.status === 200);
const redAfter = (await call('GET', '/api/events/evt_demo1/card-stats', { token: adminToken }))
  .data.reds.find((r) => r.player === redRow.player);
check('改后红牌状态为已执行停赛', redAfter?.status === 'served'
  && redAfter?.statusLabel === '已执行停赛');
const setBack = await call('POST', '/api/events/evt_demo1/suspensions/status', {
  token: adminToken,
  body: {
    registrationId: redRow.registrationId, player: redRow.player,
    playerNo: redRow.playerNo, reason: 'red_card', status: 'pending',
  },
});
check('管理员可改回下一轮停赛', setBack.status === 200);
const statusDenied = await call('POST', '/api/events/evt_demo1/suspensions/status', {
  token: opToken,
  body: { registrationId: redRow.registrationId, player: redRow.player, reason: 'red_card', status: 'served' },
});
check('数据录入员改红牌状态被拒绝(403)', statusDenied.status === 403);

// 黄牌状态三选一（不填 / 下一轮停赛 / 已执行停赛）
const yellowRow = (await call('GET', '/api/events/evt_demo1/card-stats', { token: adminToken }))
  .data.yellows.find((y) => y.totalYellows > 0);
check('黄牌榜行数据带球队ID（供下拉设置状态）', Boolean(yellowRow?.registrationId));
const ySet = await call('POST', '/api/events/evt_demo1/suspensions/status', {
  token: adminToken,
  body: {
    registrationId: yellowRow.registrationId, player: yellowRow.player,
    playerNo: yellowRow.playerNo, reason: 'yellow_accumulation', status: 'pending',
  },
});
check('管理员可把黄牌状态设为下一轮停赛', ySet.status === 200);
const yAfter = (await call('GET', '/api/events/evt_demo1/card-stats', { token: adminToken }))
  .data.yellows.find((y) => y.player === yellowRow.player);
check('黄牌状态已更新为下一轮停赛',
  yAfter?.status === 'pending' && yAfter?.statusLabel === '下一轮停赛');
const yClear = await call('POST', '/api/events/evt_demo1/suspensions/status', {
  token: adminToken,
  body: {
    registrationId: yellowRow.registrationId, player: yellowRow.player,
    reason: 'yellow_accumulation', status: '',
  },
});
check('黄牌状态可清空（选“不填”）', yClear.status === 200);
const yAfter2 = (await call('GET', '/api/events/evt_demo1/card-stats', { token: adminToken }))
  .data.yellows.find((y) => y.player === yellowRow.player);
check('清空后黄牌状态为空', !yAfter2?.status && !yAfter2?.statusLabel);
check('榜单按 球队 → 球员 → 号码 排序',
  (() => {
    const list = cardStats.data.yellows.map((y) => `${y.teamName}|${y.player}`);
    const sorted = [...list].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    return JSON.stringify(list) === JSON.stringify(sorted);
  })());

// 停赛场次（管理员手动选数字）
check('红牌榜行数据含停赛场次',
  cardStats.data.reds.every((r) => Number.isInteger(r.matches) && r.matches >= 1),
  `场次：${[...new Set(cardStats.data.reds.map((r) => r.matches))].sort().join('/')}`);
check('停赛名单含停赛场次',
  cardStats.data.suspensions.every((s) => Number.isInteger(s.matches) && s.matches >= 1));
// 用最新一次读取的榜单，避免用到前面测试改过的旧状态
const freshReds = (await call('GET', '/api/events/evt_demo1/card-stats', { token: adminToken })).data.reds;
const mRow = freshReds.find((r) => r.status === 'served') || freshReds[0];
const mSet = await call('POST', '/api/events/evt_demo1/suspensions/status', {
  token: adminToken,
  body: {
    registrationId: mRow.registrationId, player: mRow.player,
    playerNo: mRow.playerNo, reason: 'red_card', matches: 3,
  },
});
check('管理员可调整停赛场次', mSet.status === 200 && mSet.data?.matches === 3);
const mAfter = (await call('GET', '/api/events/evt_demo1/card-stats', { token: adminToken }))
  .data.reds.find((r) => r.player === mRow.player);
check('调整场次后状态保持不变',
  mAfter?.matches === 3 && mAfter?.status === mRow.status,
  `场次=${mAfter?.matches} 状态=${mAfter?.statusLabel}`);
const mBad = await call('POST', '/api/events/evt_demo1/suspensions/status', {
  token: adminToken,
  body: {
    registrationId: mRow.registrationId, player: mRow.player,
    reason: 'red_card', matches: 99,
  },
});
check('停赛场次非法值被拒绝(400)', mBad.status === 400, mBad.data?.error);

// 停赛类型「其他原因」+ 备注非必填
const otherSusp = await call('POST', '/api/events/evt_demo1/suspensions', {
  token: adminToken,
  body: { registrationId: 'reg_e1_1', player: '王建国', reason: 'other', matches: 2 },
});
check('可登记「其他原因」停赛且备注非必填',
  otherSusp.status === 201, otherSusp.data?.error || '');
const otherRow = (await call('GET', '/api/events/evt_demo1/card-stats', { token: adminToken }))
  .data.suspensions.find((s) => s.id === otherSusp.data?.id);
check('其他原因停赛按场次与类型展示',
  otherRow?.reason === 'other' && otherRow?.reasonLabel === '其他原因'
  && otherRow?.matches === 2 && otherRow?.note === '');
await call('DELETE', `/api/suspensions/${otherSusp.data?.id}`, { token: adminToken });

const result = await call('POST', '/api/matches/mt_evt1_gA3/result', {
  token: opToken,
  body: {
    scoreA: 2, scoreB: 1,
    goalsA: [{ player: '赵磊', time: "11'" }, { player: '', time: '' }],
    goalsB: [{ player: '孙浩', time: "66'", penalty: true }],
    refereeList: ['赵明', '周舟'],
    substitutions: [{ team: '自动化学院一队', offPlayer: '高远', onPlayer: '赵磊', time: "60'" }],
    cards: [{ team: '材料学院一队', player: '何强', type: 'yellow', time: "44'" }],
    source: 'manual',
  },
});
check('数据录入员录比赛结果', result.status === 200 && result.data?.status === 'finished');

const standings = await call('GET', '/api/events/evt_demo1/standings', { token: playerToken });
check('球员只读积分榜', standings.status === 200 && standings.data?.length > 0);
const grouped = await call('GET', '/api/events/evt_demo1/standings-by-group', { token: playerToken });
check('积分榜按小组分别排名',
  grouped.status === 200 && grouped.data?.length === 4
  && grouped.data.some((g) => g.groupName === 'A' && g.rows.length === 4)
  && grouped.data.some((g) => g.groupName === 'D' && g.rows.length === 3));

const scorers = await call('GET', '/api/events/evt_demo1/scorers', { token: playerToken });
check('射手榜含新进球', scorers.status === 200
  && scorers.data?.some((s) => s.player === '赵磊' && s.goals === 1));

// 整队报名：3 名成员，每人学生卡照片
const submit = await call('POST', '/api/events/evt_demo2/registrations', {
  token: adminToken,
  body: {
    teamName: '睿信书院联队',
    jerseyTop: '红白',
    jerseyShorts: '黑',
    jerseySocks: '白',
    members: [
      { name: '陈晨', phone: '13900000101', roles: ['manager'], jerseyNo: '', file: { originalName: '陈晨学生卡.jpg', dataUrl: PNG } },
      { name: '赵磊', phone: '13900000102', roles: ['player'], jerseyNo: '10', file: { originalName: '赵磊学生卡.jpg', dataUrl: PNG } },
      { name: '孙浩', phone: '13900000103', roles: ['player'], jerseyNo: '11', file: { originalName: '孙浩学生卡.jpg', dataUrl: PNG } },
    ],
  },
});
check('整队报名（每名成员学生卡）', submit.status === 201 && submit.data?.memberCount === 3,
  submit.data?.message);

const editRes = await call('PATCH', `/api/registrations/${submit.data.id}`, {
  token: adminToken,
  body: {
    teamName: '睿信书院联队',
    jerseyTop: '红白',
    jerseyShorts: '黑',
    jerseySocks: '白',
    members: [
      { name: '陈晨', phone: '13900000101', roles: ['manager'], jerseyNo: '', file: { originalName: '陈晨学生卡.jpg', dataUrl: PNG } },
      { name: '赵磊', phone: '13900000102', roles: ['player'], jerseyNo: '10', file: { originalName: '赵磊学生卡.jpg', dataUrl: PNG } },
      { name: '孙浩', phone: '13900000103', roles: ['player'], jerseyNo: '11', file: { originalName: '孙浩学生卡.jpg', dataUrl: PNG } },
      { name: '罗毅', phone: '13900000104', roles: ['player'], jerseyNo: '12', file: { originalName: '罗毅学生卡.jpg', dataUrl: PNG } },
    ],
  },
});
check('报名中可编辑队员名单', editRes.status === 200 && editRes.data?.memberCount === 4);

// 管理员切到进行中后，名单锁定不可编辑
await call('PATCH', '/api/events/evt_demo2/status', { token: adminToken, body: { status: 'live' } });
const lockEdit = await call('PATCH', `/api/registrations/${submit.data.id}`, {
  token: adminToken,
  body: {
    teamName: '睿信书院联队',
    jerseyTop: '红白',
    jerseyShorts: '黑',
    jerseySocks: '白',
    members: [
      { name: '陈晨', phone: '13900000101', roles: ['manager'], jerseyNo: '', file: { originalName: 'a.jpg', dataUrl: PNG } },
      { name: '赵磊', phone: '13900000102', roles: ['player'], jerseyNo: '10', file: { originalName: 'b.jpg', dataUrl: PNG } },
    ],
  },
});
check('开赛后名单锁定(REG_LOCKED)', lockEdit.status === 400 && lockEdit.data?.code === 'REG_LOCKED');
await call('PATCH', '/api/events/evt_demo2/status', { token: adminToken, body: { status: 'signup' } });

// 报名结束后不可修改/新增：进行中赛事拒绝新报名
const locked = await call('POST', '/api/events/evt_demo1/registrations', {
  token: playerToken,
  body: {
    teamName: '睿信书院联队',
    members: [
      { name: '刘洋', phone: '13800138002', file: { originalName: 'a.jpg', dataUrl: PNG } },
      { name: '王强', phone: '13800138001', file: { originalName: 'b.jpg', dataUrl: PNG } },
    ],
  },
});
check('进行中赛事报名被锁定(400)', locked.status === 400 && locked.data?.code === 'REG_LOCKED',
  locked.data?.error);

const ai = await call('POST', '/api/ai/recognize', {
  token: opToken,
  body: {
    eventId: 'evt_demo1',
    images: [
      { name: '裁判报告-示例.jpg', dataUrl: PNG },
      { name: '比分照片-补充.jpg', dataUrl: PNG },
    ],
  },
});
check('AI 识图返回结构化结果', ai.status === 200 && ai.data?.confidence?.overall > 0.8);
check('AI 建议回填比赛', Boolean(ai.data?.suggestedMatchId));
check('AI 识别完整裁判报告（名单/号码/颜色）',
  ai.data?.match?.lineups?.A?.starting?.length > 0
  && ai.data?.match?.lineups?.A?.starting?.[0]?.no
  && ai.data?.match?.kitColorA);

// AI 结果一键回填：名单/颜色与时间轴事件全部落库
const aim = ai.data?.match;
if (aim && ai.data?.suggestedMatchId) {
  const goalsA = (aim.goals || []).filter((g) => g.side === 'A');
  const goalsB = (aim.goals || []).filter((g) => g.side === 'B');
  const applied = await call('POST', `/api/matches/${ai.data.suggestedMatchId}/result`, {
    token: opToken,
    body: {
      scoreA: aim.scoreA,
      scoreB: aim.scoreB,
      goalsA: goalsA.map((g) => ({ no: g.no, player: g.player, time: g.time, penalty: g.penalty })),
      goalsB: goalsB.map((g) => ({ no: g.no, player: g.player, time: g.time, penalty: g.penalty })),
      substitutions: aim.substitutions,
      cards: aim.cards,
      refereeRoles: aim.referees,
      lineupA: {
        color: aim.kitColorA,
        starting: aim.lineups.A.starting,
        substitutes: aim.lineups.A.substitutes,
      },
      lineupB: {
        color: aim.kitColorB,
        starting: aim.lineups.B.starting,
        substitutes: aim.lineups.B.substitutes,
      },
      source: 'ai',
    },
  });
  check('AI 名单/颜色/时间轴落库', applied.status === 200
    && applied.data?.lineups?.A?.starting?.length > 0
    && applied.data?.lineups?.A?.color
    && applied.data?.timeline?.some((t) => t.type === 'goal' && t.no));
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n共 ${results.length} 项，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
