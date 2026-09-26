// =============================================================
// 按手机号指定角色（在 .env 里配置，重启即生效）
//
//   ADMIN_PHONES=13900000001:lby,13800138009:小张
//   DATA_OPERATOR_PHONES=13900000003:ljz
//
// 短信验证码上线后，认证管理员就是改这一行配置的事，不用在界面里一个个点。
//
// 安全边界（只做加法，保证已有信息不丢）：
//   · 手机号不存在 → 新建账号（用 DEMO_PASSWORD 作为初始密码，之后可改用短信登录）
//   · 手机号已存在但角色不同 → 只改 role 这一个字段
//   · 姓名、密码、启用/停用状态、报名信息一律不碰
//   · 从配置里删掉某个手机号，不会降级或删除这个账号（需要人工在界面处理）
// =============================================================
import { config, uid, nowIso } from './config.js';
import { hashPassword } from './security.js';

const PHONE_RE = /^1\d{10}$/;

// 角色高低：只做提升，不自动降级，避免配置写错就把谁的权限拿掉
const ROLE_RANK = { player: 1, data_operator: 2, admin: 3 };

// 解析 "13900000001" 或 "13900000001:lby"，逗号/空格/换行都能当分隔符
export function parsePhoneRoles(raw) {
  const out = [];
  const seen = new Set();
  for (const piece of String(raw || '').split(/[\s,，;；]+/)) {
    const item = piece.trim();
    if (!item) continue;
    const [phonePart, ...nameParts] = item.split(':');
    const phone = phonePart.trim();
    if (!PHONE_RE.test(phone)) continue;
    if (seen.has(phone)) continue;
    seen.add(phone);
    out.push({ phone, name: nameParts.join(':').trim() });
  }
  return out;
}

// 幂等：反复启动不会重复建号，也不会改动其它字段
export async function syncPhoneRoles(db) {
  const groups = [
    { role: 'admin', list: parsePhoneRoles(config.adminPhones) },
    { role: 'data_operator', list: parsePhoneRoles(config.dataOperatorPhones) },
  ];
  const changes = [];
  for (const { role, list } of groups) {
    for (const { phone, name } of list) {
      const existing = await db.get('SELECT id, name, role FROM users WHERE phone = ?', [phone]);
      if (!existing) {
        await db.run(
          `INSERT INTO users (id, phone, name, role, emp_id, password_hash, status, created_at)
           VALUES (?, ?, ?, ?, NULL, ?, 'active', ?)`,
          [uid('usr_'), phone, name || phone, role, hashPassword(config.demoPassword), nowIso()],
        );
        changes.push(`新建账号 ${phone}（${name || '未填姓名'}）→ ${role}`);
      } else if (existing.role !== role) {
        if ((ROLE_RANK[role] || 0) > (ROLE_RANK[existing.role] || 0)) {
          await db.run('UPDATE users SET role = ? WHERE id = ?', [role, existing.id]);
          changes.push(`${phone} 角色提升：${existing.role} → ${role}`);
        } else {
          changes.push(`${phone} 当前是 ${existing.role}，比配置的 ${role} 更高，不做降级`
            + '（如需降级请在「成员与角色管理」里改）');
        }
      }
    }
  }
  return changes;
}
