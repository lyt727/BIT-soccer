// 统一比赛编辑界面接口测试：node scripts/test-match-editor.mjs
// 前置：服务已启动（演示库已初始化）。覆盖
//   ① 比赛信息 + 比赛数据 + 工作人员 一次提交、一个事务
//   ② 比分留空 = 未开赛（撤销赛果），填写比分 = 已完赛
//   ③ 权限：管理员 / 数据录入员可改，参赛球员只读
//   ④ 赛事结束后只有管理员可以更正
// 测试结束会把被改动的比赛与赛事状态还原，不会污染演示数据。

const BASE = process.env.API_BASE || 'http://localhost:3000';
let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}${extra ? `  ${extra}` : ''}`); } else {
    fail += 1; console.log(`FAIL  ${name}${extra ? `  -> ${extra}` : ''}`);
  }
};

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

async function loginPassword(phone) {
  const r = await call('POST', '/api/auth/login-password',
    { body: { phone, password: '123456' } });
  return r.data?.token;
}

console.log('【统一比赛编辑界面】');

const adminToken = await loginPassword('13900000001');
const opToken = await loginPassword('13900000003');
const playerToken = await loginPassword('13800138001');
ok('三个角色都能登录', Boolean(adminToken && opToken && playerToken));

// 把数据录入员指派到演示赛事 evt_demo1
await call('POST', '/api/events/evt_demo1/staff',
  { token: adminToken, body: { phone: '13900000003', eventRole: 'data_operator' } });
await call('PATCH', '/api/events/evt_demo1/status',
  { token: adminToken, body: { status: 'live' } });

const matches = (await call('GET', '/api/events/evt_demo1/matches', { token: adminToken })).data;
const target = matches.find((m) => m.status === 'scheduled');
ok('找到一场未开赛比赛用于测试', Boolean(target), target?.id || '');

const base = {
  teamAId: target.teamA.registrationId,
  teamBId: target.teamB.registrationId,
  date: target.date,
  time: target.time,
  venue: '测试场地 9 号场',
  referee: '测试主裁',
  assistant1: '测试一助',
  assistant2: '测试二助',
  fourthOfficial: '测试第四官员',
  specialNote: '统一编辑界面接口测试',
  matchStaff: {
    supervisor: '测试监督', photographer: '拍照同学', videographer: '录像同学',
    commentator: '解说同学', reporter: '战报同学',
  },
  lineupA: { color: '红白', starting: ['1 甲一', '7 甲七'], substitutes: ['12 甲十二'] },
  lineupB: { color: '蓝黑', starting: ['1 乙一'], substitutes: ['9 乙九'] },
};

// ---- ① 只保存比赛信息：不写赛果，比赛仍为未开赛 ----
const infoOnly = await call('PATCH', `/api/matches/${target.id}/full`,
  { token: opToken, body: { ...base, scoreA: '', scoreB: '' } });
ok('数据录入员可保存统一编辑表单(200)', infoOnly.status === 200, infoOnly.data?.error || '');
ok('只保存信息时不写入赛果', infoOnly.data?.status === 'scheduled', `status=${infoOnly.data?.status}`);
ok('场地与裁判组已更新',
  infoOnly.data?.venue === '测试场地 9 号场' && infoOnly.data?.assistant2 === '测试二助');
ok('特殊情况说明已更新', infoOnly.data?.specialNote === '统一编辑界面接口测试');
ok('工作人员一次保存成功',
  infoOnly.data?.matchStaff?.photographer === '拍照同学'
  && infoOnly.data?.matchStaff?.reporter === '战报同学');
ok('双方名单与球衣颜色已保存',
  infoOnly.data?.lineups?.A?.starting?.length === 2
  && infoOnly.data?.lineups?.B?.color === '蓝黑');

// ---- ② 保存赛果：比分 + 进球 + 换人 + 红黄牌，一次提交 ----
const withResult = await call('PATCH', `/api/matches/${target.id}/full`,
  {
    token: opToken,
    body: {
      ...base,
      scoreA: 2,
      scoreB: 1,
      goalsA: [
        { no: '7', player: '甲七', time: "23'", penalty: false },
        { no: '9', player: '甲九', time: "58'", penalty: true },
      ],
      goalsB: [{ no: '10', player: '乙十', time: "41'", penalty: false }],
      substitutions: [{
        team: target.teamA.name, offNo: '7', offPlayer: '甲七',
        onNo: '12', onPlayer: '甲十二', time: "46'",
      }],
      cards: [
        { team: target.teamB.name, player: '乙三', no: '3', type: 'yellow', time: "33'" },
        { team: target.teamB.name, player: '乙五', no: '5', type: 'red', time: "70'" },
      ],
      source: 'manual',
    },
  });
ok('一次提交即可写入比赛数据(200)', withResult.status === 200, withResult.data?.error || '');
ok('比赛被标记为已完赛', withResult.data?.status === 'finished', `status=${withResult.data?.status}`);
ok('比分正确', withResult.data?.scoreA === 2 && withResult.data?.scoreB === 1);
ok('三个进球全部落库', withResult.data?.goals?.length === 3);
ok('点球标记保留',
  withResult.data?.goals?.some((g) => g.player === '甲九' && Number(g.is_penalty) === 1));
ok('换人记录落库', withResult.data?.substitutions?.length === 1);
ok('红黄牌记录落库', withResult.data?.cards?.length === 2);
ok('时间轴由赛果自动生成', (withResult.data?.timeline?.length || 0) === 6,
  `timeline=${withResult.data?.timeline?.length}`);
ok('红牌自动登记停赛',
  (await call('GET', '/api/events/evt_demo1/card-stats', { token: adminToken }))
    .data?.suspensions?.some((s) => s.player === '乙五'));

// ---- ③ 权限：参赛球员只读 ----
const playerDenied = await call('PATCH', `/api/matches/${target.id}/full`,
  { token: playerToken, body: { ...base, venue: '越权修改' } });
ok('参赛球员提交统一编辑表单被拒绝(403)', playerDenied.status === 403, `status=${playerDenied.status}`);

// ---- ④ 赛事结束后只有管理员可以更正 ----
await call('PATCH', '/api/events/evt_demo1/status',
  { token: adminToken, body: { status: 'ended' } });
const endedByOp = await call('PATCH', `/api/matches/${target.id}/full`,
  { token: opToken, body: { ...base, venue: '赛后越权' } });
ok('已结束赛事数据录入员被拒绝(400)', endedByOp.status === 400, endedByOp.data?.error || '');
const endedByAdmin = await call('PATCH', `/api/matches/${target.id}/full`,
  { token: adminToken, body: { ...base, venue: '管理员赛后更正' } });
ok('已结束赛事管理员仍可更正(200)', endedByAdmin.status === 200, endedByAdmin.data?.error || '');
ok('管理员更正后比赛数据保持不变',
  endedByAdmin.data?.scoreA === 2 && endedByAdmin.data?.goals?.length === 3);
const endedDelete = await call('DELETE', `/api/matches/${target.id}`, { token: opToken });
ok('已结束赛事数据录入员不能删除比赛(400)', endedDelete.status === 400, endedDelete.data?.error || '');

// ---- 还原：撤销赛果 + 还原赛事状态 ----
const reset = await call('PATCH', `/api/matches/${target.id}/full`,
  { token: adminToken, body: { ...base, venue: target.venue, scoreA: '', scoreB: '' } });
ok('比分留空可撤销赛果并回到未开赛',
  reset.data?.status === 'scheduled' && (reset.data?.goals?.length || 0) === 0
  && (reset.data?.cards?.length || 0) === 0);
await call('PATCH', '/api/events/evt_demo1/status',
  { token: adminToken, body: { status: 'live' } });
const backLive = await call('GET', '/api/events/evt_demo1', { token: adminToken });
ok('演示赛事状态已还原为进行中', backLive.data?.status === 'live');

console.log(`\n共 ${pass + fail} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
