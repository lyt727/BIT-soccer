import crypto from 'node:crypto';
import { config } from '../config.js';

// 单机内存验证码存储；正式版接入 Redis + 云短信。
const store = new Map(); // phone -> { code, expiresAt, attempts, lastSentAt }

function checkPhone(phone) {
  return /^1\d{10}$/.test(String(phone || ''));
}

export function issueCode(phone) {
  const now = Date.now();
  const old = store.get(phone);
  if (old && now - old.lastSentAt < config.smsResendSeconds * 1000) {
    const wait = Math.ceil((config.smsResendSeconds * 1000 - (now - old.lastSentAt)) / 1000);
    const err = new Error(`验证码发送过于频繁，请 ${wait} 秒后重试`);
    err.status = 429;
    throw err;
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  store.set(phone, {
    code,
    expiresAt: now + config.smsCodeTtlSeconds * 1000,
    attempts: 0,
    lastSentAt: now,
  });
  return { code, ttl: config.smsCodeTtlSeconds };
}

export function verifyCode(phone, code) {
  const rec = store.get(String(phone));
  if (!rec) {
    const err = new Error('请先获取验证码');
    err.status = 400;
    throw err;
  }
  if (Date.now() > rec.expiresAt) {
    store.delete(String(phone));
    const err = new Error('验证码已过期，请重新获取');
    err.status = 400;
    throw err;
  }
  rec.attempts += 1;
  if (rec.attempts > 5) {
    store.delete(String(phone));
    const err = new Error('验证码错误次数过多，请重新获取');
    err.status = 400;
    throw err;
  }
  if (String(rec.code) !== String(code || '').trim()) {
    const err = new Error('验证码不正确');
    err.status = 400;
    throw err;
  }
  store.delete(String(phone));
  return true;
}

export function clearCode(phone) {
  store.delete(String(phone));
}

export { checkPhone };
