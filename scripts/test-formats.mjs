// 赛制功能产品测试：单循环联赛 / 小组赛+淘汰赛 / 纯淘汰赛
// 用法：先启动服务，再执行 node scripts/test-formats.mjs
const BASE = process.env.API_BASE || 'http://localhost:3000';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
let pass = 0; let fail = 0;

function ok(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`PASS  ${name}${extra ? `  ${extra}` : ''}`); }
  else { fail += 1; console.log(`FAIL  ${name}${extra ? `  ${extra}` : ''}`); }
}

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

const admin = (await call('POST', '/api/auth/login-password',
  { body: { phone: '13900000001', password: '123456' } })).data;
const adminToken = admin.token;
const stamp = String(Date.now()).slice(-6);

// 建一个赛事并把 N 支球队报名、审核、切到进行中
async function setupEvent(name, format, teamCount) {
  const created = await call('POST', '/api/events', {
    token: adminToken,
    body: { name: `${name}${stamp}`, season: '2026', description: '赛制产品测试', format },
  });
  const id = created.data?.id;
  await call('PATCH', `/api/events/${id}/status`, { token: adminToken, body: { status: 'signup' } });
  for (let i = 1; i <= teamCount; i += 1) {
    const phoneA = `139${stamp}${String(i).padStart(2, '0')}`;
    const phoneB = `139${stamp}${String(i + 50).padStart(2, '0')}`;
    const reg = await call('POST', `/api/events/${id}/registrations`, {
      token: adminToken,
      body: {
        teamName: `测试队${i}号`,
        jerseyTop: '红', jerseyShorts: '黑', jerseySocks: '白',
        members: [
          {
            name: `领队${i}`,
            phone: phoneA,
            roles: ['manager'],
            jerseyNo: '',
            file: { originalName: `领队${i}学生卡.jpg`, dataUrl: PNG },
          },
          {
            name: `球员${i}`,
            phone: phoneB,
            roles: ['player'],
            jerseyNo: '7',
            file: { originalName: `球员${i}学生卡.jpg`, dataUrl: PNG },
          },
        ],
      },
    });
    const regId = reg.data?.id;
    if (regId) {
      await call('POST', `/api/registrations/${regId}/review`,
        { token: adminToken, body: { action: 'approve' } });
    } else {
      console.log(`    （报名失败：${reg.data?.error || reg.status}）`);
    }
  }
  await call('PATCH', `/api/events/${id}/status`, { token: adminToken, body: { status: 'live' } });
  return { id, created };
}

// ============ 一、单循环联赛 ============
console.log('\n【一、单循环联赛】');
const league = await setupEvent('单循环联赛', 'league', 5);
ok('创建赛事时保存赛制为 league', league.created.data?.format === 'league',
  `format=${league.created.data?.format}`);

const draw = await call('POST', `/api/events/${league.id}/draw`, { token: adminToken, body: {} });
ok('单循环抽签生成全部对阵（5 队 → 10 场 / 5 轮）',
  draw.status === 200 && draw.data?.matchCount === 10 && draw.data?.rounds === 5,
  `${draw.data?.message || draw.data?.error}`);

const matches = (await call('GET', `/api/events/${league.id}/matches`, { token: adminToken })).data;
if (!matches?.length) {
  console.log('    （联赛对阵为空，后续用例跳过）');
}
ok('每两队恰好交手一次',
  matches?.length === 10
  && new Set(matches.map((m) => [m.teamA.name, m.teamB.name].sort().join('|'))).size === 10);
const roundNames = [...new Set((matches || []).map((m) => m.roundName))];
ok('对阵已分配到轮次', roundNames.length === 5
  && roundNames.every((r) => /^第\d+轮$/.test(r)), roundNames.join('/'));
ok('每轮场次分布均衡（5 队时每轮 2 场）',
  roundNames.every((r) => matches.filter((m) => m.roundName === r).length === 2));

