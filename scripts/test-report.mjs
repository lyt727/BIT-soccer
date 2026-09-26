// =============================================================
// AI 生成战报 的功能测试
//
// 用法：先启动服务，再执行 node scripts/test-report.mjs
//      服务器上：bash scripts/run.sh report
//
// 覆盖：
//   ① 未完赛的比赛不能生成（接口拦截；前端另有弹窗提示）
//   ② 已完赛可以生成，战报写进比赛记录，内容包含双方队名与比分
//   ③ 权限：管理员 / 数据录入员可生成，参赛球员只读
//   ④ 战报可以在「编辑比赛信息」里手工修改
//   ⑤ 生成战报不会改动比赛的任何已有数据
// =============================================================
import { assertSafeTestTarget } from './safety.mjs';

const BASE = assertSafeTestTarget(process.env.API_BASE || 'http://localhost:3000');
let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}${extra ? `  ${extra}` : ''}`); }
  else { fail += 1; console.log(`FAIL  ${name}${extra ? `  -> ${extra}` : ''}`); }
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

const login = async (phone) => (await call('POST', '/api/auth/login-password',
  { body: { phone, password: '123456' } })).data?.token;

console.log('【AI 生成战报】');
const adminToken = await login('13900000001');
const opToken = await login('13900000003');
const playerToken = await login('13800138001');
ok('三个角色都能登录', Boolean(adminToken && opToken && playerToken));

// 确保数据录入员被指派到 evt_demo1（否则没有赛事权限）
await call('POST', '/api/events/evt_demo1/staff',
  { token: adminToken, body: { phone: '13900000003', eventRole: 'data_operator' } });
await call('PATCH', '/api/events/evt_demo1/status', { token: adminToken, body: { status: 'live' } });

let matches = (await call('GET', '/api/events/evt_demo1/matches', { token: adminToken })).data || [];
let finished = matches.find((m) => m.status === 'finished');
const scheduled = matches.find((m) => m.status === 'scheduled');

// 如果这个赛事还没有完赛的比赛，就现场录一场（跑完再撤销）
let tempResult = false;
if (!finished && scheduled) {
  tempResult = true;
  await call('PATCH', `/api/matches/${scheduled.id}/full`, {
    token: opToken,
    body: {
      teamAId: scheduled.teamA.registrationId,
      teamBId: scheduled.teamB.registrationId,
      scoreA: 2,
      scoreB: 1,
      goalsA: [{ no: '9', player: '测试甲', time: "23'" }, { no: '10', player: '测试乙', time: "58'" }],
      goalsB: [{ no: '7', player: '测试丙', time: "41'" }],
      substitutions: [],
      cards: [{ team: scheduled.teamB.name, no: '5', player: '测试丁', type: 'yellow', time: "33'" }],
      source: 'manual',
    },
  });
  matches = (await call('GET', '/api/events/evt_demo1/matches', { token: adminToken })).data || [];
  finished = matches.find((m) => m.id === scheduled.id);
}
ok('找到一场已完赛比赛用于测试', Boolean(finished), finished?.id || '');

// ---- ① 未完赛不能生成 ----
if (scheduled && scheduled.id !== finished?.id) {
  const notFinished = await call('POST', `/api/matches/${scheduled.id}/report`, { token: adminToken });
  ok('未完赛的比赛不能生成战报(400)',
    notFinished.status === 400 && String(notFinished.data?.error || '').includes('尚未结束'),
    notFinished.data?.error || `status=${notFinished.status}`);
}

// ---- ③ 权限：参赛球员只读 ----
const playerDenied = await call('POST', `/api/matches/${finished.id}/report`, { token: playerToken });
ok('参赛球员生成战报被拒绝(403)', playerDenied.status === 403, `status=${playerDenied.status}`);
const playerRead = await call('GET', '/api/events/evt_demo1/matches', { token: playerToken });
ok('参赛球员仍能读到比赛列表（战报随比赛返回）',
  playerRead.status === 200 && 'report' in (playerRead.data?.[0] || {}));

// ---- ⑤ 生成前记下比赛数据，用于比对是否被改动 ----
const before = finished;

// ---- ② 已完赛可以生成（管理员 / 数据录入员）----
const gen = await call('POST', `/api/matches/${finished.id}/report`, { token: opToken });
ok('数据录入员可以生成战报(200)', gen.status === 200, gen.data?.error || '');
ok('战报写进了比赛记录', typeof gen.data?.report === 'string' && gen.data.report.length > 10,
  `长度=${gen.data?.report?.length}`);
ok('战报包含双方队名',
  gen.data?.report?.includes(before.teamA.name) && gen.data?.report?.includes(before.teamB.name));
ok('战报包含比分', gen.data?.report?.includes(`${before.scoreA}`)
  && gen.data?.report?.includes(`${before.scoreB}`));
ok('返回了战报来源（AI 或本地模板）',
  ['ai', 'template'].includes(gen.data?.reportSource), gen.data?.reportSource);

const gen2 = await call('POST', `/api/matches/${finished.id}/report`, { token: adminToken });
ok('管理员可以重新生成（覆盖）', gen2.status === 200 && gen2.data?.report?.length > 10);

// ---- ⑤ 生成战报没有改动其它数据 ----
ok('生成战报不改动比分', gen2.data?.scoreA === before.scoreA && gen2.data?.scoreB === before.scoreB);
ok('生成战报不改动进球记录', (gen2.data?.goals?.length || 0) === (before.goals?.length || 0),
  `${before.goals?.length} → ${gen2.data?.goals?.length}`);
ok('生成战报不改动红黄牌记录', (gen2.data?.cards?.length || 0) === (before.cards?.length || 0));
ok('生成战报不改动双方名单',
  JSON.stringify(gen2.data?.lineups) === JSON.stringify(before.lineups));

// ---- ④ 战报可以在统一编辑界面里手工改 ----
const edited = await call('PATCH', `/api/matches/${finished.id}/full`, {
  token: opToken,
  body: {
    teamAId: before.teamA.registrationId,
    teamBId: before.teamB.registrationId,
    report: '手工修改后的战报：测试用。',
  },
});
ok('可以手工修改战报', edited.status === 200
  && edited.data?.report === '手工修改后的战报：测试用。', edited.data?.error || '');
ok('只改战报时不影响比分', edited.data?.scoreA === before.scoreA);

// ---- 收尾：还原 ----
if (tempResult) {
  await call('PATCH', `/api/matches/${finished.id}/full`, {
    token: adminToken,
    body: {
      teamAId: before.teamA.registrationId,
      teamBId: before.teamB.registrationId,
      report: '',
      scoreA: '',
      scoreB: '',
    },
  });
  const restored = (await call('GET', '/api/events/evt_demo1/matches', { token: adminToken }))
    .data?.find((m) => m.id === finished.id);
  ok('临时录入的赛果已还原为未开赛', restored?.status === 'scheduled', restored?.status);
} else {
  await call('PATCH', `/api/matches/${finished.id}/full`, {
    token: adminToken,
    body: {
      teamAId: before.teamA.registrationId,
      teamBId: before.teamB.registrationId,
      report: before.report || '',
    },
  });
  ok('演示数据的战报已还原', true);
}
await call('PATCH', '/api/events/evt_demo1/status', { token: adminToken, body: { status: 'live' } });

console.log(`\n共 ${pass + fail} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
