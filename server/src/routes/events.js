import fs from 'node:fs';
import { authUser, audit, clientIp, loadEvent } from '../helpers.js';
import { getDb } from '../db.js';
import { requireAction, assertEventScope } from '../rbac.js';
import { nowIso, uid } from '../config.js';
import { readJson, sendJson } from '../http.js';
import { badRequest, notFound, forbidden } from '../errors.js';

const EVENT_STATUS = ['pending', 'signup', 'live', 'ended'];
const STATUS_TEXT = { pending: '待开始', signup: '报名中', live: '进行中', ended: '已结束' };

async function staffRoleOf(db, user, eventId) {
  if (user.role === 'admin') return 'admin';
  const row = await db.get(
    'SELECT event_role FROM event_staff WHERE event_id = ? AND user_id = ?',
    [eventId, user.id],
  );
  return row ? row.event_role : null;
}

async function eventView(db, event, user) {
  const reg = await db.get(
    `SELECT
       SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) AS approved,
       SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) AS rejected,
       COUNT(*) AS total
     FROM registrations WHERE event_id = ?`,
    [event.id],
  );
  const mt = await db.get(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN status='finished' THEN 1 ELSE 0 END) AS finished
     FROM matches WHERE event_id = ?`,
    [event.id],
  );
  const groups = await db.get(
    'SELECT COUNT(DISTINCT group_name) AS c FROM event_groups WHERE event_id = ?',
    [event.id],
  );
  return {
    ...event,
    statusText: STATUS_TEXT[event.status] || event.status,
    approvedTeams: reg.approved || 0,
    pendingRegistrations: reg.pending || 0,
    rejectedTeams: reg.rejected || 0,
    totalRegistrations: reg.total || 0,
    totalMatches: mt.total || 0,
    finishedMatches: mt.finished || 0,
    groupCount: groups.c || 0,
    staffRole: await staffRoleOf(db, user, event.id),
  };
}

export function registerEventRoutes(router) {
  router.add('GET', '/api/events', async (req, res) => {
    const user = await authUser(req);
    const db = getDb();
    const rows = await db.all('SELECT * FROM events ORDER BY created_at DESC');
    const list = [];
    for (const ev of rows) list.push(await eventView(db, ev, user));
    sendJson(res, 200, list);
  });

  router.add('POST', '/api/events', async (req, res) => {
    const user = await authUser(req);
    requireAction(user, 'event.create');
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    const season = String(body.season || '').trim();
    const description = String(body.description || '').trim();
    if (!name) throw badRequest('请填写赛事名称');
    if (!/^\d{4}$/.test(season)) throw badRequest('赛季年份需为 4 位数字，如 2026');
    const db = getDb();
    const id = uid('evt_');
    const now = nowIso();
    await db.run(
      `INSERT INTO events (id, name, season, description, status, created_by, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      [id, name, season, description, user.id, now],
    );
    if (user.role === 'admin') {
      await db.run(
        `INSERT INTO event_staff (event_id, user_id, event_role, assigned_by, created_at)
         VALUES (?, ?, 'admin', ?, ?)`,
        [id, user.id, user.id, now],
      );
    }
    await audit(db, user, 'event.create', 'event', id, { name, season }, clientIp(req));
    const created = await db.get('SELECT * FROM events WHERE id = ?', [id]);
    sendJson(res, 201, await eventView(db, created, user));
  });

  router.add('GET', '/api/events/:id', async (req, res, params) => {
    const user = await authUser(req);
    const db = getDb();
    const event = await loadEvent(db, params.id);
    sendJson(res, 200, await eventView(db, event, user));
  });

  router.add('PATCH', '/api/events/:id/status', async (req, res, params) => {
    const user = await authUser(req);
    requireAction(user, 'event.status.update');
    const db = getDb();
    const event = await loadEvent(db, params.id);
    await assertEventScope(db, user, 'event.status.update', event.id);
    const body = await readJson(req);
    const next = body.status;
    if (!EVENT_STATUS.includes(next)) throw badRequest('赛事状态不合法');
    await db.run('UPDATE events SET status = ? WHERE id = ?', [next, event.id]);
    await audit(db, user, 'event.status', 'event', event.id,
      { from: event.status, to: next }, clientIp(req));
    sendJson(res, 200, { message: '状态已更新', status: next, statusText: STATUS_TEXT[next] });
  });

  router.add('PATCH', '/api/events/:id', async (req, res, params) => {
    const user = await authUser(req);
    requireAction(user, 'event.status.update');
    const db = getDb();
    const event = await loadEvent(db, params.id);
    await assertEventScope(db, user, 'event.status.update', event.id);
    const body = await readJson(req);
    const name = String(body.name || '').trim() || event.name;
    const season = String(body.season || '').trim() || event.season;
    const description = body.description !== undefined
      ? String(body.description).trim() : event.description;
    if (!/^\d{4}$/.test(season)) throw badRequest('赛季年份需为 4 位数字');
    await db.run(
      'UPDATE events SET name = ?, season = ?, description = ? WHERE id = ?',
      [name, season, description, event.id],
    );
    await audit(db, user, 'event.update', 'event', event.id, { name, season }, clientIp(req));
    const fresh = await db.get('SELECT * FROM events WHERE id = ?', [event.id]);
    sendJson(res, 200, await eventView(db, fresh, user));
  });

  router.add('DELETE', '/api/events/:id', async (req, res, params) => {
    const user = await authUser(req);
    requireAction(user, 'event.delete');
    const db = getDb();
    const event = await loadEvent(db, params.id);
    const regs = await db.all('SELECT id FROM registrations WHERE event_id = ?', [event.id]);
    const regIds = regs.map((r) => r.id);
    const members = regIds.length
      ? await db.all(
        `SELECT id FROM registration_members WHERE registration_id IN (${regIds.map(() => '?').join(',')})`,
        regIds,
      )
      : [];
    for (const m of members) {
      const files = await db.all(
        "SELECT * FROM files WHERE owner_type = 'registration_member' AND owner_id = ?",
        [m.id],
      );
      for (const f of files) {
        if (f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path);
        await db.run('DELETE FROM files WHERE id = ?', [f.id]);
      }
    }
    await db.run('DELETE FROM events WHERE id = ?', [event.id]);
    await audit(db, user, 'event.delete', 'event', event.id,
      { name: event.name, cascade: true }, clientIp(req));
    sendJson(res, 200, { message: '赛事及其报名、名单材料、分组、赛程、统计数据已删除' });
  });

  // ---------------- 赛事工作人员指派 ----------------
  router.add('GET', '/api/events/:id/staff', async (req, res, params) => {
    const user = await authUser(req);
    const db = getDb();
    const event = await loadEvent(db, params.id);
    if (user.role === 'admin' || (await staffRoleOf(db, user, event.id))) {
      const rows = await db.all(
        `SELECT u.id, u.name, u.phone, u.emp_id, es.event_role AS event_role, es.created_at
           FROM event_staff es JOIN users u ON u.id = es.user_id
          WHERE es.event_id = ? ORDER BY es.created_at`,
        [event.id],
      );
      sendJson(res, 200, rows);
      return;
    }
    throw forbidden();
  });

  router.add('POST', '/api/events/:id/staff', async (req, res, params) => {
    const user = await authUser(req);
    requireAction(user, 'staff.manage');
    const db = getDb();
    const event = await loadEvent(db, params.id);
    const body = await readJson(req);
    const phone = String(body.phone || '').trim();
    const eventRole = body.eventRole;
    if (!['data_operator'].includes(eventRole)) {
      throw badRequest('赛事内可指派角色为数据录入员（管理员自动拥有全部赛事权限）');
    }
    const target = await db.get('SELECT * FROM users WHERE phone = ?', [phone]);
    if (!target) throw notFound('用户不存在，请先在“成员管理”中创建该账号');
    if (target.role !== 'data_operator') {
      throw badRequest('赛事数据录入员指派需要账号角色为“数据录入员”');
    }
    const dup = await db.get(
      'SELECT 1 FROM event_staff WHERE event_id = ? AND user_id = ?',
      [event.id, target.id],
    );
    if (dup) throw badRequest('该成员已在赛事工作人员中');
    await db.run(
      `INSERT INTO event_staff (event_id, user_id, event_role, assigned_by, created_at)
       VALUES (?, ?, 'data_operator', ?, ?)`,
      [event.id, target.id, user.id, nowIso()],
    );
    await audit(db, user, 'event.staff.add', 'event', event.id,
      { phone, eventRole }, clientIp(req));
    sendJson(res, 201, { message: `已将 ${target.name} 加入赛事数据录入` });
  });

  router.add('DELETE', '/api/events/:id/staff/:userId', async (req, res, params) => {
    const user = await authUser(req);
    requireAction(user, 'staff.manage');
    const db = getDb();
    const event = await loadEvent(db, params.id);
    await db.run(
      'DELETE FROM event_staff WHERE event_id = ? AND user_id = ?',
      [event.id, params.userId],
    );
    await audit(db, user, 'event.staff.remove', 'event', event.id,
      { userId: params.userId }, clientIp(req));
    sendJson(res, 200, { message: '已移除' });
  });
}
