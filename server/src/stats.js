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

// 红黄牌榜 + 停赛状态
//   总黄牌数：整届赛事累加，永不重置
//   累计黄牌数：总黄牌数 - 该球员所有“已完成停赛”记录的清零值
//   状态：全部由管理员在停赛台账里人工维护，系统不做任何规则判断
const REASON_LABEL = { red_card: '红牌', yellow_accumulation: '累计黄牌', other: '其他原因' };
const STATUS_LABEL = { pending: '下一轮停赛', served: '已执行停赛', void: '已失效' };

export function computeCardStats(db, eventId, yellowThreshold = 2) {
  const cards = db.all(
    `SELECT c.player, c.player_no, c.card_type,
            r.id AS reg_id, r.team_name
       FROM match_cards c
       JOIN matches m ON m.id = c.match_id
       JOIN registrations r ON r.event_id = m.event_id AND r.team_name = c.team
      WHERE m.event_id = ?`,
    [eventId],
  );
  const suspensions = db.all(
    'SELECT * FROM player_suspensions WHERE event_id = ? ORDER BY created_at',
    [eventId],
  );

  // 停赛台账：按「球队 + 球员」归集
  const suspMap = new Map();
  for (const s of suspensions) {
    const key = `${s.registration_id || s.team_name}::${s.player}`;
    if (!suspMap.has(key)) suspMap.set(key, []);
    suspMap.get(key).push(s);
  }
  const pendingOrServed = (key, reason) => {
    const mine = (suspMap.get(key) || []).filter((s) => s.reason === reason);
    if (mine.some((s) => s.status === 'pending')) return 'pending';
    if (mine.some((s) => s.status === 'served')) return 'served';
    return '';
  };
  // 红牌至少停赛一轮，所以有红牌但没记录时按「下一轮停赛」呈现；只有失效记录时显示失效
  const redStatusOf = (key, hasRedCard) => {
    const s = pendingOrServed(key, 'red_card');
    if (s) return s;
    const mine = (suspMap.get(key) || []).filter((x) => x.reason === 'red_card');
    if (mine.length) return 'void';
    return hasRedCard ? 'pending' : '';
  };
  const hasReasonRecord = (key, reason) =>
    (suspMap.get(key) || []).some((s) => s.reason === reason);
  // 取该球员某类停赛的场次（优先待执行，其次已执行）
  const matchesOf = (key, reason) => {
    const mine = (suspMap.get(key) || []).filter((s) => s.reason === reason);
    const active = mine.find((s) => s.status === 'pending')
      || mine.find((s) => s.status === 'served') || mine[0];
    return active ? Number(active.matches_suspended || 1) : 1;
  };
  const clearedYellows = (key) => (suspMap.get(key) || [])
    .filter((s) => s.status === 'served')
    .reduce((n, s) => n + Number(s.cleared_yellow || 0), 0);

  const map = new Map();
  const touch = (key, base) => {
    if (!map.has(key)) {
      map.set(key, { player: '', playerNo: '', teamName: '', registrationId: '', redCards: 0, totalYellows: 0, ...base });
    }
    return map.get(key);
  };

  for (const c of cards) {
    const key = `${c.reg_id}::${c.player}`;
    const item = touch(key, { player: c.player, teamName: c.team_name, registrationId: c.reg_id });
    if (!item.playerNo && c.player_no) item.playerNo = c.player_no;
    if (c.card_type === 'red') item.redCards += 1;
    else item.totalYellows += 1;
  }
  // 只登记了停赛、还没有牌记录的人也要能看到
  for (const s of suspensions) {
    touch(`${s.registration_id || s.team_name}::${s.player}`, {
      player: s.player, teamName: s.team_name,
      registrationId: s.registration_id || '', playerNo: s.player_no || '',
    });
  }

  const rows = [...map.entries()].map(([key, item]) => {
    const redStatus = redStatusOf(key, item.redCards > 0);
    const yellowStatus = pendingOrServed(key, 'yellow_accumulation');
    return {
      ...item,
      hasRedRecord: hasReasonRecord(key, 'red_card'),
      currentYellows: Math.max(0, item.totalYellows - clearedYellows(key)),
      redStatus,
      redStatusLabel: STATUS_LABEL[redStatus] || '',
      redMatches: matchesOf(key, 'red_card'),
      yellowStatus,
      yellowStatusLabel: STATUS_LABEL[yellowStatus] || '',
    };
  });

  // 榜单按 球队 → 球员 → 号码 排序
  const byTeamPlayerNo = (a, b) =>
    a.teamName.localeCompare(b.teamName, 'zh-Hans-CN')
    || a.player.localeCompare(b.player, 'zh-Hans-CN')
    || (Number(a.playerNo) || 999) - (Number(b.playerNo) || 999);

  const reds = rows.filter((r) => r.redCards > 0 || r.hasRedRecord)
    .sort(byTeamPlayerNo)
    .map((r, i) => ({
      rank: i + 1,
      player: r.player,
      playerNo: r.playerNo,
      registrationId: r.registrationId,
      teamName: r.teamName,
      redCards: r.redCards,
      matches: r.redMatches,
      status: r.redStatus,
      statusLabel: r.redStatusLabel,
    }));

  const yellows = rows.filter((r) => r.totalYellows > 0 || r.yellowStatus)
    .sort(byTeamPlayerNo)
    .map((r, i) => ({
      rank: i + 1,
      player: r.player,
      playerNo: r.playerNo,
      registrationId: r.registrationId,
      teamName: r.teamName,
      totalYellows: r.totalYellows,
      currentYellows: r.currentYellows,
      status: r.yellowStatus,
      statusLabel: r.yellowStatusLabel,
    }));

  return {
    yellowThreshold: Number(yellowThreshold) || 2,
    reds,
    yellows,
    suspensions: suspensions.map((s) => ({
      id: s.id,
      registrationId: s.registration_id,
      teamName: s.team_name,
      player: s.player,
      playerNo: s.player_no || '',
      reason: s.reason,
      reasonLabel: REASON_LABEL[s.reason] || s.reason,
      note: s.note || '',
      status: s.status,
      statusLabel: STATUS_LABEL[s.status] || s.status,
      clearedYellow: Number(s.cleared_yellow || 0),
      matches: Number(s.matches_suspended || 1),
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    })),
  };
}