const first = matches[0];
const result = await call('POST', `/api/matches/${first.id}/result`, {
  token: adminToken,
  body: { scoreA: 1, scoreB: 0, goalsA: [{ player: first.teamA.name, time: "10'" }], goalsB: [] },
});
ok('联赛比赛可正常录入结果', result.status === 200, result.data?.error || '');

const standings = await call('GET', `/api/events/${league.id}/standings`, { token: adminToken });
ok('联赛积分榜是一张总表（5 支球队）',
  standings.status === 200 && standings.data?.length === 5,
  `条数=${standings.data?.length}`);
ok('积分榜按胜 3 平 1 负 0 计算',
  standings.data?.some((r) => r.points === 3 && r.win === 1));

const redraw = await call('POST', `/api/events/${league.id}/draw`,
  { token: adminToken, body: { replace: true } });
ok('已有比赛结果时拒绝重新编排', redraw.status === 400, redraw.data?.error);
const changeFormat = await call('PATCH', `/api/events/${league.id}`,
  { token: adminToken, body: { format: 'knockout' } });
ok('已有赛程时拒绝修改赛制', changeFormat.status === 400, changeFormat.data?.error);

// ============ 二、纯淘汰赛 ============
console.log('\n【二、纯淘汰赛】');
const ko = await setupEvent('纯淘汰赛', 'knockout', 4);
ok('创建赛事时保存赛制为 knockout', ko.created.data?.format === 'knockout');
// 纯淘汰赛也能抽签：随机配对生成首轮对阵（奇数球队时一支轮空）
const ko2 = await setupEvent('淘汰赛抽签', 'knockout', 5);
const ko2Draw = await call('POST', `/api/events/${ko2.id}/draw`, { token: adminToken, body: {} });
ok('纯淘汰赛可抽签生成首轮对阵',
  ko2Draw.status === 200 && ko2Draw.data?.matchCount === 2,
  ko2Draw.data?.message || ko2Draw.data?.error);
ok('奇数球队时有一支轮空', Boolean(ko2Draw.data?.byeTeam), `轮空：${ko2Draw.data?.byeTeam}`);
const ko2Matches = (await call('GET', `/api/events/${ko2.id}/matches`, { token: adminToken })).data;
ok('抽签生成的是淘汰赛场次且带轮次',
  ko2Matches.length === 2
  && ko2Matches.every((m) => m.stage === 'knockout' && m.knockoutRound === '半决赛'));

const koTeams = (await call('GET', `/api/events/${ko.id}/registrations`, { token: adminToken })).data;
const semi = await call('POST', `/api/events/${ko.id}/matches`, {
  token: adminToken,
  body: {
    stage: 'knockout', knockoutRound: '半决赛',
    teamAId: koTeams[0].id, teamBId: koTeams[1].id,
  },
});
ok('可添加淘汰赛场次', semi.status === 201, semi.data?.error || '');
ok('淘汰赛场次记录轮次与赛制一致',
  semi.data?.knockoutRound === '半决赛' && semi.data?.stage === 'knockout');

const third = await call('POST', `/api/events/${ko.id}/matches`, {
  token: adminToken,
  body: {
    stage: 'knockout', knockoutRound: '三四名决赛',
    teamAId: koTeams[2].id, teamBId: koTeams[3].id,
  },
});
ok('新增的三四名决赛轮次可用', third.status === 201 && third.data?.knockoutRound === '三四名决赛',
  third.data?.error || '');

const custom = await call('POST', `/api/events/${ko.id}/matches`, {
  token: adminToken,
  body: {
    stage: 'knockout', knockoutRound: '八强附加赛',
    teamAId: koTeams[0].id, teamBId: koTeams[2].id,
  },
});
ok('自定义轮次名称可用', custom.status === 201 && custom.data?.knockoutRound === '八强附加赛',
  custom.data?.error || '');
ok('纯淘汰赛不产生积分榜（接口返回空数组）',
  ((await call('GET', `/api/events/${ko.id}/standings`, { token: adminToken })).data || []).length === 0);

