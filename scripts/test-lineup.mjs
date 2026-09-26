// =============================================================
// 双方名单（守门员 / 队长标记）测试
//
// 用法：先启动服务，再执行 node scripts/test-lineup.mjs
//      服务器上：bash scripts/run.sh lineup
//
// 覆盖：
//   ① 首发名单必须有且只有 1 名队长、1 名守门员（0 个 / 2 个都拦）
//   ② 标记（gk / captain）能正确落库并读回（不丢字段）
//   ③ 替补可以标守门员（备选门将），但队长不能在替补
//   ④ AI 识别到但不在报名名单里的人（名单外球员）不会被丢掉
//   ⑤ 这些操作完全不改动报名数据
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

console.log('【双方名单：守门员 / 队长】');
const adminToken = await login('13900000001');
const opToken = await login('13900000003');
const playerToken = await login('13800138001');
ok('三个角色都能登录', Boolean(adminToken && opToken && playerToken));

await call('POST', '/api/events/evt_demo1/staff',
  { token: adminToken, body: { phone: '13900000003', eventRole: 'data_operator' } });
await call('PATCH', '/api/events/evt_demo1/status', { token: adminToken, body: { status: 'live' } });

const matches = (await call('GET', '/api/events/evt_demo1/matches', { token: adminToken })).data || [];
const m = matches.find((x) => x.status === 'scheduled') || matches[0];
const regs = (await call('GET', '/api/events/evt_demo1/registrations?status=approved',
  { token: adminToken })).data || [];
const teamA = regs.find((r) => r.id === m.teamA.registrationId);
const teamB = regs.find((r) => r.id === m.teamB.registrationId);
const lineupable = (reg) => (reg?.members || [])
  .filter((mm) => (mm.roles || []).some((r) => r === 'player' || r === 'captain'))
  .sort((a, b) => (parseInt(a.jerseyNo, 10) || 999) - (parseInt(b.jerseyNo, 10) || 999));
const playersA = lineupable(teamA);
const playersB = lineupable(teamB);
ok('两队都有可上场的报名球员', playersA.length >= 3 && playersB.length >= 3,
  `主队 ${playersA.length} 人 / 客队 ${playersB.length} 人`);

const p = (x, flags = {}) => ({ no: x.jerseyNo, name: x.name, ...flags });
// 一场比赛的两份基准名单（每队 3 首发 + 1 替补），带合法的队长/门将标记
const validLineup = (players) => ({
  color: '红白',
  starting: [p(players[0], { gk: true }), p(players[1], { captain: true }), p(players[2])],
  substitutes: [p(players[3] || players[2])],
});
const baseBody = (over = {}) => ({
  teamAId: m.teamA.registrationId,
  teamBId: m.teamB.registrationId,
  ...over,
});

// 记下改动前的名单，跑完还原
const originalLineupA = m.lineups?.A || null;
const originalLineupB = m.lineups?.B || null;

// ① 缺队长 / 缺门将 / 两个队长 / 两个门将
const noCaptain = await call('PATCH', `/api/matches/${m.id}/full`, {
  token: adminToken,
  body: baseBody({
    lineupA: { color: '红白', starting: [p(playersA[0], { gk: true }), p(playersA[1])], substitutes: [] },
  }),
});
ok('首发缺队长 → 拒绝(400)', noCaptain.status === 400
  && String(noCaptain.data?.error || '').includes('队长'), noCaptain.data?.error);

const noKeeper = await call('PATCH', `/api/matches/${m.id}/full`, {
  token: adminToken,
  body: baseBody({
    lineupA: { color: '红白', starting: [p(playersA[0]), p(playersA[1], { captain: true })], substitutes: [] },
  }),
});
ok('首发缺守门员 → 拒绝(400)', noKeeper.status === 400
  && String(noKeeper.data?.error || '').includes('守门员'), noKeeper.data?.error);

const twoCaptains = await call('PATCH', `/api/matches/${m.id}/full`, {
  token: adminToken,
  body: baseBody({
    lineupA: {
      color: '红白',
      starting: [p(playersA[0], { gk: true, captain: true }), p(playersA[1], { captain: true })],
      substitutes: [],
    },
  }),
});
ok('首发两个队长 → 拒绝(400)', twoCaptains.status === 400, twoCaptains.data?.error);

const twoKeepers = await call('PATCH', `/api/matches/${m.id}/full`, {
  token: adminToken,
  body: baseBody({
    lineupA: {
      color: '红白',
      starting: [p(playersA[0], { gk: true }), p(playersA[1], { gk: true, captain: true })],
      substitutes: [],
    },
  }),
});
ok('首发两个守门员 → 拒绝(400)', twoKeepers.status === 400, twoKeepers.data?.error);

const captainOnBench = await call('PATCH', `/api/matches/${m.id}/full`, {
  token: adminToken,
  body: baseBody({
    lineupA: {
      color: '红白',
      starting: [p(playersA[0], { gk: true }), p(playersA[1], { captain: true })],
      substitutes: [p(playersA[2], { captain: true })],
    },
  }),
});
ok('队长放在替补 → 拒绝(400)', captainOnBench.status === 400
  && String(captainOnBench.data?.error || '').includes('首发'), captainOnBench.data?.error);

