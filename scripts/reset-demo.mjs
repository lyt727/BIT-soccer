// =============================================================
// 重置演示数据库：GB_CONFIRM_RESET_DEMO=yes node scripts/reset-demo.mjs
//
// 会清空 server/data/greensinbit.db 与 server/data/uploads（学生卡照片），
// 然后重新写入演示数据。线上已有真实报名信息，禁止在服务器上执行本脚本。
// 为防误操作，脚本在删除之前会先把现有数据完整备份到 data/backups/pre-reset-<时间戳>。
// =============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { seedIfEmpty } from '../server/src/seed.js';
import { assertResetAllowed, snapshotData } from './safety.mjs';

assertResetAllowed();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = process.env.DB_FILE || path.join(root, 'server', 'data', 'greensinbit.db');
const uploadDir = process.env.UPLOAD_DIR || path.join(root, 'server', 'data', 'uploads');

// 先备份，再删除：万一误操作也能从 data/backups/pre-reset-* 恢复
if (fs.existsSync(dbFile)) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  const outDir = path.join(root, 'server', 'data', 'backups', `pre-reset-${stamp}`);
  const snap = snapshotData({ outDir, dbFile, uploadDir, label: 'pre-reset' });
  console.log(`[reset-demo] 删除前已备份到 ${snap.outDir}`);
  if (snap.counts) {
    console.log(`[reset-demo] 备份内容：用户 ${snap.counts.users} / 赛事 ${snap.counts.events}`
      + ` / 报名 ${snap.counts.registrations} / 队员 ${snap.counts.registration_members}`
      + ` / 上传文件 ${snap.uploadFiles ?? 0} 个`);
  }
}

if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
if (fs.existsSync(uploadDir)) fs.rmSync(uploadDir, { recursive: true, force: true });

const raw = new DatabaseSync(dbFile);
raw.exec('PRAGMA foreign_keys = ON;');
const db = {
  prepare(sql) {
    const stmt = raw.prepare(sql);
    return {
      run: (...args) => stmt.run(...args),
      get: (...args) => stmt.get(...args),
      all: (...args) => stmt.all(...args),
    };
  },
  get(sql, params = []) {
    return raw.prepare(sql).get(...params);
  },
  all(sql, params = []) {
    return raw.prepare(sql).all(...params);
  },
  run(sql, params = []) {
    return raw.prepare(sql).run(...params);
  },
  exec(sql) {
    return raw.exec(sql);
  },
};

const ddl = fs.readFileSync(path.join(root, 'server', 'src', 'schema.sql'), 'utf8');
raw.exec(ddl);
const seeded = seedIfEmpty(db);
raw.close();
console.log(seeded
  ? '演示数据已重置（手机号 + 密码登录，初始密码见 DEMO_PASSWORD，默认 123456）'
  : '数据库未清空（可能仍有用户数据）');
