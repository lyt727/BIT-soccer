// =============================================================
// 升级不动数据 的验证脚本
//
// 目的：每次改完代码部署前，先确认「老库升级到新代码」不会动到已有数据。
//
// 用法（默认用临时库自测）：
//   node scripts/test-migration.mjs
//   服务器上没装 Node，用容器跑：bash scripts/run.sh migration
// 用法（拿线上库的副本先验一遍，推荐部署前做）：
//   node scripts/test-migration.mjs --db /path/to/数据库副本.db
//   （服务器上：bash scripts/run.sh migration --db server/data/greensinbit.db）
//   —— 演练是在临时副本上做的，指定的数据库文件本身不会被改动
//
// 检查三件事：
//   ① 老结构（旧 CHECK 约束 + 旧列）升级后，每一张表的数据都还在；
//   ② 连跑两次升级，结果完全一致（幂等，不会越跑越变）；
//   ③ 表结构确实是升级后的样子。
// =============================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const at = args.indexOf('--db');
const sourceDb = at >= 0 ? path.resolve(args[at + 1] || '') : null;

let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}${extra ? `  ${extra}` : ''}`); }
  else { fail += 1; console.log(`FAIL  ${name}${extra ? `  -> ${extra}` : ''}`); }
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-migrate-'));
const workDb = path.join(tmpDir, 'greensinbit.db');

// 只读快照：每张表的行数 + 全部内容的指纹
function snapshot(file) {
  const db = new DatabaseSync(file);
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map((r) => r.name);
  const counts = {};
  const hash = crypto.createHash('sha256');
  for (const t of tables) {
    const rows = db.prepare(`SELECT * FROM ${t}`).all();
    counts[t] = rows.length;
    hash.update(t);
    // 排序后再算指纹，避免行序变化造成误报
    for (const line of rows.map((r) => JSON.stringify(r)).sort()) hash.update(line);
  }
  db.close();
  return { tables, counts, digest: hash.digest('hex').slice(0, 16) };
}

// 用当前代码跑一次「启动时的建表 + 迁移」。
// 放到子进程里跑：模拟真实的服务启动，且每次都是干净的模块状态，
// 不会出现「第二次跑时配置被上一次缓存住、把别的库当成目标」的问题。
function runMigration(file) {
  const entry = pathToFileURL(path.join(root, 'server', 'src', 'db.js')).href;
  const script = `
    process.env.DB_FILE = ${JSON.stringify(file)};
    process.env.DB_DRIVER = 'sqlite';
    const { ensureDb, getDb } = await import(${JSON.stringify(entry)});
    await ensureDb();
    const store = getDb();
    if (store && store.db && typeof store.db.close === 'function') store.db.close();
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root,
    env: { ...process.env, DB_FILE: file, DB_DRIVER: 'sqlite' },
    encoding: 'utf8',
  });
  for (const line of String(out || '').split(/\r?\n/)) {
    if (line.trim() && !line.includes('[env]')) console.log(`      ${line.trim()}`);
  }
}

