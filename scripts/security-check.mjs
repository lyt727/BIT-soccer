// =============================================================
// 上线体检：检查有没有把真实用户的数据暴露出去
//
// 用法（服务器上，容器里跑）：
//   cd ~/greensinbit && docker compose exec -T web node scripts/security-check.mjs
//   或更省事：bash scripts/run.sh security
// 用法（本机）：
//   node scripts/security-check.mjs
//
// 只读检查，不改任何数据。
// =============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { verifyPassword } from '../server/src/security.js';

await import('../server/src/env.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = process.env.DB_FILE || path.join(root, 'server', 'data', 'greensinbit.db');
const uploadDir = process.env.UPLOAD_DIR || path.join(root, 'server', 'data', 'uploads');
const backupsRoot = process.env.BACKUP_DIR || path.join(root, 'server', 'data', 'backups');

const DEFAULT_PASSWORD = process.env.DEMO_PASSWORD || '123456';
const rows = [];
const add = (level, title, detail) => rows.push({ level, title, detail });

if (!fs.existsSync(dbFile)) {
  console.error(`找不到数据库文件：${dbFile}`);
  process.exit(1);
}

const db = new DatabaseSync(dbFile);
const count = (sql, ...p) => db.prepare(sql).get(...p)?.c ?? 0;

const users = count('SELECT COUNT(*) c FROM users');
const regs = count('SELECT COUNT(*) c FROM registrations');
const members = count('SELECT COUNT(*) c FROM registration_members');
const fileRows = count('SELECT COUNT(*) c FROM files');
add('info', '数据规模', `用户 ${users} · 报名 ${regs} · 队员 ${members} · 学生卡照片 ${fileRows}`);

// ① 还有哪些账号能用默认演示密码登录（公开仓库里写着 123456）
const weak = db.prepare('SELECT phone, name, role FROM users WHERE status = ?').all('active')
  .filter((u) => {
    const row = db.prepare('SELECT password_hash FROM users WHERE phone = ?').get(u.phone);
    return row?.password_hash && verifyPassword(DEFAULT_PASSWORD, row.password_hash);
  });
if (weak.length) {
  const admins = weak.filter((u) => u.role === 'admin');
  add(admins.length ? 'critical' : 'warn',
    `有 ${weak.length} 个账号仍在用默认密码 ${DEFAULT_PASSWORD}`,
    weak.map((u) => `${u.phone} ${u.name}(${u.role})`).join(' · ')
    + (admins.length ? `　← 其中 ${admins.length} 个是管理员，公开仓库里就能查到这串密码` : ''));
} else {
  add('ok', '没有账号还在用默认演示密码', '');
}

// ② 是否还在允许「演示验证码」直接登录（不真实发短信）
const allowDemoCode = process.env.ALLOW_DEMO_CODE
  ? process.env.ALLOW_DEMO_CODE === 'true'
  : process.env.NODE_ENV !== 'production';
add(allowDemoCode ? 'critical' : 'ok',
  allowDemoCode ? '登录验证码仍是“演示模式”' : '登录验证码已走真实短信',
  allowDemoCode
    ? '任何人只要输入任意手机号就能拿到验证码直接登录，正式使用必须关掉（SMS_MODE 配成真实通道）'
    : `SMS_MODE=${process.env.SMS_MODE || 'demo'}`);

// ③ 备份
if (fs.existsSync(backupsRoot)) {
  const dirs = fs.readdirSync(backupsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse();
  if (dirs.length) {
    const latest = path.join(backupsRoot, dirs[0]);
    const dbBackup = path.join(latest, path.basename(dbFile));
    const size = fs.existsSync(dbBackup) ? fs.statSync(dbBackup).size : 0;
    const days = Math.floor((Date.now() - fs.statSync(latest).mtimeMs) / 86400000);
    add(days > 7 ? 'warn' : 'ok',
      `最近一次备份：${dirs[0]}（${days} 天前，${(size / 1024 / 1024).toFixed(2)} MB）`,
      days > 7 ? '距上次备份超过一周，建议尽快再备一份' : `共 ${dirs.length} 份，目录 ${backupsRoot}`);
  } else {
    add('critical', '还没有任何备份', `备份目录是空的：${backupsRoot}`);
  }
} else {
  add('critical', '还没有任何备份', '备份目录不存在。一旦库损坏或被误删，真实报名信息与学生卡照片都找不回来。');
}

// ④ 真实上传的学生卡照片是否都还在磁盘上（照片丢了比丢记录更麻烦）
//    演示数据里的文件记录 path 为空，不算真实上传，排除掉避免误报
const realFiles = db.prepare(
  "SELECT path FROM files WHERE owner_type = 'registration_member' AND path IS NOT NULL",
).all();
const missing = realFiles.filter((f) => {
  const abs = String(f.path);
  if (fs.existsSync(abs)) return false;
  // 备份/迁移后容器内绝对路径可能对不上，按文件名再兜底找一次
  return !fs.existsSync(path.join(uploadDir, path.basename(abs)));
});
if (!realFiles.length) {
  add('info', '还没有真实上传的学生卡照片',
    `数据库里的 ${fileRows} 条文件记录都来自演示数据（没有实际文件），真实报名上传后会出现在 ${uploadDir}`);
} else if (missing.length) {
  add('critical', `有 ${missing.length} 张学生卡照片在磁盘上找不到`,
    missing.slice(0, 3).map((f) => String(f.path)).join(' · ')
    + `　（真实上传 ${realFiles.length} 张，目录 ${uploadDir}）`);
} else {
  add('ok', `学生卡照片齐全（${realFiles.length} 张）`, `目录 ${uploadDir}`);
}

// ⑤ 演示赛事是否还挂在线上（不危险，但真实使用时容易被误操作）
const demoEvents = db.prepare("SELECT name FROM events WHERE id IN ('evt_demo1','evt_demo2','evt_women')").all();
if (demoEvents.length) {
  add('info', `还保留着 ${demoEvents.length} 个演示赛事`,
    `${demoEvents.map((e) => e.name).join(' · ')}（自己用没事，注意别把同学的真实赛事和它搞混）`);
}

db.close();

const icon = { critical: '严重', warn: '注意', ok: '正常', info: '信息' };
console.log('\n================ 线上体检 ================');
for (const r of rows) {
  console.log(`[${icon[r.level]}] ${r.title}`);
  if (r.detail) console.log(`         ${r.detail}`);
}
const critical = rows.filter((r) => r.level === 'critical').length;
console.log('==========================================');
console.log(critical
  ? `有 ${critical} 项需要立刻处理（上面标「严重」的）`
  : '没有发现严重问题');
console.log('');
