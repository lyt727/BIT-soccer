import { authUser, audit, clientIp } from '../helpers.js';
import { getDb } from '../db.js';
import { requireAction, ROLES, roleLabel } from '../rbac.js';
import { uid } from '../config.js';
import { nowIso } from '../config.js';
import { readJson, sendJson } from '../http.js';
import { badRequest, notFound } from '../errors.js';
import { checkPhone } from '../services/verifyCode.js';
import { withPerms } from './auth.js';
import { hashPassword, passwordIssue, randomPassword } from '../security.js';

export function registerUserRoutes(router) {
  router.add('GET', '/api/admin/users', async (req, res) => {
    const user = await authUser(req);
    requireAction(user, 'user.view');
    const db = getDb();
    const url = new URL(req.url, 'http://x');
    const role = url.searchParams.get('role');
    const sql = `SELECT id, phone, name, role, emp_id, status, created_at
                   FROM users ${role ? 'WHERE role = ?' : ''} ORDER BY created_at DESC`;
    const rows = await db.all(sql, role ? [role] : []);
    sendJson(res, 200, rows.map((r) => ({ ...r, roleLabel: roleLabel(r.role) })));
  });

  router.add('POST', '/api/admin/users', async (req, res) => {
    const user = await authUser(req);
    requireAction(user, 'user.manage');
    const body = await readJson(req);
    const phone = String(body.phone || '').trim();
    const name = String(body.name || '').trim();
    const role = body.role;
    if (!checkPhone(phone)) throw badRequest('请输入正确的 11 位手机号');
    if (!name) throw badRequest('请填写姓名');
    if (!ROLES[role]) throw badRequest('角色不合法');
    // 未指定初始密码时自动生成一个，管理员可把密码告知本人
    const initialPassword = String(body.password || '') || randomPassword(8);
    const issue = passwordIssue(initialPassword);
    if (issue) throw badRequest(issue);
    const db = getDb();
    const dup = await db.get('SELECT id FROM users WHERE phone = ?', [phone]);
    if (dup) throw badRequest('该手机号已存在', 'DUPLICATE_PHONE');
    const id = uid('usr_');
    await db.run(
      `INSERT INTO users (id, phone, name, role, emp_id, password_hash, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
      [id, phone, name, role,
        body.empId ? String(body.empId) : null,
        hashPassword(initialPassword),
        nowIso()],
    );
    await audit(db, user, 'user.create', 'user', id, { phone, name, role }, clientIp(req));
    sendJson(res, 201, {
      id,
      password: initialPassword,
      message: `账号创建成功，初始密码：${initialPassword}`,
    });
  });

  router.add('PATCH', '/api/admin/users/:id', async (req, res, params) => {
    const user = await authUser(req);
    requireAction(user, 'user.manage');
    const db = getDb();
    const target = await db.get('SELECT * FROM users WHERE id = ?', [params.id]);
    if (!target) throw notFound('用户不存在');
    const body = await readJson(req);
    const updates = [];
    const args = [];
    if (body.role && ROLES[body.role]) {
      updates.push('role = ?');
      args.push(body.role);
    }
    if (body.status === 'active' || body.status === 'disabled') {
      if (target.id === user.id && body.status === 'disabled') {
        throw badRequest('不能停用自己的账号');
      }
      updates.push('status = ?');
      args.push(body.status);
    }
    if (body.name) {
      updates.push('name = ?');
      args.push(String(body.name).trim());
    }
    // 重置密码（管理员代改，用于成员忘记密码）
    let resetPassword = '';
    if (body.password !== undefined && body.password !== null && body.password !== '') {
      resetPassword = String(body.password);
      const issue = passwordIssue(resetPassword);
      if (issue) throw badRequest(issue);
      updates.push('password_hash = ?');
      args.push(hashPassword(resetPassword));
    }
    if (updates.length) {
      updates.push('updated_at = ?');
      args.push(nowIso());
      await db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, [...args, target.id]);
      const changed = {};
      for (const key of ['role', 'status', 'name']) if (body[key]) changed[key] = body[key];
      await audit(db, user, 'user.update', 'user', target.id, changed, clientIp(req));
    }
    const fresh = await db.get('SELECT * FROM users WHERE id = ?', [target.id]);
    sendJson(res, 200, {
      message: resetPassword ? '密码已重置' : '已保存',
      password: resetPassword || undefined,
      user: fresh && withPerms(fresh),
    });
  });
}
