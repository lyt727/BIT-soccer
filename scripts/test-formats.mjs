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
const koDraw = await call('POST', `/api/events/${ko.id}/draw`, { token: adminToken, body: {} });
ok('纯淘汰赛没有抽签（提示手动添加对阵）', koDraw.status === 400, koDraw.data?.error);

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

console.log(`\n共 ${pass + fail} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
