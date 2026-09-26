import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { config } from './config.js';
import { hashPassword } from './security.js';

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
    this.migrateSchema();
  }

  // 增量迁移：为老库补上后加的列（幂等，可反复执行）
  migrateSchema() {
    if (this.addColumnIfMissing('users', 'password_hash', 'TEXT')) {
      this.backfillPasswords();
    }
    this.addColumnIfMissing('events', 'yellow_suspension_threshold', 'INTEGER NOT NULL DEFAULT 2');
    this.addColumnIfMissing('events', 'format', "TEXT NOT NULL DEFAULT 'group_knockout'");
    this.addColumnIfMissing('matches', 'round_name', "TEXT NOT NULL DEFAULT ''");
    this.addColumnIfMissing('matches', 'report', "TEXT NOT NULL DEFAULT ''");
    this.addColumnIfMissing('matches', 'report_regen_count', 'INTEGER NOT NULL DEFAULT 0');
    this.addColumnIfMissing('player_suspensions', 'matches_suspended', 'INTEGER NOT NULL DEFAULT 1');
    this.relaxSuspensionReasonCheck();
  }

  // 早期版本的 reason 只允许 red_card / yellow_accumulation；SQLite 改不了 CHECK，只能重建表
  // 这是唯一一处「重建表」的迁移，因此额外做两件事保护已有数据：
  //   1. 整段放进事务，失败自动回滚，不会留下半迁移的库；
  //   2. 迁移前后比对行数，少一行就当作失败回滚并抛错（宁可起不来，也不能悄悄丢数据）。
  relaxSuspensionReasonCheck() {
    const row = this.db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'player_suspensions'",
    ).get();
    if (!row || String(row.sql || '').includes("'other'")) return;
    const before = this.db.prepare('SELECT COUNT(*) AS c FROM player_suspensions').get().c;
    this.db.exec('BEGIN');
    try {
      this.db.exec(`
        ALTER TABLE player_suspensions RENAME TO player_suspensions_legacy;
        CREATE TABLE player_suspensions (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          registration_id TEXT REFERENCES registrations(id) ON DELETE CASCADE,
          team_name TEXT NOT NULL,
          player TEXT NOT NULL,
          player_no TEXT,
          reason TEXT NOT NULL DEFAULT 'red_card'
                 CHECK (reason IN ('red_card','yellow_accumulation','other')),
          matches_suspended INTEGER NOT NULL DEFAULT 1,
          note TEXT,
          status TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','served','void')),
          cleared_yellow INTEGER NOT NULL DEFAULT 0,
          created_by TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT
        );
        INSERT INTO player_suspensions
          (id, event_id, registration_id, team_name, player, player_no, reason,
           matches_suspended, note, status, cleared_yellow, created_by, created_at, updated_at)
        SELECT id, event_id, registration_id, team_name, player, player_no, reason,
               matches_suspended, note, status, cleared_yellow, created_by, created_at, updated_at
          FROM player_suspensions_legacy;
        DROP TABLE player_suspensions_legacy;
        CREATE INDEX IF NOT EXISTS idx_susp_event ON player_suspensions(event_id);
      `);
      const after = this.db.prepare('SELECT COUNT(*) AS c FROM player_suspensions').get().c;
      if (after !== before) {
        throw new Error(`停赛记录迁移前后条数不一致（${before} → ${after}），已回滚`);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    console.log('[migrate] player_suspensions 已重建，支持“其他原因”停赛');
  }

  // 历史账号（手机号+验证码时代创建）没有密码，给一个初始密码，避免升级后无法登录
  backfillPasswords() {
    const rows = this.db.prepare('SELECT id FROM users WHERE password_hash IS NULL').all();
    if (!rows.length) return;
    const stmt = this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
    for (const row of rows) stmt.run(hashPassword(config.demoPassword), row.id);
    console.log(`[migrate] ${rows.length} 个历史账号已设置初始密码 ${config.demoPassword}，请登录后尽快修改`);
  }

  addColumnIfMissing(table, column, type) {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all();
    if (cols.some((c) => c.name === column)) return false;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    console.log(`[migrate] ${table} 新增列 ${column}`);
    return true;
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
