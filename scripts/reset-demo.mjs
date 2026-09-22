// 重置演示数据库：node scripts/reset-demo.mjs
// 会清空 server/data/greensinbit.db 与上传文件，并重新写入演示数据
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { seedIfEmpty } from '../server/src/seed.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = process.env.DB_FILE || path.join(root, 'server', 'data', 'greensinbit.db');
const uploadDir = process.env.UPLOAD_DIR || path.join(root, 'server', 'data', 'uploads');

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
