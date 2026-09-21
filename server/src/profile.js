// =============================================================
// 「我的」个人主页聚合：按登录手机号定位本人报名成员行，
// 关联球队/赛事/角色/球衣号，并结合赛果实时派生个人数据
// （出场/进球/红黄牌、球队战绩），不落库，与积分榜同思路。
// =============================================================
import { roleLabel } from './rbac.js';

const inPlaceholders = (n) => Array.from({ length: n }, () => '?').join(',');

function parseRoles(text) {
  try {
    const v = JSON.parse(text || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// 本人所在队伍的本队一侧（A/B）
function mySide(match, rid) {
  return match.team_a_id === rid ? 'A' : 'B';
}

// 队员在某场已完赛中的"在场"证据：该侧首发/替补名单，或该场进球/牌/换人记录
function listedInLineup(lineupText, name) {
  if (!lineupText) return false;
  try {
    const lu = JSON.parse(lineupText);
    const list = [...(lu.starting || []), ...(lu.substitutes || [])];
    return list.some((p) => p.name === name);
  } catch {
    return false;
  }
}

async function membershipStats(db, row) {
  const rid = row.registration_id;
  const name = row.member_name;
  const teamName = row.team_name;

  const matches = await db.all(
    `SELECT * FROM matches WHERE team_a_id = ? OR team_b_id = ?
      ORDER BY match_date, start_time`,
    [rid, rid],
  );
  const finishedIds = [];
  let finished = 0;
  let upcoming = 0;
  let win = 0;
  let draw = 0;
  let loss = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  for (const m of matches) {
    if (m.status === 'finished') {
      finished += 1;
      finishedIds.push(m.id);
      const mine = m.team_a_id === rid;
      const sc = mine ? m.score_a : m.score_b;
      const opp = mine ? m.score_b : m.score_a;
      goalsFor += sc;
      goalsAgainst += opp;
      if (sc > opp) win += 1;
      else if (sc < opp) loss += 1;
      else draw += 1;
    } else if (m.status === 'scheduled') {
      upcoming += 1;
    }
  }

  let goals = 0;
  let yellowCards = 0;
  let redCards = 0;
  let appears = 0;
  if (finishedIds.length) {
    const ph = inPlaceholders(finishedIds.length);
    const goalsRows = await db.all(
      `SELECT match_id, side, player FROM match_goals WHERE match_id IN (${ph})`,
      finishedIds,
    );
    const cardRows = await db.all(
      `SELECT match_id, team, player, card_type FROM match_cards WHERE match_id IN (${ph})`,
      finishedIds,
    );
    const subRows = await db.all(
      `SELECT match_id, team, on_player, off_player FROM match_subs WHERE match_id IN (${ph})`,
      finishedIds,
    );
    const byMatch = new Map(
      matches.filter((m) => m.status === 'finished').map((m) => [m.id, m]),
    );
    const cardsOfMatch = new Map();
    for (const c of cardRows) {
      if (!cardsOfMatch.has(c.match_id)) cardsOfMatch.set(c.match_id, []);
      cardsOfMatch.get(c.match_id).push(c);
    }
    const subsOfMatch = new Map();
    for (const s of subRows) {
      if (!subsOfMatch.has(s.match_id)) subsOfMatch.set(s.match_id, []);
      subsOfMatch.get(s.match_id).push(s);
    }
    for (const m of byMatch.values()) {
      const side = mySide(m, rid);
      const goalHere = goalsRows.filter(
        (g) => g.match_id === m.id && g.side === side && g.player === name,
      );
      goals += goalHere.length;
      for (const c of cardsOfMatch.get(m.id) || []) {
        if (c.team === teamName && c.player === name) {
          if (c.card_type === 'yellow') yellowCards += 1;
          else if (c.card_type === 'red') redCards += 1;
        }
      }
      // 出场：已完赛该侧名单有本人，或该场有本人进球/牌/换人记录
      const lineup = m.team_a_id === rid ? m.lineup_a : m.lineup_b;
      const inRoster = listedInLineup(lineup, name);
      const inEvents = goalHere.length > 0
        || (cardsOfMatch.get(m.id) || []).some(
          (c) => c.team === teamName && c.player === name,
        )
        || (subsOfMatch.get(m.id) || []).some(
          (s) => s.team === teamName && (s.on_player === name || s.off_player === name),
        );
      if (inRoster || inEvents) appears += 1;
    }
  }

  return {
    hasStats: row.reg_status === 'approved',
    finished,
    upcoming,
    appears,
    goals,
    yellowCards,
    redCards,
    win,
    draw,
    loss,
    goalsFor,
    goalsAgainst,
  };
}

export async function buildMyProfile(db, user) {
  const rows = await db.all(
    `SELECT m.id AS member_id, m.name AS member_name, m.phone AS member_phone,
            m.roles AS member_roles, m.jersey_no, m.is_contact,
            r.id AS registration_id, r.team_name, r.status AS reg_status,
            r.reject_reason, r.jersey_top, r.apply_time,
            e.id AS event_id, e.name AS event_name, e.season, e.status AS event_status
       FROM registration_members m
       JOIN registrations r ON r.id = m.registration_id
       JOIN events e ON e.id = r.event_id
      WHERE m.phone = ?
      ORDER BY (e.status = 'live' AND r.status = 'approved') DESC,
               (r.status = 'approved') DESC,
               r.apply_time DESC`,
    [user.phone],
  );

  const memberships = [];
  const seenEvents = new Set();
  const totals = {
    finished: 0, upcoming: 0, appears: 0, goals: 0,
    yellowCards: 0, redCards: 0, win: 0, draw: 0, loss: 0,
  };
  for (const row of rows) {
    const stats = await membershipStats(db, row);
    memberships.push({
      registrationId: row.registration_id,
      eventId: row.event_id,
      eventName: row.event_name,
      season: row.season,
      eventStatus: row.event_status,
      teamName: row.team_name,
      jerseyColor: row.jersey_top || '',
      regStatus: row.reg_status,
      rejectReason: row.reject_reason,
      jerseyNo: row.jersey_no || '',
      roles: parseRoles(row.member_roles),
      isContact: Boolean(row.is_contact),
      ...stats,
    });
    seenEvents.add(row.event_id);
    for (const key of Object.keys(totals)) totals[key] += stats[key];
  }

  return {
    memberships,
    totals: {
      ...totals,
      teamCount: memberships.length,
      eventCount: seenEvents.size,
    },
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      roleLabel: roleLabel(user.role),
    },
  };
}