// ============ 三、小组赛 + 淘汰赛（回归） ============
console.log('\n【三、小组赛 + 淘汰赛（原有流程回归）】');
const gk = await setupEvent('小组赛淘汰赛', 'group_knockout', 8);
ok('创建赛事时保存赛制为 group_knockout', gk.created.data?.format === 'group_knockout');
const gkDraw = await call('POST', `/api/events/${gk.id}/draw`,
  { token: adminToken, body: { groupCount: 2 } });
ok('分组抽签仍正常（8 队分 2 组）',
  gkDraw.status === 200 && gkDraw.data?.groups?.length === 2,
  gkDraw.data?.message || gkDraw.data?.error);
ok('每组 4 支球队', gkDraw.data?.groups?.every((g) => g.teams.length === 4));
const gkTeams = (await call('GET', `/api/events/${gk.id}/registrations`, { token: adminToken })).data;
const groupMatch = await call('POST', `/api/events/${gk.id}/matches`, {
  token: adminToken,
  body: { stage: 'group', groupName: 'A', teamAId: gkTeams[0].id, teamBId: gkTeams[1].id },
});
ok('小组赛场次仍可添加', groupMatch.status === 201, groupMatch.data?.error || '');
const noGroup = await call('POST', `/api/events/${gk.id}/matches`, {
  token: adminToken,
  body: { stage: 'group', teamAId: gkTeams[0].id, teamBId: gkTeams[1].id },
});
ok('小组赛未选小组时仍被拒绝', noGroup.status === 400, noGroup.data?.error);
const gkStandings = await call('GET', `/api/events/${gk.id}/standings-by-group`, { token: adminToken });
ok('分组积分榜仍按小组返回', gkStandings.data?.length === 2);

// ============ 四、抽签范围 / 手动排赛 / 比赛编辑权限 ============
console.log('\n【四、抽签范围、手动排赛与比赛编辑权限】');
{
  const created = await call('POST', '/api/events', {
    token: adminToken,
    body: { name: `抽签范围${stamp}`, season: '2026', format: 'group_knockout' },
  });
  const eid = created.data.id;
  await call('PATCH', `/api/events/${eid}/status`, { token: adminToken, body: { status: 'signup' } });
  const regIds = [];
  for (let i = 1; i <= 3; i += 1) {
    const reg = await call('POST', `/api/events/${eid}/registrations`, {
      token: adminToken,
      body: {
        teamName: `范围队${i}号`,
        jerseyTop: '红', jerseyShorts: '黑', jerseySocks: '白',
        members: [
          { name: `领队${i}`, phone: `138${stamp}${String(i).padStart(2, '0')}`,
            roles: ['manager'], jerseyNo: '', file: { originalName: 'a.jpg', dataUrl: PNG } },
          { name: `球员${i}`, phone: `138${stamp}${String(i + 50).padStart(2, '0')}`,
            roles: ['player'], jerseyNo: '7', file: { originalName: 'b.jpg', dataUrl: PNG } },
        ],
      },
    });
    regIds.push(reg.data?.id);
    // 只审核通过前两支，第三支保持待审核
    if (i <= 2 && reg.data?.id) {
      await call('POST', `/api/registrations/${reg.data.id}/review`,
        { token: adminToken, body: { action: 'approve' } });
    }
  }
  await call('PATCH', `/api/events/${eid}/status`, { token: adminToken, body: { status: 'live' } });

  const d = await call('POST', `/api/events/${eid}/draw`,
    { token: adminToken, body: { groupCount: 2 } });
  const drawn = (d.data?.groups || []).flatMap((g) => g.teams.map((t) => t.teamName));
  ok('抽签只覆盖审核通过的球队（未通过的被排除）',
    drawn.length === 2 && !drawn.includes('范围队3号'),
    `抽签结果：${drawn.join('、') || d.data?.error}`);

  const manual = await call('POST', `/api/events/${eid}/matches`, {
    token: adminToken,
    body: { stage: 'group', groupName: 'A', teamAId: regIds[0], teamBId: regIds[1] },
  });
  ok('不抽签也能手动添加赛程', manual.status === 201, manual.data?.error || '');

  // 把数据录入员指派到该赛事
  await call('POST', `/api/events/${eid}/staff`,
    { token: adminToken, body: { phone: '13900000003', eventRole: 'data_operator' } });
  const opTok = (await call('POST', '/api/auth/login-password',
    { body: { phone: '13900000003', password: '123456' } })).data.token;
  const pTok = (await call('POST', '/api/auth/login-password',
    { body: { phone: '13800138001', password: '123456' } })).data.token;

  const edited = await call('PATCH', `/api/matches/${manual.data?.id}`,
    { token: opTok, body: { venue: '西操场 2 号场', referee: '赵明' } });
  ok('数据录入员可编辑比赛信息', edited.status === 200, edited.data?.error || '');
  ok('编辑比赛时不必填日期时间等选填项',
    edited.status === 200 && edited.data?.venue === '西操场 2 号场');

  const playerDenied = await call('PATCH', `/api/matches/${manual.data?.id}`,
    { token: pTok, body: { venue: '越权修改' } });
  ok('参赛球员编辑比赛被拒绝(403)', playerDenied.status === 403, `status=${playerDenied.status}`);
  const playerDel = await call('DELETE', `/api/matches/${manual.data?.id}`, { token: pTok });
  ok('参赛球员删除比赛被拒绝(403)', playerDel.status === 403);

  const delByOp = await call('DELETE', `/api/matches/${manual.data?.id}`, { token: opTok });
  ok('数据录入员可删除比赛', delByOp.status === 200, delByOp.data?.error || '');
}

