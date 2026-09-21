import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { config } from './config.js';

const require = createRequire(import.meta.url);
let store = null;

function normalizeSql(sql, params, driver) {
  if (driver === 'sqlite') return { sql, params };
  let i = 0;
  const converted = sql.replace(/\?/g, () => `$${++i}`);
  return { sql: converted, params };
}

class SqliteStore {
  constructor(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const { DatabaseSync } = require('node:sqlite');
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA foreign_keys = ON;');
    const ddlPath = new URL('./schema.sql', import.meta.url);
    this.db.exec(fs.readFileSync(ddlPath, 'utf8'));
  }

  prepare(sql) {
    return this.db.prepare(sql);
  }

  run(sql, params = []) {
    return this.db.prepare(sql).run(...params);
  }

  all(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }

  get(sql, params = []) {
    return this.db.prepare(sql).get(...params);
  }

  exec(sql) {
    return this.db.exec(sql);
  }

  async migrate() {
    // SQLite 演示库在构造时通过 schema.sql 幂等建表
  }
}

class PgStore {
  constructor(connectionString) {
    this.pending = import('pg').then(({ Pool }) => {
      this.pool = new Pool({ connectionString });
      return this.pool.query('SELECT 1');
    });
  }

  async ready() {
    await this.pending;
  }

  async run(sql, params = []) {
    await this.ready();
    const { sql: s, params: p } = normalizeSql(sql, params, 'pg');
    return this.pool.query(s, p);
  }

  async all(sql, params = []) {
    await this.ready();
    const { sql: s, params: p } = normalizeSql(sql, params, 'pg');
    const res = await this.pool.query(s, p);
    return res.rows;
  }

  async get(sql, params = []) {
    const rows = await this.all(sql, params);
    return rows[0] || undefined;
  }

  async exec(sql) {
    await this.ready();
    await this.pool.query(sql);
  }

  async migrate() {
    // 云库正式 DDL（database/schema.sql）建议通过 CI 迁移执行，
    // 见 docs/云数据库方案.md
  }
}

export function getDb() {
  if (store) return store;
  store = config.dbDriver === 'pg'
    ? new PgStore(config.pgConnection)
    : new SqliteStore(config.dbFile);
  return store;
}

export async function ensureDb() {
  const db = getDb();
  if (db && typeof db.migrate === 'function') await db.migrate();
  return db;
}
