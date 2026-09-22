-- =============================================================
-- 绿茵BIT 云数据库正式 DDL（PostgreSQL 13+）
-- 账号：手机号 + 短信验证码；角色：admin / data_operator / player
-- =============================================================

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  phone      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('admin','data_operator','player')),
  emp_id     TEXT,
  password_hash TEXT,
  status     TEXT NOT NULL DEFAULT 'active'
             CHECK (status IN ('active','disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 已上线库的增量迁移（新库执行上面建表语句即可，此句幂等可重复执行）
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  season      TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','signup','live','ended')),
  yellow_suspension_threshold INTEGER NOT NULL DEFAULT 2,
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL
);
ALTER TABLE events ADD COLUMN IF NOT EXISTS yellow_suspension_threshold INTEGER NOT NULL DEFAULT 2;

CREATE TABLE IF NOT EXISTS event_staff (
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_role  TEXT NOT NULL CHECK (event_role IN ('admin','data_operator')),
  assigned_by TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS registrations (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_name    TEXT NOT NULL,
  jersey_top   TEXT NOT NULL DEFAULT '',
  jersey_shorts TEXT NOT NULL DEFAULT '',
  jersey_socks TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','approved','rejected')),
  reject_reason TEXT,
  apply_time   TEXT NOT NULL,
  reviewed_by  TEXT REFERENCES users(id),
  reviewed_at  TEXT,
  created_by   TEXT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_reg_event_status ON registrations(event_id, status);

-- 报名成员：每名球员手机号 + 学生卡照片（文件在 files 表）
CREATE TABLE IF NOT EXISTS registration_members (
  id              TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  phone           TEXT NOT NULL,
  roles           TEXT NOT NULL DEFAULT '[]',
  jersey_no       TEXT,
  is_contact      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_members_reg ON registration_members(registration_id);

CREATE TABLE IF NOT EXISTS files (
  id            TEXT PRIMARY KEY,
  owner_type    TEXT NOT NULL CHECK (owner_type IN ('registration_member','ai_upload')),
  owner_id      TEXT NOT NULL,
  kind          TEXT,
  original_name TEXT NOT NULL,
  mime          TEXT NOT NULL,
  path          TEXT,
  size          INTEGER NOT NULL DEFAULT 0,
  uploaded_by   TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_type, owner_id);

CREATE TABLE IF NOT EXISTS event_groups (
  event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  group_name      TEXT NOT NULL,
  position        INTEGER NOT NULL,
  registration_id TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, group_name, registration_id)
);

CREATE TABLE IF NOT EXISTS matches (
  id               TEXT PRIMARY KEY,
  event_id         TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_a_id        TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  team_b_id        TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  stage            TEXT NOT NULL DEFAULT 'group' CHECK (stage IN ('group','knockout')),
  group_name       TEXT NOT NULL DEFAULT '',
  knockout_round   TEXT NOT NULL DEFAULT '',
  match_date       TEXT NOT NULL,
  start_time       TEXT NOT NULL,
  venue            TEXT NOT NULL,
  referee          TEXT,
  assistant1       TEXT,
  assistant2       TEXT,
  fourth_official  TEXT,
  match_supervisor TEXT NOT NULL DEFAULT '',
  photographer     TEXT NOT NULL DEFAULT '',
  videographer     TEXT NOT NULL DEFAULT '',
  commentator      TEXT NOT NULL DEFAULT '',
  reporter         TEXT NOT NULL DEFAULT '',
  special_note     TEXT NOT NULL DEFAULT '',
  referee_list     TEXT DEFAULT '[]',
  lineup_a         TEXT NOT NULL DEFAULT '{"starting":[],"substitutes":[]}',
  lineup_b         TEXT NOT NULL DEFAULT '{"starting":[],"substitutes":[]}',
  status           TEXT NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled','finished')),
  score_a          INTEGER NOT NULL DEFAULT 0,
  score_b          INTEGER NOT NULL DEFAULT 0,
  finished_by      TEXT REFERENCES users(id),
  finished_at      TEXT,
  created_by       TEXT NOT NULL REFERENCES users(id),
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matches_event_date
  ON matches(event_id, match_date, start_time);

CREATE TABLE IF NOT EXISTS match_goals (
  id         TEXT PRIMARY KEY,
  match_id   TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  side       TEXT NOT NULL CHECK (side IN ('A','B')),
  player     TEXT NOT NULL,
  player_no  TEXT,
  goal_time  TEXT,
  is_penalty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS match_subs (
  id        TEXT PRIMARY KEY,
  match_id  TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team      TEXT NOT NULL,
  off_player TEXT NOT NULL,
  on_player  TEXT NOT NULL,
  off_no     TEXT,
  on_no      TEXT,
  sub_time   TEXT
);

CREATE TABLE IF NOT EXISTS match_cards (
  id        TEXT PRIMARY KEY,
  match_id  TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team      TEXT NOT NULL,
  player    TEXT NOT NULL,
  player_no TEXT,
  card_type TEXT NOT NULL CHECK (card_type IN ('yellow','red')),
  card_time TEXT
);

-- 停赛台账（全人工维护；status: pending 下一轮停赛 / served 已完成停赛 / void 已失效）
CREATE TABLE IF NOT EXISTS player_suspensions (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  registration_id TEXT REFERENCES registrations(id) ON DELETE CASCADE,
  team_name       TEXT NOT NULL,
  player          TEXT NOT NULL,
  player_no       TEXT,
  reason          TEXT NOT NULL DEFAULT 'red_card'
                  CHECK (reason IN ('red_card','yellow_accumulation','other')),
  matches_suspended INTEGER NOT NULL DEFAULT 1,
  note            TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','served','void')),
  cleared_yellow  INTEGER NOT NULL DEFAULT 0,
  created_by      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_susp_event ON player_suspensions(event_id);

-- 已上线库的增量迁移（新库执行上面建表语句即可）
ALTER TABLE player_suspensions ADD COLUMN IF NOT EXISTS matches_suspended INTEGER NOT NULL DEFAULT 1;
ALTER TABLE player_suspensions DROP CONSTRAINT IF EXISTS player_suspensions_reason_check;
ALTER TABLE player_suspensions ADD CONSTRAINT player_suspensions_reason_check
  CHECK (reason IN ('red_card','yellow_accumulation','other'));

CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id),
  phone      TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  detail     TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL
);

-- =============================================================
-- Supabase RLS 示例（生产建议补全 event_staff 判断）
-- =============================================================
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY events_read_all ON events
  FOR SELECT USING (true);

CREATE POLICY events_write_admin ON events
  FOR ALL USING (
    (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY registration_read_scoped ON registrations
  FOR SELECT USING (
    created_by = auth.uid() OR
    (SELECT role FROM users WHERE id = auth.uid()) IN ('admin','data_operator')
  );