// ============ 五、赛事状态与比赛增改 ============
console.log('\n【五、赛事状态与比赛增改】');
{
  const opTok = (await call('POST', '/api/auth/login-password',
    { body: { phone: '13900000003', password: '123456' } })).data.token;

  // 报名中的演示赛事：不能手动添加比赛
  const signupAdd = await call('POST', '/api/events/evt_demo2/matches', {
    token: adminToken,
    body: { stage: 'group', groupName: 'A', teamAId: 'reg_e2_1', teamBId: 'reg_e2_2' },
  });
  ok('报名中状态不能手动添加比赛', signupAdd.status === 400, signupAdd.data?.error || '');
  // 报名中同样不能抽签
  const signupDraw = await call('POST', '/api/events/evt_demo2/draw',
    { token: adminToken, body: { groupCount: 2 } });
  ok('报名中状态不能抽签', signupDraw.status === 400, signupDraw.data?.error || '');

  // 进行中：可以编辑单场比赛信息
  const liveMatch = (await call('GET', '/api/events/evt_demo1/matches', { token: adminToken })).data[0];
  const liveEdit = await call('PATCH', `/api/matches/${liveMatch.id}`,
    { token: adminToken, body: { venue: '西操场 1 号场' } });
  ok('进行中状态可以编辑比赛信息', liveEdit.status === 200, liveEdit.data?.error || '');

  // 已结束：管理员与数据录入员都仍可编辑
  await call('PATCH', '/api/events/evt_demo1/status',
    { token: adminToken, body: { status: 'ended' } });
  const endedEditOp = await call('PATCH', `/api/matches/${liveMatch.id}`,
    { token: opTok, body: { venue: '西操场 2 号场' } });
  ok('已结束状态数据录入员仍可编辑比赛信息',
    endedEditOp.status === 200, endedEditOp.data?.error || '');
  const endedAdd = await call('POST', '/api/events/evt_demo1/matches', {
    token: adminToken,
    body: { stage: 'group', groupName: 'A', teamAId: 'reg_e1_1', teamBId: 'reg_e1_2' },
  });
  ok('已结束状态不能添加比赛', endedAdd.status === 400, endedAdd.data?.error || '');
  await call('PATCH', '/api/events/evt_demo1/status',
    { token: adminToken, body: { status: 'live' } });
  const backLive = await call('GET', '/api/events/evt_demo1', { token: adminToken });
  ok('演示赛事状态已还原为进行中', backLive.data?.status === 'live');
}

console.log(`\n共 ${pass + fail} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
