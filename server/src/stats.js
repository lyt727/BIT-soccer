// 积分榜 / 射手榜：派生数据，实时计算，不落库（与 PRD 一致）

export function computeStandings(db, eventId, groupName = null) {
  const teams = groupName
    ? db.all(
      `SELECT r.id, r.team_name FROM registrations r
        JOIN event_groups eg ON eg.registration_id = r.id AND eg.event_id = r.event_id
        WHERE r.event_id = ? AND r.status = 'approved' AND eg.group_name = ?
        ORDER BY r.team_name COLLATE NOCASE`,
      [eventId, groupName],
    )
    : db.all(
      `SELECT r.id, r.team_name FROM registrations r
        WHERE r.event_id = ? AND r.status = 'approved'
        ORDER BY r.team_name COLLATE NOCASE`,
      [eventId],
    );
  const stats = new Map(
    teams.map((t) => [t.id, {
      registrationId: t.id,
      teamName: t.team_name,
      played: 0, win: 0, draw: 0, loss: 0,
      goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0,
    }]),
  );

  const finished = groupName
    ? db.all(
      `SELECT m.* FROM matches m
        WHERE m.event_id = ? AND m.status = 'finished' AND m.stage = 'group' AND m.group_name = ?`,
      [eventId, groupName],
    )
    : db.all(
      `SELECT m.* FROM matches m
        WHERE m.event_id = ? AND m.status = 'finished' AND m.stage = 'group'`,
      [eventId],
    );

  for (const m of finished) {
    const a = stats.get(m.team_a_id);
    const b = stats.get(m.team_b_id);
    if (!a || !b) continue; // 球队被删除等极端情况兜底
    a.played += 1; b.played += 1;
    a.goalsFor += m.score_a; a.goalsAgainst += m.score_b;
    b.goalsFor += m.score_b; b.goalsAgainst += m.score_a;
    if (m.score_a > m.score_b) { a.win += 1; b.loss += 1; a.points += 3; }
    else if (m.score_a < m.score_b) { b.win += 1; a.loss += 1; b.points += 3; }
    else { a.draw += 1; b.draw += 1; a.points += 1; b.points += 1; }
  }

  const rows = [...stats.values()].map((s) => ({
    ...s,
    goalDiff: s.goalsFor - s.goalsAgainst,
  }));
  rows.sort((x, y) =>
    y.points - x.points ||
    y.goalDiff - x.goalDiff ||
    y.goalsFor - x.goalsFor ||
    x.teamName.localeCompare(y.teamName, 'zh-Hans-CN'));

  let lastRank = 0;
  let lastKey = '';
  return rows.map((r, i) => {
    const key = `${r.points}|${r.goalDiff}|${r.goalsFor}`;
    if (key !== lastKey) { lastRank = i + 1; lastKey = key; }
    return { rank: lastRank, ...r };
  });
}

export function computeGroupStandings(db, eventId) {
  const groups = db.all(
    'SELECT DISTINCT group_name FROM event_groups WHERE event_id = ? ORDER BY group_name',
    [eventId],
  );
  return groups.map((g) => ({
    groupName: g.group_name,
    rows: computeStandings(db, eventId, g.group_name),
  }));
}

export function computeScorers(db, eventId) {
  const rows = db.all(
    `SELECT g.player, g.is_penalty,
            CASE g.side WHEN 'A' THEN m.team_a_id WHEN 'B' THEN m.team_b_id END AS reg_id,
            r.team_name
      FROM match_goals g
      JOIN matches m ON m.id = g.match_id
      JOIN registrations r ON r.id = CASE g.side
        WHEN 'A' THEN m.team_a_id WHEN 'B' THEN m.team_b_id END
      WHERE m.event_id = ? AND m.status = 'finished'`,
    [eventId],
  );
  const map = new Map();
  for (const r of rows) {
    const key = `${r.reg_id}::${r.player}`;
    if (!map.has(key)) {
      map.set(key, { player: r.player, teamName: r.team_name, goals: 0, penalties: 0 });
    }
    const item = map.get(key);
    item.goals += 1;
    item.penalties += r.is_penalty ? 1 : 0;
  }
  const scorers = [...map.values()];
  scorers.sort((x, y) =>
    y.goals - x.goals ||
    x.penalties - y.penalties ||
    x.player.localeCompare(y.player, 'zh-Hans-CN'));
  return scorers.map((s, i) => ({ rank: i + 1, ...s }));
}

export function parseJsonArray(text, fallback = []) {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
