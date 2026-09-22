import crypto from 'node:crypto';
import { config } from './config.js';

const SCRYPT_KEYLEN = 32;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// 密码强度校验：返回空字符串表示通过，否则返回错误说明
export function passwordIssue(password) {
  const pwd = String(password ?? '');
  if (!pwd) return '请设置登录密码';
  if (pwd.length < 6) return '密码至少 6 位';
  if (pwd.length > 64) return '密码不能超过 64 位';
  if (!pwd.trim()) return '密码不能全是空格';
  return '';
}

// 管理员新建账号时若无初始密码，生成一个易读的随机密码
export function randomPassword(length = 8) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

export function signToken(payload, ttlSeconds = config.tokenTtlSeconds) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }));
  const sig = crypto.createHmac('sha256', config.jwtSecret)
    .update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('token 格式错误');
  const [header, body, sig] = parts;
  const expected = crypto.createHmac('sha256', config.jwtSecret)
    .update(`${header}.${body}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('token 签名无效');
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('token 已过期');
  }
  return payload;
}

export function randomToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}
