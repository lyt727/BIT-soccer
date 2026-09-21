import { authUser, audit, clientIp } from '../helpers.js';
import { signToken } from '../security.js';
import { getDb } from '../db.js';
import { can, ROLES } from '../rbac.js';
import { readJson, sendJson } from '../http.js';
import { badRequest } from '../errors.js';
import { uid, nowIso, config } from '../config.js';
import { issueCode, verifyCode, clearCode, checkPhone } from '../services/verifyCode.js';
import { sendSmsCode, resolveSmsProvider } from '../services/sms.js';

const ALL_ACTIONS = [
  'user.manage', 'user.view', 'event.create', 'event.delete', 'event.status.update',
  'staff.manage', 'registration.submit', 'registration.review',
  'registration.view_materials', 'draw.groups', 'match.manage',
  'result.record', 'ai.recognize', 'stats.view', 'match.view',
];

export function withPerms(user) {
  return {
    ...user,
    roleLabel: ROLES[user.role] || user.role,
    permissions: ALL_ACTIONS.filter((a) => can(user, a)),
  };
}

export function registerAuthRoutes(router) {
  // 发送验证码（scene: login 登录 / register 注册）
  router.add('POST', '/api/auth/send-code', async (req, res) => {
    const body = await readJson(req);
    const phone = String(body.phone || '').trim();
    const scene = body.scene === 'register' ? 'register' : 'login';
    if (!checkPhone(phone)) throw badRequest('请输入正确的 11 位手机号');
    const db = getDb();
    const user = await db.get('SELECT id FROM users WHERE phone = ?', [phone]);
    if (scene === 'login' && !user) {
      throw badRequest('该手机号尚未注册，请先注册', 'NOT_REGISTERED');
    }
    if (scene === 'register' && user) {
      throw badRequest('该手机号已注册，请直接登录', 'ALREADY_REGISTERED');
    }
    const issued = issueCode(phone);
    const provider = resolveSmsProvider();
    if (provider !== 'demo') {
      try {
        await sendSmsCode(phone, issued.code);
        console.log(`[sms] 验证码已通过 ${provider} 发送至 ${phone.slice(0, 3)}****${phone.slice(-4)}`);
      } catch (err) {
        clearCode(phone);
        const e = new Error(`验证码发送失败：${err.message}`);
        e.status = 502;
        e.code = 'SMS_SEND_FAILED';
        throw e;
      }
    }
    sendJson(res, 200, {
      message: scene === 'register' ? '验证码已发送，请完成注册' : '验证码已发送',
      demoCode: provider === 'demo' ? issued.code : undefined,
      ttl: issued.ttl,
      scene,
      provider,
    });
  });

  // 验证码登录
  router.add('POST', '/api/auth/login-code', async (req, res) => {
    const body = await readJson(req);
    const phone = String(body.phone || '').trim();
    if (!checkPhone(phone)) throw badRequest('请输入正确的 11 位手机号');
    verifyCode(phone, body.code);
    const db = getDb();
    const user = await db.get('SELECT * FROM users WHERE phone = ?', [phone]);
    if (!user) throw badRequest('该手机号尚未注册', 'NOT_REGISTERED');
    if (user.status !== 'active') {
      const err = new Error('账号已停用，请联系管理员');
      err.status = 403;
      throw err;
    }
    const token = signToken({ sub: user.id, role: user.role });
    await audit(db, user, 'auth.login', 'user', user.id, {}, clientIp(req));
    sendJson(res, 200, { token, user: withPerms(user) });
  });

  // 手机号注册（自动创建“参赛球员”账号）
  router.add('POST', '/api/auth/register', async (req, res) => {
    const body = await readJson(req);
    const phone = String(body.phone || '').trim();
    const name = String(body.name || '').trim();
    if (!checkPhone(phone)) throw badRequest('请输入正确的 11 位手机号');
    if (name.length < 2 || name.length > 20) throw badRequest('请填写 2-20 个字符的真实姓名');
    verifyCode(phone, body.code);
    const db = getDb();
    const dup = await db.get('SELECT id FROM users WHERE phone = ?', [phone]);
    if (dup) throw badRequest('该手机号已注册，请直接登录', 'ALREADY_REGISTERED');
    const id = uid('usr_');
    await db.run(
      `INSERT INTO users (id, phone, name, role, status, created_at)
       VALUES (?, ?, ?, 'player', 'active', ?)`,
      [id, phone, name, nowIso()],
    );
    await audit(db, { id, phone, name }, 'user.register', 'user', id, { phone }, clientIp(req));
    const user = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    const token = signToken({ sub: user.id, role: user.role });
    sendJson(res, 201, { token, user: withPerms(user), message: '注册成功，已自动登录' });
  });

  router.add('GET', '/api/auth/me', async (req, res) => {
    const user = await authUser(req);
    sendJson(res, 200, { user: withPerms(user) });
  });
}