console.log('【一、模拟老库升级】');
{
  // 造一个「旧结构」的库：CHECK 只允许 red_card / yellow_accumulation，
  // 并预置几条停赛记录，验证重建表时数据不会丢。
  const db = new DatabaseSync(workDb);
  // 用 SQLite 版建表语句（server/src/schema.sql，服务启动时用的就是这一份）
  db.exec(fs.readFileSync(path.join(root, 'server', 'src', 'schema.sql'), 'utf8'));
  db.exec(`
    ALTER TABLE player_suspensions RENAME TO ps_now;
    CREATE TABLE player_suspensions (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      registration_id TEXT,
      team_name TEXT NOT NULL,
      player TEXT NOT NULL,
      player_no TEXT,
      reason TEXT NOT NULL DEFAULT 'red_card'
             CHECK (reason IN ('red_card','yellow_accumulation')),
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending','served','void')),
      cleared_yellow INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
    DROP TABLE ps_now;
  `);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO users (id, phone, name, role, status, created_at)
              VALUES (?, ?, ?, ?, 'active', ?)`).run('u1', '13800000001', '同学甲', 'player', now);
  db.prepare(`INSERT INTO events (id, name, season, status, created_by, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`).run('e1', '真实赛事', '2026', 'live', 'u1', now);
  for (let i = 1; i <= 5; i += 1) {
    db.prepare(`INSERT INTO player_suspensions
      (id, event_id, registration_id, team_name, player, player_no, reason, note, status,
       cleared_yellow, created_by, created_at)
      VALUES (?, 'e1', NULL, '某队', ?, ?, 'red_card', ?, 'pending', 0, 'u1', ?)`)
      .run(`s${i}`, `球员${i}`, String(i), `备注${i}`, now);
  }
  const before = snapshot(workDb);
  ok('老库里预置了 5 条停赛记录', before.counts.player_suspensions === 5);
  db.close();

  await runMigration(workDb);
  const after = snapshot(workDb);

  ok('升级后停赛记录一条不少', after.counts.player_suspensions === 5,
    `${before.counts.player_suspensions} → ${after.counts.player_suspensions}`);
  ok('升级后其它表数据一条不少（用户/赛事）',
    after.counts.users === 1 && after.counts.events === 1);
  const checkDb = new DatabaseSync(workDb);
  const ddl = checkDb.prepare(
    "SELECT sql FROM sqlite_master WHERE name = 'player_suspensions'",
  ).get().sql;
  checkDb.close();
  ok('表结构已升级（reason 允许 other）', String(ddl).includes("'other'"));

  // 内容指纹：除了新加的列（默认值），原字段应逐字未变
  const db2 = new DatabaseSync(workDb);
  const kept = db2.prepare(
    'SELECT id, event_id, team_name, player, player_no, reason, note, status, cleared_yellow FROM player_suspensions ORDER BY id',
  ).all();
  db2.close();
  ok('原字段逐条核对无误',
    kept.length === 5 && kept[2].player === '球员3' && kept[2].note === '备注3'
    && kept[4].player_no === '5');
}

console.log('\n【二、连续升级两次（幂等）】');
{
  const first = snapshot(workDb);
  await runMigration(workDb);
  const second = snapshot(workDb);
  ok('再跑一次升级，数据指纹完全一致', first.digest === second.digest,
    `${first.digest} vs ${second.digest}`);
  ok('再跑一次升级，行数完全一致',
    JSON.stringify(first.counts) === JSON.stringify(second.counts));
}

console.log('\n【三、表结构完整性】');
{
  const db = new DatabaseSync(workDb);
  const need = ['users', 'events', 'event_staff', 'registrations', 'registration_members',
    'files', 'event_groups', 'matches', 'match_goals', 'match_subs', 'match_cards',
    'player_suspensions', 'audit_log'];
  const have = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  ).all().map((r) => r.name);
  db.close();
  const missing = need.filter((t) => !have.includes(t));
  ok('关键表齐全', missing.length === 0, missing.join(', '));
}

// 指定了真实库副本时，额外只做「只读体检 + 升级演练」
if (sourceDb) {
  console.log(`\n【四、对指定数据库副本做升级演练】${sourceDb}`);
  const copy = path.join(tmpDir, 'from-source.db');
  fs.copyFileSync(sourceDb, copy);
  const before = snapshot(copy);
  await runMigration(copy);
  const after = snapshot(copy);
  const lost = Object.keys(before.counts).filter((t) => after.counts[t] !== before.counts[t]);
  console.log(`  升级前：${Object.entries(before.counts).filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`).join(' ')}`);
  ok('对真实库副本做升级演练：每张表行数不变', lost.length === 0,
    lost.map((t) => `${t}: ${before.counts[t]}→${after.counts[t]}`).join(' · '));
  console.log('  （原本的数据库文件没有被改动，演练是在副本上做的）');
}

try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows 上偶尔还占着文件句柄，忽略 */ }
console.log(`\n共 ${pass + fail} 项，失败 ${fail} 项`);
console.log(fail ? '结论：升级会动到数据，先别部署！'
  : '结论：升级不会动到已有数据，可以部署。');
process.exit(fail ? 1 : 0);
