// 重置或创建账号密码（服务器上没有界面可用时的救急工具）
//
// 用法：
//   node scripts/reset-password.mjs <手机号> <新密码> [角色] [姓名]
//
// 例：
//   node scripts/reset-password.mjs 13900000001 my-strong-pwd admin lby
//   node scripts/reset-password.mjs 13800138001 newpass            # 只重置密码
//
// 容器内执行（推荐，服务器上就这一条）：
//   docker compose exec web node scripts/reset-password.mjs 13900000001 my-strong-pwd admin lby
import { getDb } from '../server/src/db.js';
import { hashPassword, passwordIssue } from '../server/src/security.js';
import { ROLES, roleLabel } from '../server/src/rbac.js';
import { uid } from '../server/src/config.js';

const [phone, password, roleArg, nameArg] = process.argv.slice(2);

function fail(message) {
  console.error(`\n${message}\n`);
  console.error('用法：node scripts/reset-password.mjs <手机号> <新密码> [角色] [姓名]');
  console.error(`角色可选：${Object.entries(ROLES).map(([k, v]) => `${k}(${v})`).join(' / ')}`);
  process.exit(1);
}

if (!phone || !password) fail('缺少参数：手机号和密码必填');
if (!/^1\d{10}$/.test(phone)) fail('手机号格式不正确，应为 11 位数字');
const issue = passwordIssue(password);
if (issue) fail(issue);
const role = roleArg || '';
if (role && !ROLES[role]) fail(`角色不合法：${role}`);

const db = getDb();
const now = new Date().toISOString();
const existing = await db.get('SELECT id, name, role FROM users WHERE phone = ?', [phone]);

if (existing) {
  await db.run(
    'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
    [hashPassword(password), now, existing.id],
  );
  if (role) {
    await db.run('UPDATE users SET role = ? WHERE id = ?', [role, existing.id]);
  }
  const finalRole = role || existing.role;
  console.log(`✅ 已重置密码：${existing.name}（${phone}），角色 ${roleLabel(finalRole)}`);
} else {
  const finalRole = role || 'admin';
  const name = nameArg || '管理员';
  const id = uid('usr_');
  await db.run(
    `INSERT INTO users (id, phone, name, role, password_hash, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    [id, phone, name, finalRole, hashPassword(password), now],
  );
  console.log(`✅ 已创建账号：${name}（${phone}），角色 ${roleLabel(finalRole)}`);
}

process.exit(0);
