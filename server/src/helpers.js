import { config, nowIso } from './config.js';
import { verifyToken } from './security.js';
import { getDb } from './db.js';

export async function authUser(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    const err = new Error('请先登录');
    err.status = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  let payload;
  try {
    payload = verifyToken(header.slice(7));
  } catch {
    const err = new Error('登录状态已失效，请重新登录');
    err.status = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  const db = getDb();
  const user = await db.get('SELECT * FROM users WHERE id = ?', [payload.sub]);
  if (!user || user.status !== 'active') {
    const err = new Error('账号不存在或已停用');
    err.status = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  return user;
}

export async function audit(db, user, action, entity, entityId, detail, ip = '') {
  try {
    await db.run(
      `INSERT INTO audit_log (id, user_id, phone, action, entity, entity_id, detail, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), user?.id || null,
        user?.phone || null, action, entity, entityId || null,
        JSON.stringify(detail ?? {}), ip || '', nowIso()],
    );
  } catch (e) {
    console.warn('audit 写入失败', e.message);
  }
}

export function safeUser(user) {
  if (!user) return null;
  return user;
}

export function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || '';
}

export async function loadEvent(db, eventId) {
  const event = await db.get('SELECT * FROM events WHERE id = ?', [eventId]);
  if (!event) {
    const err = new Error('赛事不存在或已被删除');
    err.status = 404;
    throw err;
  }
  return event;
}

export async function loadMatch(db, matchId) {
  const match = await db.get('SELECT * FROM matches WHERE id = ?', [matchId]);
  if (!match) {
    const err = new Error('比赛不存在或已被删除');
    err.status = 404;
    throw err;
  }
  return match;
}

export function httpIp(req) {
  return clientIp(req);
}

// 供 serverless / 单测使用
export function envConfig() {
  return config;
}
