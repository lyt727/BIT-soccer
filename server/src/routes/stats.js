import { authUser, loadEvent, audit, clientIp } from '../helpers.js';
import { getDb } from '../db.js';
import { computeStandings, computeGroupStandings, computeScorers, computeCardStats } from '../stats.js';
import { sendJson, readJson } from '../http.js';
import { requireAction } from '../rbac.js';
import { uid, nowIso } from '../config.js';
import { badRequest, notFound } from '../errors.js';

const REASONS = ['red_card', 'yellow_accumulation'];
const SUSP_STATUS = ['pending', 'served', 'void'];

// 该球员当前累计黄牌数 = 总黄牌数 - 已执行停赛写入的清零值
async function currentYellows(db, eventId, registrationId, player, excludeId = null) {
  const total = await db.get(
    `SELECT COUNT(*) AS n FROM match_cards c
       JOIN matches m ON m.id = c.match_id
       JOIN registrations r ON r.event_id = m.event_id AND r.team_name = c.team
      WHERE m.event_id = ? AND c.card_type = 'yellow'
        AND r.id = ? AND c.player = ?`,
    [eventId, registrationId, player],
  );
  const cleared = await db.get(
    `SELECT COALESCE(SUM(cleared_yellow), 0) AS n FROM player_suspensions
      WHERE event_id = ? AND status = 'served'
        AND registration_id = ? AND player = ? AND id <> ?`,
    [eventId, registrationId, player, excludeId || ''],
  );
  return Math.max(0, Number(total?.n || 0) - Number(cleared?.n || 0));
}

