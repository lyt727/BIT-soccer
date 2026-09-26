// =============================================================
// 「按手机号认证管理人员」的验证：只做加法，不动已有信息
//
// 用法：node scripts/test-role-sync.mjs
//       （服务器上：bash scripts/run.sh roles）
//
// 覆盖：
//   ① 新手机号 → 建账号，角色正确
//   ② 已存在的数据录入员/球员 → 只提升角色，姓名、密码、报名信息一律不动
//   ③ 已是管理员的人被写到 DATA_OPERATOR_PHONES → 不降级
//   ④ 已停用的账号 → 角色可以调，但不会被偷偷重新启用
//   ⑤ 反复启动（跑两次）结果一致，不会重复建号
// =============================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}${extra ? `  ${extra}` : ''}`); }
  else { fail += 1; console.log(`FAIL  ${name}${extra ? `  -> ${extra}` : ''}`); }
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-roles-'));
const dbFile = path.join(tmpDir, 'greensinbit.db');

// 关键：本进程自己也必须指向这个临时库。
// 否则后面的 getDb() 会去打开默认库（server/data/greensinbit.db），
// 测试数据就写进真实库里了 —— 这正是这个脚本要防的那类事故。
process.env.DB_FILE = dbFile;
process.env.DB_DRIVER = 'sqlite';

// 先用「服务启动」的方式建表（和线上同一套建表逻辑）
execFileSync(process.execPath, ['--input-type=module', '-e', `
  process.env.DB_FILE = ${JSON.stringify(dbFile)};
  const { ensureDb, getDb } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'server', 'src', 'db.js')).href)});
  await ensureDb();
  getDb().db.close();
`], { cwd: root, env: { ...process.env, DB_FILE: dbFile, DB_DRIVER: 'sqlite' }, encoding: 'utf8' });

