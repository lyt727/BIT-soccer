import crypto from 'node:crypto';
import { authUser, audit, clientIp, loadEvent } from '../helpers.js';
import { getDb } from '../db.js';
import { requireAction, assertEventScope } from '../rbac.js';
import { nowIso } from '../config.js';
import { readJson, sendJson } from '../http.js';
import { badRequest, notFound } from '../errors.js';

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export async function getGroups(db, eventId) {
  const rows = await db.all(
    `SELECT eg.group_name, eg.position, eg.registration_id, r.team_name
       FROM event_groups eg
       JOIN registrations r ON r.id = eg.registration_id
      WHERE eg.event_id = ?
      ORDER BY eg.group_name, eg.position`,
    [eventId],
  );
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.group_name)) map.set(row.group_name, []);
    map.get(row.group_name).push({
      registrationId: row.registration_id,
      teamName: row.team_name,
    });
  }
  return [...map.entries()].map(([groupName, teams]) => ({ groupName, teams }));
}

export function registerGroupRoutes(router) {
  router.add('GET', '/api/events/:id/groups', async (req, res, params) => {
    const user = await authUser(req);
    const db = getDb();
    const event = await loadEvent(db, params.id);
    sendJson(res, 200, { eventId: event.id, groups: await getGroups(db, event.id) });
  });

  router.add('POST', '/api/events/:id/draw', async (req, res, params) => {
    const user = await authUser(req);
    requireAction(user, 'draw.groups');
    const db = getDb();
    const event = await loadEvent(db, params.id);
    await assertEventScope(db, user, 'draw.groups', event.id);
    if (!['signup', 'live'].includes(event.status)) {
      throw badRequest('当前赛事状态不允许抽签（需为报名中或进行中）');
    }
    const approved = await db.all(
      `SELECT id, team_name FROM registrations
        WHERE event_id = ? AND status = 'approved' ORDER BY team_name`,
      [event.id],
    );
    if (approved.length < 2) {
      throw badRequest('已通过球队不足 2 支，暂不能抽签');
    }
    const body = await readJson(req);
    const groupCount = Number(body.groupCount);
    if (![2, 3, 4, 6].includes(groupCount)) {
      throw badRequest('小组数量可选 2 / 3 / 4 / 6');
    }
    const minPerGroup = Math.ceil(approved.length / groupCount);
    let maxPerGroup = body.maxPerGroup === undefined || body.maxPerGroup === null
      ? minPerGroup : Number(body.maxPerGroup);
    if (!Number.isInteger(maxPerGroup) || maxPerGroup < minPerGroup || maxPerGroup > 8) {
      throw badRequest(`每组球队数上限需在 ${minPerGroup} 到 8 之间（含）`);
    }
    const teamIds = shuffle(approved);
    // 轮转分配：随机洗牌后蛇形/循环放入小组，保证组间差 ≤ 1
    const buckets = Array.from({ length: groupCount }, () => []);
    teamIds.forEach((team, i) => buckets[i % groupCount].push(team));
    await db.run('DELETE FROM event_groups WHERE event_id = ?', [event.id]);
    const names = 'ABCDEFGHIJ';
    const ins = [];
    buckets.forEach((teams, gi) => {
      teams.forEach((team, ti) => {
        ins.push([event.id, names[gi], ti, team.id]);
      });
    });
    for (const row of ins) {
      await db.run(
        `INSERT INTO event_groups (event_id, group_name, position, registration_id)
         VALUES (?, ?, ?, ?)`,
        row,
      );
    }
    await audit(db, user, 'groups.draw', 'event', event.id,
      { groupCount, approvedCount: approved.length, redraw: true }, clientIp(req));
    sendJson(res, 200, {
      message: `抽签完成，共 ${approved.length} 支球队分为 ${groupCount} 组`,
      groups: await getGroups(db, event.id),
    });
  });
}
