import crypto from 'node:crypto';
import { authUser, audit, clientIp, loadEvent } from '../helpers.js';
import { getDb } from '../db.js';
import { requireAction, assertEventScope } from '../rbac.js';
import { nowIso } from '../config.js';
import { uid } from '../config.js';
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

// 单循环轮转法（Berger 表）：n 支球队生成 n-1 轮（奇数补一支轮空）
function roundRobin(teams) {
  const arr = [...teams];
  if (arr.length % 2 === 1) arr.push(null); // 轮空
  const n = arr.length;
  const rounds = [];
  for (let r = 0; r < n - 1; r += 1) {
    const pairs = [];
    for (let i = 0; i < n / 2; i += 1) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a && b) pairs.push([a, b]);
    }
    rounds.push(pairs);
    arr.splice(1, 0, arr.pop()); // 固定第一支，其余轮转
  }
  return rounds;
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
    // 报名结束后（状态为「进行中」）才能抽签；与添加比赛互不依赖、无先后要求
    if (event.status !== 'live') {
      throw badRequest('报名结束后（赛事状态为「进行中」）才能抽签编排');
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

    // 纯淘汰赛没有抽签
    if (event.format === 'knockout') {
      throw badRequest('当前赛事为纯淘汰赛赛制，对阵在赛程安排里手动添加');
    }

    // 单循环联赛：抽签生成全部对阵并分配到各轮
    if (event.format === 'league') {
      const total = await db.get(
        'SELECT COUNT(*) AS n FROM matches WHERE event_id = ?', [event.id],
      );
      if (total.n > 0) {
        if (!body.replace) {
          throw badRequest('该赛事已有赛程，如需重新抽签请先删除现有比赛');
        }
        const finished = await db.get(
          "SELECT COUNT(*) AS n FROM matches WHERE event_id = ? AND status = 'finished'",
          [event.id],
        );
        if (finished.n > 0) throw badRequest('已有比赛录入结果，不能重新抽签');
        await db.run('DELETE FROM matches WHERE event_id = ?', [event.id]);
      }
      const teams = shuffle(approved);
      const rounds = roundRobin(teams);
      let created = 0;
      for (let r = 0; r < rounds.length; r += 1) {
        for (const [a, b] of rounds[r]) {
          await db.run(
            `INSERT INTO matches
              (id, event_id, team_a_id, team_b_id, stage, group_name, knockout_round, round_name,
               match_date, start_time, venue, status, created_by, created_at)
             VALUES (?, ?, ?, ?, 'group', '', '', ?, '', '', '', 'scheduled', ?, ?)`,
            [uid('mt_'), event.id, a.id, b.id, `第${r + 1}轮`, user.id, nowIso()],
          );
          created += 1;
        }
      }
      await audit(db, user, 'league.draw', 'event', event.id,
        { teams: teams.length, rounds: rounds.length, matches: created }, clientIp(req));
      sendJson(res, 200, {
        message: `单循环抽签完成：${teams.length} 支球队，${rounds.length} 轮共 ${created} 场`,
        rounds: rounds.length,
        matchCount: created,
      });
      return;
    }

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
