import { authUser, audit, clientIp, loadEvent, loadMatch } from '../helpers.js';
import { getDb } from '../db.js';
import { requireAction, assertEventScope } from '../rbac.js';
import { nowIso, uid } from '../config.js';
import { readJson, sendJson } from '../http.js';
import { badRequest, notFound, forbidden } from '../errors.js';

async function teamNameOf(db, regId) {
  const r = await db.get('SELECT team_name FROM registrations WHERE id = ?', [regId]);
  return r ? r.team_name : '未知球队';
}

function parsePlayer(v) {
  if (!v) return null;
  if (typeof v === 'object') {
    const name = String(v.name || v.player || '').trim();
    const no = String(v.no ?? v.number ?? '').trim();
    return name ? { no, name } : null;
  }
  const text = String(v).trim();
  const m = /^(?:#?\s*)?(\d{1,3})[\s.、\-·]+(.+)$/.exec(text);
  return m ? { no: m[1], name: m[2].trim() } : { no: '', name: text };
}

function parseLineupJson(text) {
  try {
    const v = JSON.parse(text || '{"color":"","starting":[],"substitutes":[]}');
    return {
      color: String(v.color || '').trim(),
      starting: Array.isArray(v.starting) ? v.starting.map(parsePlayer).filter(Boolean) : [],
      substitutes: Array.isArray(v.substitutes) ? v.substitutes.map(parsePlayer).filter(Boolean) : [],
    };
  } catch {
    return { color: '', starting: [], substitutes: [] };
  }
}

function minuteOf(time) {
  const n = parseInt(String(time || '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : 999;
}

async function detailsOfMatch(db, m) {
  const goals = await db.all(
    `SELECT id, side, player, player_no, goal_time, is_penalty FROM match_goals
      WHERE match_id = ? ORDER BY id`,
    [m.id],
  );
  const subs = await db.all(
    `SELECT id, team, off_player, on_player, off_no, on_no, sub_time FROM match_subs
      WHERE match_id = ? ORDER BY id`,
    [m.id],
  );
  const cards = await db.all(
    `SELECT id, team, player, player_no, card_type, card_time FROM match_cards
      WHERE match_id = ? ORDER BY id`,
    [m.id],
  );
  let refereeList = [];
  try { refereeList = JSON.parse(m.referee_list || '[]'); } catch { refereeList = []; }
  const refereeFour = [m.referee, m.assistant1, m.assistant2, m.fourth_official].filter(Boolean);
  if (refereeFour.length) refereeList = refereeFour;
  const lineupA = parseLineupJson(m.lineup_a);
  const lineupB = parseLineupJson(m.lineup_b);
  const teamAName = await teamNameOf(db, m.team_a_id);
  const teamBName = await teamNameOf(db, m.team_b_id);
  const timeline = [
    ...goals.map((g) => ({
      type: 'goal',
      minute: minuteOf(g.goal_time),
      time: g.goal_time || '',
      team: g.side === 'A' ? teamAName : teamBName,
      side: g.side,
      no: g.player_no || '',
      player: g.player,
      penalty: Boolean(g.is_penalty),
    })),
    ...subs.map((s) => ({
      type: 'sub',
      minute: minuteOf(s.sub_time),
      time: s.sub_time || '',
      team: s.team,
      offNo: s.off_no || '',
      offPlayer: s.off_player,
      onNo: s.on_no || '',
      onPlayer: s.on_player,
    })),
    ...cards.map((c) => ({
      type: c.card_type === 'red' ? 'red_card' : 'yellow_card',
      minute: minuteOf(c.card_time),
      time: c.card_time || '',
      team: c.team,
      no: c.player_no || '',
      player: c.player,
    })),
  ].sort((a, b) => a.minute - b.minute);
  return {
    id: m.id,
    eventId: m.event_id,
    teamA: { registrationId: m.team_a_id, name: teamAName },
    teamB: { registrationId: m.team_b_id, name: teamBName },
    stage: m.stage || 'group',
    groupName: m.group_name || '',
    knockoutRound: m.knockout_round || '',
    roundName: m.round_name || '',
    date: m.match_date,
    time: m.start_time,
    venue: m.venue,
    referee: m.referee,
    assistant1: m.assistant1 || '',
    assistant2: m.assistant2 || '',
    fourthOfficial: m.fourth_official || '',
    matchStaff: {
      supervisor: m.match_supervisor || '',
      photographer: m.photographer || '',
      videographer: m.videographer || '',
      commentator: m.commentator || '',
      reporter: m.reporter || '',
    },
    specialNote: m.special_note || '',
    refereeList,
    status: m.status,
    scoreA: m.score_a,
    scoreB: m.score_b,
    finishedAt: m.finished_at,
    goals,
    substitutions: subs,
    cards,
    lineups: { A: lineupA, B: lineupB },
    timeline,
    summary: {
      yellowCards: cards.filter((c) => c.card_type === 'yellow').length,
      redCards: cards.filter((c) => c.card_type === 'red').length,
      substitutions: subs.length,
    },
  };
}

function cleanLineup(v) {
  const arr = (x) => {
    const list = Array.isArray(x) ? x
      : (typeof x === 'string' ? x.split(/[\n,，、;；]+/) : []);
    return list.map(parsePlayer).filter(Boolean);
  };
  return {
    color: String(v?.color || '').trim(),
    starting: arr(v?.starting),
    substitutes: arr(v?.substitutes),
  };
}

const KNOCKOUT_ROUNDS = ['1/8决赛', '1/4决赛', '半决赛', '三四名决赛', '决赛'];

function validateSchedule(body, partial = false, format = 'group_knockout') {
  const teamAId = partial ? null : String(body.teamAId || '');
  const teamBId = partial ? null : String(body.teamBId || '');
  // 赛制决定比赛归属：纯联赛全部是联赛场次，纯淘汰赛全部是淘汰赛场次
  let stage = body.stage === 'knockout' ? 'knockout' : 'group';
  if (format === 'league') stage = 'group';
  if (format === 'knockout') stage = 'knockout';
  const groupName = String(body.groupName || '').trim().toUpperCase();
  const knockoutRound = String(body.knockoutRound || '').trim();
  const roundName = String(body.roundName || '').trim().slice(0, 20);
  const date = String(body.date || '');
  const time = String(body.time || '');
  const venue = String(body.venue || '').trim();
  const referee = String(body.referee || '').trim();
  const assistant1 = String(body.assistant1 || '').trim();
  const assistant2 = String(body.assistant2 || '').trim();
  const fourthOfficial = String(body.fourthOfficial || '').trim();
  const specialNote = String(body.specialNote || '').trim();
  if (partial) {
    if (body.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('日期格式应为 YYYY-MM-DD');
    if (body.time !== undefined && !/^\d{2}:\d{2}$/.test(time)) throw badRequest('时间格式应为 HH:mm');
  } else {
    if (!teamAId || !teamBId) throw badRequest('请选择对阵双方球队');
    if (teamAId === teamBId) throw badRequest('主队与客队不能相同');
    // 只有阶段、轮次、主客队必填；日期/时间/场地/裁判等均为选填
    // 小组分组仅对「小组赛+淘汰赛」赛制必填；纯联赛没有分组
    if (stage === 'group' && format === 'group_knockout' && !/^[A-F]$/.test(groupName)) {
      throw badRequest('小组赛请选择小组（A-F）');
    }
    if (stage === 'knockout' && !knockoutRound) {
      throw badRequest(`请选择或填写淘汰赛轮次（${KNOCKOUT_ROUNDS.join(' / ')}，也可自定义）`);
    }
  }
  return {
    teamAId, teamBId, date, time, venue, referee,
    assistant1, assistant2, fourthOfficial, specialNote,
    stage, groupName, knockoutRound, roundName,
  };
}

export function registerMatchRoutes(router) {
  router.add('GET', '/api/events/:id/matches', async (req, res, params) => {
    const user = await authUser(req);
    const db = getDb();
    const event = await loadEvent(db, params.id);
    const rows = await db.all(
      `SELECT * FROM matches WHERE event_id = ?
        ORDER BY CASE stage WHEN 'group' THEN 0 ELSE 1 END, match_date ASC, start_time ASC`,
      [event.id],
    );
    const out = [];
    for (const m of rows) out.push(await detailsOfMatch(db, m));
    sendJson(res, 200, out);
  });

  router.add('POST', '/api/events/:id/matches', async (req, res, params) => {
    const user = await authUser(req);
    const db = getDb();
    const event = await loadEvent(db, params.id);
    if (event.status !== 'live') throw badRequest('仅“进行中”赛事可安排比赛，请先更新赛事状态');
    const body = await readJson(req);
    const stage = body.stage === 'knockout' ? 'knockout' : 'group';
    if (stage === 'knockout') {
      // 淘汰赛允许管理员与被指派的数据录入员添加，并选择轮次
      requireAction(user, 'result.record');
      await assertEventScope(db, user, 'result.record', event.id);
    } else {
      requireAction(user, 'match.manage');
      await assertEventScope(db, user, 'match.manage', event.id);
    }
    const s = validateSchedule(body, false, event.format);
    for (const rid of [s.teamAId, s.teamBId]) {
      const reg = await db.get(
        `SELECT 1 FROM registrations WHERE id = ? AND event_id = ? AND status = 'approved'`,
        [rid, event.id],
      );
      if (!reg) throw badRequest('对阵球队需为已通过审核的本赛事球队');
    }
    const id = uid('mt_');
    await db.run(
      `INSERT INTO matches
        (id, event_id, team_a_id, team_b_id, stage, group_name, knockout_round, round_name,
         match_date, start_time, venue, referee,
         assistant1, assistant2, fourth_official, special_note,
         lineup_a, lineup_b,
         status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`,
      [id, event.id, s.teamAId, s.teamBId, s.stage, s.groupName, s.knockoutRound,
        s.roundName, s.date, s.time, s.venue, s.referee,
        s.assistant1, s.assistant2, s.fourthOfficial, s.specialNote,
        JSON.stringify(cleanLineup(body.lineupA)),
        JSON.stringify(cleanLineup(body.lineupB)),
        user.id, nowIso()],
    );
    await audit(db, user, 'match.create', 'match', id,
      { eventId: event.id, date: s.date, time: s.time }, clientIp(req));
    const created = await db.get('SELECT * FROM matches WHERE id = ?', [id]);
    sendJson(res, 201, await detailsOfMatch(db, created));
  });

  router.add('PATCH', '/api/matches/:id', async (req, res, params) => {
    const user = await authUser(req);
    const db = getDb();
    const match = await loadMatch(db, params.id);
    if ((match.stage || 'group') === 'knockout') {
      requireAction(user, 'result.record');
      await assertEventScope(db, user, 'result.record', match.event_id);
    } else {
      requireAction(user, 'match.manage');
      await assertEventScope(db, user, 'match.manage', match.event_id);
    }
    const body = await readJson(req);
    const s = validateSchedule(body, true);
    const next = {};
    if (s.teamAId && s.teamBId) {
      if (s.teamAId === s.teamBId) throw badRequest('主队与客队不能相同');
      next.team_a_id = s.teamAId;
      next.team_b_id = s.teamBId;
    }
    if (s.date) next.match_date = s.date;
    if (s.time) next.start_time = s.time;
    if (body.venue !== undefined) next.venue = String(body.venue).trim();
    if (body.referee !== undefined) next.referee = String(body.referee).trim();
    if (body.assistant1 !== undefined) next.assistant1 = String(body.assistant1).trim();
    if (body.assistant2 !== undefined) next.assistant2 = String(body.assistant2).trim();
    if (body.fourthOfficial !== undefined) next.fourth_official = String(body.fourthOfficial).trim();
    if (body.specialNote !== undefined) next.special_note = String(body.specialNote).trim();
    if (body.groupName !== undefined && (match.stage || 'group') === 'group') {
      const g = String(body.groupName).trim().toUpperCase();
      if (!/^[A-F]$/.test(g)) throw badRequest('小组赛请选择小组（A-F）');
      next.group_name = g;
    }
    if (body.knockoutRound !== undefined && match.stage === 'knockout') {
      const r = String(body.knockoutRound).trim().slice(0, 20);
      if (!r) throw badRequest('请填写淘汰赛轮次');
      next.knockout_round = r;
    }
    if (body.roundName !== undefined) {
      next.round_name = String(body.roundName).trim().slice(0, 20);
    }
    if (body.lineupA !== undefined) next.lineup_a = JSON.stringify(cleanLineup(body.lineupA));
    if (body.lineupB !== undefined) next.lineup_b = JSON.stringify(cleanLineup(body.lineupB));
    const keys = Object.keys(next);
    if (!keys.length) throw badRequest('没有需要更新的字段');
    const sql = `UPDATE matches SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
    await db.run(sql, [...keys.map((k) => next[k]), match.id]);
    await audit(db, user, 'match.update', 'match', match.id,
      { eventId: match.event_id, changes: keys }, clientIp(req));
    const fresh = await db.get('SELECT * FROM matches WHERE id = ?', [match.id]);
    sendJson(res, 200, await detailsOfMatch(db, fresh));
  });

  router.add('DELETE', '/api/matches/:id', async (req, res, params) => {
    const user = await authUser(req);
    const db = getDb();
    const match = await loadMatch(db, params.id);
    if ((match.stage || 'group') === 'knockout') {
      requireAction(user, 'result.record');
      await assertEventScope(db, user, 'result.record', match.event_id);
    } else {
      requireAction(user, 'match.manage');
      await assertEventScope(db, user, 'match.manage', match.event_id);
    }
    const wasFinished = match.status === 'finished';
    await db.run('DELETE FROM matches WHERE id = ?', [match.id]);
    await audit(db, user, 'match.delete', 'match', match.id,
      { eventId: match.event_id, wasFinished }, clientIp(req));
    sendJson(res, 200, {
      message: wasFinished
        ? '比赛已删除，其比分与进球/换人/红黄牌统计已同步清理'
        : '比赛已删除',
    });
  });

  // 特殊情况说明（选填）：管理员 / 被指派的数据录入员均可编辑
  router.add('PATCH', '/api/matches/:id/note', async (req, res, params) => {
    const user = await authUser(req);
    requireAction(user, 'result.record');
    const db = getDb();
    const match = await loadMatch(db, params.id);
    await assertEventScope(db, user, 'result.record', match.event_id);
    const body = await readJson(req);
    const specialNote = String(body.specialNote ?? '').trim();
    await db.run('UPDATE matches SET special_note = ? WHERE id = ?', [specialNote, match.id]);
    await audit(db, user, 'match.note', 'match', match.id,
      { eventId: match.event_id, specialNote }, clientIp(req));
    const fresh = await db.get('SELECT * FROM matches WHERE id = ?', [match.id]);
    sendJson(res, 200, await detailsOfMatch(db, fresh));
  });

  // 裁判组之外的工作人员（比赛监督/拍照/录像/解说/战报），管理员与数据录入员可编辑
  router.add('PATCH', '/api/matches/:id/staff', async (req, res, params) => {
    const user = await authUser(req);
    requireAction(user, 'result.record');
    const db = getDb();
    const match = await loadMatch(db, params.id);
    await assertEventScope(db, user, 'result.record', match.event_id);
    const body = await readJson(req);
    const staff = body.matchStaff && typeof body.matchStaff === 'object' ? body.matchStaff : {};
    const val = (key) => String(staff[key] ?? '').trim().slice(0, 40);
    await db.run(
      `UPDATE matches
          SET match_supervisor = ?, photographer = ?, videographer = ?,
              commentator = ?, reporter = ?
        WHERE id = ?`,
      [val('supervisor'), val('photographer'), val('videographer'),
        val('commentator'), val('reporter'), match.id],
    );
    await audit(db, user, 'match.staff.update', 'match', match.id,
      { eventId: match.event_id, matchStaff: staff }, clientIp(req));
    const fresh = await db.get('SELECT * FROM matches WHERE id = ?', [match.id]);
    sendJson(res, 200, await detailsOfMatch(db, fresh));
  });

  // ---------------- 比赛结果录入（人工或 AI 复核后提交共用） ----------------
  router.add('POST', '/api/matches/:id/result', async (req, res, params) => {
    const user = await authUser(req);
    requireAction(user, 'result.record');
    const db = getDb();
    const match = await loadMatch(db, params.id);
    await assertEventScope(db, user, 'result.record', match.event_id);
    const event = await loadEvent(db, match.event_id);
    if (event.status === 'ended') throw badRequest('赛事已结束，结果已锁定');

    const body = await readJson(req);
    const scoreA = Number(body.scoreA);
    const scoreB = Number(body.scoreB);
    if (!Number.isInteger(scoreA) || scoreA < 0 || scoreA > 99) throw badRequest('主队进球数需为非负整数');
    if (!Number.isInteger(scoreB) || scoreB < 0 || scoreB > 99) throw badRequest('客队进球数需为非负整数');
    const goalsA = Array.isArray(body.goalsA) ? body.goalsA : [];
    const goalsB = Array.isArray(body.goalsB) ? body.goalsB : [];
    if (goalsA.length !== scoreA || goalsB.length !== scoreB) {
      throw badRequest('进球球员名单数量必须与进球数一致（每球一个输入框，可留空记“未登记”）');
    }
    const normGoals = (list, side) => list.map((g, idx) => ({
      side,
      no: String((g && (g.no ?? '')) || '').trim(),
      player: String((g && g.player) || '').trim() || `未登记`,
      time: String((g && g.time) || '').trim(),
      penalty: Boolean(g && g.penalty),
      sortKey: idx,
    }));
    const subs = Array.isArray(body.substitutions) ? body.substitutions : [];
    const cards = Array.isArray(body.cards) ? body.cards : [];
    const refereeList = Array.isArray(body.refereeList)
      ? body.refereeList.map((r) => String(r).trim()).filter(Boolean)
      : [];
    const refRoles = body.refereeRoles && typeof body.refereeRoles === 'object' ? body.refereeRoles : {};
    const mainReferee = String(refRoles.main || body.referee || match.referee || '').trim();
    const assistant1 = String(refRoles.assistant1 || match.assistant1 || '').trim();
    const assistant2 = String(refRoles.assistant2 || match.assistant2 || '').trim();
    const fourthOfficial = String(refRoles.fourth || match.fourth_official || '').trim();
    const subsOk = subs.every((s) => s && String(s.offPlayer || '').trim() && String(s.onPlayer || '').trim());
    const cardsOk = cards.every((c) => c && String(c.player || '').trim()
      && ['yellow', 'red'].includes(String(c.type || '')));
    if (!subsOk) throw badRequest('换人记录需同时填写下场与上场球员');
    if (!cardsOk) throw badRequest('红黄牌记录需包含球员与牌型（yellow/red）');
    const lineupAJson = body.lineupA !== undefined
      ? JSON.stringify(cleanLineup(body.lineupA)) : match.lineup_a;
    const lineupBJson = body.lineupB !== undefined
      ? JSON.stringify(cleanLineup(body.lineupB)) : match.lineup_b;

    await db.exec('BEGIN');
    try {
      await db.run('DELETE FROM match_goals WHERE match_id = ?', [match.id]);
      await db.run('DELETE FROM match_subs WHERE match_id = ?', [match.id]);
      await db.run('DELETE FROM match_cards WHERE match_id = ?', [match.id]);
      for (const g of [...normGoals(goalsA, 'A'), ...normGoals(goalsB, 'B')]) {
        await db.run(
          `INSERT INTO match_goals (id, match_id, side, player, player_no, goal_time, is_penalty)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [uid('g_'), match.id, g.side, g.player, g.no || null, g.time || null, g.penalty ? 1 : 0],
        );
      }
      for (const s of subs) {
        await db.run(
          `INSERT INTO match_subs (id, match_id, team, off_player, on_player, off_no, on_no, sub_time)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [uid('s_'), match.id, String(s.team || '').trim(),
            String(s.offPlayer).trim(), String(s.onPlayer).trim(),
            String(s.offNo ?? '').trim() || null,
            String(s.onNo ?? '').trim() || null,
            String(s.time || '').trim() || null],
        );
      }
      for (const c of cards) {
        await db.run(
          `INSERT INTO match_cards (id, match_id, team, player, player_no, card_type, card_time)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [uid('c_'), match.id, String(c.team || '').trim(),
            String(c.player).trim(), String(c.no ?? '').trim() || null, String(c.type),
            String(c.time || '').trim() || null],
        );
      }
      // 红牌至少停赛一轮：自动登记一条「下一轮停赛」，避免红牌榜状态空着。
      // 该球员若已有待执行记录则跳过；已执行过的旧记录不影响新停赛。
      for (const c of cards.filter((x) => x.type === 'red')) {
        const cardTeam = String(c.team || '').trim();
        const cardPlayer = String(c.player).trim();
        if (!cardTeam || !cardPlayer) continue;
        const reg = await db.get(
          'SELECT id, team_name FROM registrations WHERE event_id = ? AND team_name = ?',
          [match.event_id, cardTeam],
        );
        if (!reg) continue;
        const pending = await db.get(
          `SELECT id FROM player_suspensions
            WHERE event_id = ? AND registration_id = ? AND player = ?
              AND reason = 'red_card' AND status = 'pending'`,
          [match.event_id, reg.id, cardPlayer],
        );
        if (pending) continue;
        await db.run(
          `INSERT INTO player_suspensions
             (id, event_id, registration_id, team_name, player, player_no, reason, note,
              status, cleared_yellow, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'red_card', ?, 'pending', 0, ?, ?)`,
          [uid('sus_'), match.event_id, reg.id, reg.team_name, cardPlayer,
            String(c.no ?? '').trim() || null, '红牌自动登记，下一轮停赛', user.id, nowIso()],
        );
      }
      await db.run(
        `UPDATE matches
            SET score_a = ?, score_b = ?, referee_list = ?, referee = ?, assistant1 = ?,
                assistant2 = ?, fourth_official = ?, lineup_a = ?, lineup_b = ?,
                status = 'finished',
                finished_by = ?, finished_at = ?
          WHERE id = ?`,
        [scoreA, scoreB, JSON.stringify(refereeList), mainReferee, assistant1, assistant2,
          fourthOfficial, lineupAJson, lineupBJson, user.id, nowIso(), match.id],
      );
      await db.exec('COMMIT');
    } catch (e) {
      await db.exec('ROLLBACK');
      throw e;
    }
    await audit(db, user, 'match.result', 'match', match.id,
      { eventId: match.event_id, scoreA, scoreB, goals: goalsA.length + goalsB.length,
        cards: cards.length, subs: subs.length, source: body.source || 'manual' },
      clientIp(req));
    const fresh = await db.get('SELECT * FROM matches WHERE id = ?', [match.id]);
    sendJson(res, 200, await detailsOfMatch(db, fresh));
  });
}