export function registerStatsRoutes(router) {
  router.add('GET', '/api/events/:id/standings', async (req, res, params) => {
    await authUser(req);
    const db = getDb();
    await loadEvent(db, params.id);
    sendJson(res, 200, computeStandings(db, params.id));
  });

  router.add('GET', '/api/events/:id/standings-by-group', async (req, res, params) => {
    await authUser(req);
    const db = getDb();
    await loadEvent(db, params.id);
    sendJson(res, 200, computeGroupStandings(db, params.id));
  });

  router.add('GET', '/api/events/:id/scorers', async (req, res, params) => {
    await authUser(req);
    const db = getDb();
    await loadEvent(db, params.id);
    sendJson(res, 200, computeScorers(db, params.id));
  });

  router.add('GET', '/api/events/:id/staff-stats', async (req, res, params) => {
    await authUser(req);
    const db = getDb();
    await loadEvent(db, params.id);
    const matches = await db.all('SELECT * FROM matches WHERE event_id = ?', [params.id]);
    const REF_ROLES = [
      ['referee', '主裁判'],
      ['assistant1', '第一助理裁判'],
      ['assistant2', '第二助理裁判'],
      ['fourth_official', '第四官员'],
    ];
    const STAFF_ROLES = [
      ['match_supervisor', '比赛监督'],
      ['photographer', '拍照'],
      ['videographer', '录像'],
      ['commentator', '解说'],
      ['reporter', '战报'],
    ];
    const collect = (defs) => {
      const map = new Map();
      for (const m of matches) {
        for (const [col] of defs) {
          const name = String(m[col] || '').trim();
          if (!name) continue;
          if (!map.has(name)) map.set(name, 0);
          map.set(name, map.get(name) + 1);
        }
      }
      return map;
    };
    const rowsFor = (defs) => {
      const rows = [];
      for (const [col, label] of defs) {
        const map = collect([[col, label]]);
        const list = [...map.entries()]
          .map(([name, matchesCount]) => ({ name, matches: matchesCount }))
          .sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name, 'zh-Hans-CN'));
        for (const item of list) rows.push({ role: label, ...item });
      }
      return rows;
    };
    sendJson(res, 200, {
      referees: rowsFor(REF_ROLES),
      staff: rowsFor(STAFF_ROLES),
    });
  });

  // 红黄牌榜 + 停赛台账（球员与管理员都只读；写操作见下面三个接口）
  router.add('GET', '/api/events/:id/card-stats', async (req, res, params) => {
    await authUser(req);
    const db = getDb();
    const event = await loadEvent(db, params.id);
    sendJson(res, 200, computeCardStats(db, params.id, event.yellow_suspension_threshold));
  });

  // 登记停赛（仅管理员）
  router.add('POST', '/api/events/:id/suspensions', async (req, res, params) => {
    const user = await authUser(req);
    requireAction(user, 'suspension.manage');
    const db = getDb();
    const event = await loadEvent(db, params.id);
    const body = await readJson(req);

    const reason = String(body.reason || 'red_card');
    if (!REASONS.includes(reason)) throw badRequest('停赛类型不合法');
    const player = String(body.player || '').trim();
    if (!player) throw badRequest('请选择球员');

    let registrationId = String(body.registrationId || '').trim();
    let teamName = String(body.teamName || '').trim();
    if (registrationId) {
      const reg = await db.get(
        'SELECT id, team_name FROM registrations WHERE id = ? AND event_id = ?',
        [registrationId, event.id],
      );
      if (!reg) throw badRequest('球队不存在');
      teamName = reg.team_name;
    } else if (teamName) {
      const reg = await db.get(
        'SELECT id, team_name FROM registrations WHERE event_id = ? AND team_name = ?',
        [event.id, teamName],
      );
      if (!reg) throw badRequest('球队不存在');
      registrationId = reg.id;
    } else {
      throw badRequest('请选择球队');
    }

    const dup = await db.get(
      `SELECT id FROM player_suspensions
        WHERE event_id = ? AND registration_id = ? AND player = ? AND status = 'pending'`,
      [event.id, registrationId, player],
    );
    if (dup) throw badRequest('该球员已有一条“下一轮停赛”记录');

    const id = uid('sus_');
    await db.run(
      `INSERT INTO player_suspensions
         (id, event_id, registration_id, team_name, player, player_no, reason, note,
          status, cleared_yellow, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
      [id, event.id, registrationId, teamName, player,
        String(body.playerNo || '').trim() || null, reason,
        String(body.note || '').trim() || null, user.id, nowIso()],
    );
    await audit(db, user, 'suspension.create', 'player_suspension', id,
      { player, teamName, reason }, clientIp(req));
    sendJson(res, 201, { id, message: '已登记停赛（下一轮停赛）' });
  });

  // 更新停赛：标记“已完成停赛”时会写入清零值，实现累计黄牌归零
  router.add('PATCH', '/api/suspensions/:sid', async (req, res, params) => {
    const user = await authUser(req);
    requireAction(user, 'suspension.manage');
    const db = getDb();
    const row = await db.get('SELECT * FROM player_suspensions WHERE id = ?', [params.sid]);
    if (!row) throw notFound('停赛记录不存在');
    const body = await readJson(req);

    const updates = [];
    const args = [];
    if (body.note !== undefined) {
      updates.push('note = ?');
      args.push(String(body.note || '').trim() || null);
    }
    if (body.player) {
      updates.push('player = ?');
      args.push(String(body.player).trim());
    }
    if (body.playerNo !== undefined) {
      updates.push('player_no = ?');
      args.push(String(body.playerNo || '').trim() || null);
    }

    let cleared = Number(row.cleared_yellow || 0);
    if (body.status) {
      const status = String(body.status);
      if (!SUSP_STATUS.includes(status)) throw badRequest('停赛状态不合法');
      updates.push('status = ?');
      args.push(status);
      if (status === 'served') {
        // 把该球员当前累计黄牌数固定下来，作为清零值
        cleared = await currentYellows(db, row.event_id, row.registration_id, row.player, row.id);
      } else {
        cleared = 0;
      }
      updates.push('cleared_yellow = ?');
      args.push(cleared);
    }

    if (!updates.length) throw badRequest('没有需要更新的内容');
    updates.push('updated_at = ?');
    args.push(nowIso());
    await db.run(`UPDATE player_suspensions SET ${updates.join(', ')} WHERE id = ?`,
      [...args, row.id]);
    await audit(db, user, 'suspension.update', 'player_suspension', row.id,
      { status: body.status || row.status, clearedYellow: cleared }, clientIp(req));
    sendJson(res, 200, {
      message: body.status === 'served' ? '已标记为完成停赛，累计黄牌已清零' : '已保存',
      clearedYellow: cleared,
    });
  });

  // 删除停赛记录（误登记时用）
  router.add('DELETE', '/api/suspensions/:sid', async (req, res, params) => {
    const user = await authUser(req);
    requireAction(user, 'suspension.manage');
    const db = getDb();
    const row = await db.get('SELECT * FROM player_suspensions WHERE id = ?', [params.sid]);
    if (!row) throw notFound('停赛记录不存在');
    await db.run('DELETE FROM player_suspensions WHERE id = ?', [row.id]);
    await audit(db, user, 'suspension.delete', 'player_suspension', row.id,
      { player: row.player, teamName: row.team_name }, clientIp(req));
    sendJson(res, 200, { message: '已删除停赛记录' });
  });
}