// ② 合法名单：标记要落库、能读回
const saved = await call('PATCH', `/api/matches/${m.id}/full`, {
  token: opToken,
  body: baseBody({ lineupA: validLineup(playersA), lineupB: validLineup(playersB) }),
});
ok('数据录入员保存合法名单(200)', saved.status === 200, saved.data?.error || '');
const aStart = saved.data?.lineups?.A?.starting || [];
ok('守门员标记落库', aStart.filter((x) => x.gk).length === 1, JSON.stringify(aStart.map((x) => [x.name, x.gk ? 'GK' : '', x.captain ? 'C' : ''])));
ok('队长标记落库', aStart.filter((x) => x.captain).length === 1);
ok('号码与姓名没有被改动',
  aStart[0]?.no === String(playersA[0].jerseyNo) && aStart[0]?.name === playersA[0].name);
const reread = (await call('GET', '/api/events/evt_demo1/matches', { token: adminToken }))
  .data?.find((x) => x.id === m.id);
ok('重新读取后标记仍在（不是只回显）',
  reread?.lineups?.A?.starting?.some((x) => x.gk)
  && reread?.lineups?.A?.starting?.some((x) => x.captain));

// ③ 替补标守门员（备选门将）允许
const benchKeeper = await call('PATCH', `/api/matches/${m.id}/full`, {
  token: adminToken,
  body: baseBody({
    lineupA: {
      color: '红白',
      starting: [p(playersA[0], { gk: true }), p(playersA[1], { captain: true })],
      substitutes: [p(playersA[2], { gk: true })],
    },
  }),
});
ok('替补可以标备选守门员(200)', benchKeeper.status === 200, benchKeeper.data?.error || '');
ok('替补的守门员标记也保留',
  (benchKeeper.data?.lineups?.A?.substitutes || []).some((x) => x.gk));

// ④ 名单外球员（AI 识别到、不在报名名单里）不能丢
const outsideName = '名单外的临时球员';
const withOutside = await call('PATCH', `/api/matches/${m.id}/full`, {
  token: adminToken,
  body: baseBody({
    lineupA: {
      color: '红白',
      starting: [p(playersA[0], { gk: true }), p(playersA[1], { captain: true }), { no: '99', name: outsideName }],
      substitutes: [],
    },
  }),
});
ok('名单外球员可以保存(200)', withOutside.status === 200, withOutside.data?.error || '');
ok('名单外球员没有被丢掉',
  (withOutside.data?.lineups?.A?.starting || []).some((x) => x.name === outsideName && x.no === '99'));

// ⑤ 报名数据完全没被动过
const regsAfter = (await call('GET', '/api/events/evt_demo1/registrations?status=approved',
  { token: adminToken })).data || [];
const slim = (list) => JSON.stringify(list.map((r) => ({
  id: r.id, status: r.status,
  members: (r.members || []).map((x) => [x.name, x.jerseyNo, x.roles]),
})).sort());
ok('报名数据完全没有被改动', slim(regs) === slim(regsAfter));

// 权限：参赛球员只读
const playerDenied = await call('PATCH', `/api/matches/${m.id}/full`, {
  token: playerToken,
  body: baseBody({ lineupA: validLineup(playersA) }),
});
ok('参赛球员改名单被拒绝(403)', playerDenied.status === 403, `status=${playerDenied.status}`);

// 还原：把名单恢复成测试前的样子。
// 注意：老数据（这套演示数据就是）的首发名单里没有守门员/队长标记，
// 直接原样存回去会被新规则拦下，所以还原时给首发补上默认标记
// （人员、号码、姓名完全不变，只补 🧤/© 两个标记）。
const restoreLineup = (lineup) => {
  if (!lineup || !(lineup.starting || []).length) return lineup || { color: '', starting: [], substitutes: [] };
  const starters = lineup.starting.map((x, i) => ({
    ...x,
    ...(i === 0 ? { gk: true } : {}),
    ...(i === 1 ? { captain: true } : {}),
  }));
  return { ...lineup, starting: starters };
};
const restoreRes = await call('PATCH', `/api/matches/${m.id}/full`, {
  token: adminToken,
  body: baseBody({
    lineupA: restoreLineup(originalLineupA),
    lineupB: restoreLineup(originalLineupB),
  }),
});
const restored = (await call('GET', '/api/events/evt_demo1/matches', { token: adminToken }))
  .data?.find((x) => x.id === m.id);
ok('测试用的名单已还原（人员与原始一致）', (restored?.lineups?.A?.starting || []).length
  === (originalLineupA?.starting || []).length
  && (restored?.lineups?.A?.starting || []).every((x, i) =>
    x.name === originalLineupA.starting[i].name && x.no === originalLineupA.starting[i].no),
  `还原请求=${restoreRes.status}${restoreRes.data?.error ? ` ${restoreRes.data.error}` : ''}`
  + ` 原=${(originalLineupA?.starting || []).length} 现=${(restored?.lineups?.A?.starting || []).length}`);

console.log(`\n共 ${pass + fail} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