// 预置几个「真实同学」的账号与一条报名数据
// 注意：配置必须在 import 服务端模块之前设好 —— config.js 是在「首次被 import 时」
// 读一次环境变量的，设晚了就不生效（这也正是线上靠重启生效的原因）。
process.env.ADMIN_PHONES = '13911112222:小李,13866667777:新管理员,13933334444:已停用的同学';
process.env.DATA_OPERATOR_PHONES = '13900000001';
const { hashPassword } = await import(pathToFileURL(path.join(root, 'server', 'src', 'security.js')).href);
const now = new Date().toISOString();
const seed = new DatabaseSync(dbFile);
const insertUser = seed.prepare(
  `INSERT INTO users (id, phone, name, role, emp_id, password_hash, status, created_at)
   VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
);
insertUser.run('u_boss', '13900000001', '原本的管理员', 'admin', hashPassword('boss-pass'), 'active', now);
insertUser.run('u_op', '13900000003', '小李', 'data_operator', hashPassword('op-pass'), 'active', now);
insertUser.run('u_player', '13911112222', '张同学', 'player', hashPassword('zhang-pass'), 'active', now);
insertUser.run('u_off', '13933334444', '已停用的同学', 'player', hashPassword('off-pass'), 'disabled', now);
seed.prepare(`INSERT INTO events (id, name, season, status, created_by, created_at)
              VALUES ('e1', '真实赛事', '2026', 'live', 'u_boss', ?)`).run(now);
seed.prepare(`INSERT INTO registrations (id, event_id, team_name, status, apply_time, created_by)
              VALUES ('reg1', 'e1', '信息与电子学院一队', 'approved', ?, 'u_player')`).run(now);
seed.prepare(`INSERT INTO registration_members
              (id, registration_id, name, phone, roles, jersey_no, is_contact, created_at)
              VALUES ('mem1', 'reg1', '张同学', '13911112222', '["player"]', '7', 1, ?)`).run(now);
seed.close();

const digestOf = (file, tables) => {
  const db = new DatabaseSync(file);
  const h = crypto.createHash('sha256');
  for (const t of tables) {
    for (const line of db.prepare(`SELECT * FROM ${t}`).all().map((r) => JSON.stringify(r)).sort()) {
      h.update(line);
    }
  }
  db.close();
  return h.digest('hex').slice(0, 12);
};

const OTHER_TABLES = ['registrations', 'registration_members', 'events'];
const before = {
  others: digestOf(dbFile, OTHER_TABLES),
  users: (() => {
    const db = new DatabaseSync(dbFile);
    const rows = db.prepare('SELECT id, phone, name, role, status, password_hash FROM users ORDER BY id').all();
    db.close();
    return rows;
  })(),
};

// 配置含义：把「张同学」提成管理员；新增一个手机号；把老板写到录入员名单里（不该降级）；
// 已停用的同学写到管理员名单里（角色可调，但状态不能被偷偷改回启用）
const { syncPhoneRoles } = await import(pathToFileURL(path.join(root, 'server', 'src', 'phoneRoles.js')).href);
const { getDb } = await import(pathToFileURL(path.join(root, 'server', 'src', 'db.js')).href);

console.log('【一、按手机号同步角色】');
const db = getDb();
const changes1 = await syncPhoneRoles(db);
for (const c of changes1) console.log(`      · ${c}`);

const readUsers = async () => {
  const rows = await db.all('SELECT id, phone, name, role, status, password_hash FROM users ORDER BY id');
  return Object.fromEntries(rows.map((r) => [r.phone, r]));
};
const u1 = await readUsers();

ok('新手机号建了账号且角色是管理员',
  u1['13866667777']?.role === 'admin' && u1['13866667777']?.name === '新管理员');
ok('已存在的球员被提升为管理员',
  u1['13911112222']?.role === 'admin', `实际=${u1['13911112222']?.role}`);
ok('提升角色时没有改姓名',
  u1['13911112222']?.name === '张同学', u1['13911112222']?.name);
ok('提升角色时没有改密码',
  u1['13911112222']?.password_hash === before.users.find((u) => u.phone === '13911112222')?.password_hash);
ok('已是管理员的人被写到录入员名单里，不会被降级',
  u1['13900000001']?.role === 'admin', `实际=${u1['13900000001']?.role}`);
ok('已有账号的姓名密码都没被动过',
  u1['13900000001']?.name === '原本的管理员' && u1['13900000003']?.name === '小李'
  && u1['13900000001']?.password_hash === before.users.find((u) => u.phone === '13900000001')?.password_hash
  && u1['13900000003']?.password_hash === before.users.find((u) => u.phone === '13900000003')?.password_hash);
ok('已停用的账号不会被偷偷重新启用',
  u1['13933334444']?.status === 'disabled', `实际=${u1['13933334444']?.status}`);
ok('没有任何账号被删除或改动 id 之外的其它账号',
  Object.keys(u1).sort().join(',') === ['13900000001', '13900000003', '13911112222',
    '13933334444', '13866667777'].sort().join(','),
  Object.keys(u1).join(','));
ok('报名数据与赛事数据未被触碰',
  digestOf(dbFile, OTHER_TABLES) === before.others);

console.log('\n【二、再跑一次（重启一次服务）】');
const changes2 = await syncPhoneRoles(db);
ok('第二次没有任何实际改动', changes2.filter((c) => c.includes('新建') || c.includes('提升')).length === 0,
  changes2.join(' | ') || '（无输出）');
const u2 = await readUsers();
ok('用户数量没有膨胀（不会重复建号）', Object.keys(u2).length === Object.keys(u1).length);
ok('第二次跑完，数据指纹与第一次一致',
  JSON.stringify(u2) === JSON.stringify(u1));

console.log('\n【三、配置格式解析】');
const { parsePhoneRoles } = await import(pathToFileURL(path.join(root, 'server', 'src', 'phoneRoles.js')).href);
ok('支持逗号/换行分隔与「手机号:姓名」',
  parsePhoneRoles('13900000001:lby, 13866667777\n13933334444：名字不对').length === 2,
  JSON.stringify(parsePhoneRoles('13900000001:lby, 13866667777\n13933334444：名字不对')));
ok('非法手机号被忽略，不会建出脏账号',
  parsePhoneRoles('123, 13900000001, abc').length === 1);
ok('重复手机号自动去重', parsePhoneRoles('13900000001,13900000001').length === 1);

db.db.close();
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows 句柄释放慢，忽略 */ }
console.log(`\n共 ${pass + fail} 项，失败 ${fail} 项`);
console.log(fail ? '结论：这个能力会动到已有信息，先别用！'
  : '结论：只做加法，已有账号的姓名/密码/状态/报名信息都不会被改动。');
process.exit(fail ? 1 : 0);
