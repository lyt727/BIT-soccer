import { hashPassword } from './security.js';
import { config } from './config.js';

// 演示账号初始密码（正式使用前请登录后在“成员与角色管理”里重置或停用）
const DEMO_PASSWORD = config.demoPassword;

// 演示数据（V3）：
//  主赛事：15 支球队，A/B/C/D 四组（4/4/4/3），每队 15 人（主教练+领队+队长+队员）
//  新生杯：保留少量球队用于报名/加入/审核演示
const users = [
  ['usr_admin', '13900000001', 'lby', 'admin', 'E1001'],
  ['usr_op', '13900000003', 'ljz', 'data_operator', 'E1003'],
  ['usr_p1', '13800138001', 'zht', 'player', null],
  ['usr_p2', '13800138002', 'clm', 'player', null],
];

// [注册id, 球队名, 主教练, 队长, 上衣, 短裤, 球袜]
const E1_TEAMS = [
  ['reg_e1_1', '信息与电子学院一队', '王建国', 'zht', '红白', '黑', '白'],
  ['reg_e1_2', '机械与车辆学院一队', '李明远', '陈晨', '蓝黑', '蓝', '黑'],
  ['reg_e1_3', '自动化学院一队', '周志强', '周悦', '深蓝白', '白', '蓝'],
  ['reg_e1_4', '材料学院一队', '刘国栋', '许诺', '橙黑', '黑', '橙'],
  ['reg_e1_5', '宇航学院一队', '赵国庆', '何平', '绿白', '绿', '白'],
  ['reg_e1_6', '光电学院一队', '孙宏伟', '赵敏', '紫白', '紫', '白'],
  ['reg_e1_7', '管理与经济学院一队', '李国庆', '李雷', '黄黑', '黑', '黄'],
  ['reg_e1_8', '计算机学院一队', '吴志刚', '曹阳', '黑白', '白', '黑'],
  ['reg_e1_9', '数学与统计学院一队', '杨建平', '杨光', '红黑', '红', '黑'],
  ['reg_e1_10', '物理学院一队', '郑国华', '李雷', '蓝白', '蓝', '白'],
  ['reg_e1_11', '化学与化工学院一队', '何志远', '赵敏', '绿黑', '绿', '黑'],
  ['reg_e1_12', '生命学院一队', '高建军', '何平', '橙白', '橙', '白'],
  ['reg_e1_13', '外国语学院一队', '罗永强', '许诺', '白蓝', '白', '蓝'],
  ['reg_e1_14', '设计与艺术学院一队', '郭建华', '安然', '紫金', '紫', '金'],
  ['reg_e1_15', '法学院一队', '马国强', '郑凯', '藏青白', '藏青', '白'],
];

const GROUP_TEAMS = {
  A: ['reg_e1_1', 'reg_e1_2', 'reg_e1_3', 'reg_e1_4'],
  B: ['reg_e1_5', 'reg_e1_6', 'reg_e1_7', 'reg_e1_8'],
  C: ['reg_e1_9', 'reg_e1_10', 'reg_e1_11', 'reg_e1_12'],
  D: ['reg_e1_13', 'reg_e1_14', 'reg_e1_15'],
};

// 新生杯：3 支已通过 + 4 支待审核（每队 3 人，用于报名演示）
const E2_APPROVED = [
  ['reg_e2_1', '法学院新生队', '郑凯', '13800138021', '红黑', [['clm', '13800138002'], ['李明', '13800138003']]],
  ['reg_e2_2', '外国语学院新生队', '许诺', '13800138010', '白蓝', [['zht', '13800138001'], ['陈晨', '13800138004']]],
  ['reg_e2_3', '设计学院新生队', '安然', '13800138011', '黄黑', [['赵磊', '13800138005'], ['孙浩', '13800138006']]],
];
const E2_PENDING = [
  ['reg_e2_4', '生命学院新生队', '高翔', '13800138012', '绿白', [['何平', '13800138013'], ['白雪', '13800138014']]],
  ['reg_e2_5', '化工学院新生队', '何平', '13800138013', '橙黑', [['罗毅', '13800138015'], ['赵敏', '13800138016']]],
  ['reg_e2_6', '数统学院新生队', '杨光', '13900000004', '蓝白', [['钱进', '13800138017'], ['孙立', '13800138018']]],
  ['reg_e2_7', '物理学院新生队', '罗毅', '13800138015', '黑白', [['李雷', '13800138019'], ['韩梅梅', '13800138020']]],
];

const SURNAMES = ['王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴',
  '徐', '孙', '马', '朱', '胡', '郭', '何', '高', '林', '罗'];
const GIVEN = ['强', '磊', '洋', '勇', '军', '杰', '涛', '明', '超', '鹏',
  '华', '平', '刚', '辉', '健', '俊', '峰', '波', '斌', '宇'];
const REFEREES = ['赵明', '钱进', '孙立', '周舟', '李锋', '王海', '陈刚', '刘志强'];
const VENUES = ['西操场 1 号场', '西操场 2 号场', '东操场 1 号场', '东操场 2 号场'];

function phoneFor(seq) {
  return String(13800000000 + seq);
}

function genName(seed) {
  return SURNAMES[seed % SURNAMES.length] + GIVEN[(seed * 3 + 7) % GIVEN.length];
}

// 每队 15 人：1 主教练兼领队、1 队长兼队员、13 名队员
function makeRoster(teamIdx, coachName, captainName, size = 15) {
  const roster = [];
  const base = teamIdx * 100 + 1;
  roster.push({
    name: coachName, phone: phoneFor(base), roles: ['head_coach', 'manager'], jerseyNo: '',
  });
  roster.push({
    name: captainName, phone: phoneFor(base + 1), roles: ['captain', 'player'], jerseyNo: '1',
  });
  for (let i = 2; i < size; i += 1) {
    roster.push({
      name: genName(teamIdx * 17 + i * 5),
      phone: phoneFor(base + i),
      roles: ['player'],
      jerseyNo: String(i),
    });
  }
  return roster;
}

function lineupOf(roster, color) {
  const players = roster
    .filter((m) => m.roles.includes('player') || m.roles.includes('captain'))
    .map((m) => ({ no: m.jerseyNo, name: m.name }));
  return {
    color,
    starting: players.slice(0, 11),
    substitutes: players.slice(11),
  };
}

export function seedIfEmpty(db) {
  const count = db.get('SELECT COUNT(*) AS c FROM users');
  if (count && count.c > 0) return false;
  const now = new Date().toISOString();

  const insertUser = db.prepare(
    `INSERT INTO users (id, phone, name, role, emp_id, password_hash, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`);
  for (const [id, phone, name, role, empId] of users) {
    insertUser.run(id, phone, name, role, empId, hashPassword(DEMO_PASSWORD), now);
  }

  const insertEvent = db.prepare(
    `INSERT INTO events (id, name, season, description, status, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insertEvent.run('evt_demo1', '2026年北理工校园足球联赛（春季）', '2026',
    '15 支球队分 4 组，每队 15 人，小组赛+单回合淘汰赛', 'live', 'usr_admin', now);
  insertEvent.run('evt_demo2', '2026 北理工新生杯七人制足球赛', '2026',
    '面向大一/研一新生，报名截止后名单锁定', 'signup', 'usr_admin', now);

  const insertStaff = db.prepare(
    `INSERT INTO event_staff (event_id, user_id, event_role, assigned_by, created_at)
     VALUES (?, ?, ?, ?, ?)`);
  for (const evt of ['evt_demo1', 'evt_demo2']) {
    insertStaff.run(evt, 'usr_admin', 'admin', 'usr_admin', now);
    insertStaff.run(evt, 'usr_op', 'data_operator', 'usr_admin', now);
  }

  const insertReg = db.prepare(
    `INSERT INTO registrations
      (id, event_id, team_name, jersey_top, jersey_shorts, jersey_socks,
       status, apply_time, reviewed_by, reviewed_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertMember = db.prepare(
    `INSERT INTO registration_members
      (id, registration_id, name, phone, roles, jersey_no, is_contact, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertFile = db.prepare(
    `INSERT INTO files
      (id, owner_type, owner_id, kind, original_name, mime, path, size, uploaded_by, created_at)
     VALUES (?, 'registration_member', ?, 'campus_card', ?, 'image/jpeg', NULL, 0, ?, ?)`);

  let fileSeq = 0;
  const insertTeam = (rid, eventId, teamName, jersey, roster, status, applyDaysAgo) => {
    const apply = new Date(Date.now() - applyDaysAgo * 86400 * 1000).toISOString();
    const approve = new Date(Date.now() - 15 * 86400 * 1000).toISOString();
    insertReg.run(rid, eventId, teamName, jersey[0], jersey[1], jersey[2], status, apply,
      status === 'approved' ? 'usr_admin' : null,
      status === 'approved' ? approve : null,
      'usr_admin');
    roster.forEach((m, i) => {
      const mid = `${rid}_m${i + 1}`;
      insertMember.run(mid, rid, m.name, m.phone, JSON.stringify(m.roles), m.jerseyNo,
        i === 0 ? 1 : 0, apply);
      fileSeq += 1;
      insertFile.run(`file_${fileSeq}`, mid, `学生卡-${m.name}.jpg`, 'usr_admin', apply);
    });
  };

  const rosterByReg = {};
  const demoCards = [];
  E1_TEAMS.forEach(([rid, teamName, coach, captain, top, shorts, socks], idx) => {
    const roster = makeRoster(idx + 1, coach, captain, 15);
    rosterByReg[rid] = { roster, teamName, color: top };
    insertTeam(rid, 'evt_demo1', teamName, [top, shorts, socks], roster, 'approved', 20);
  });

  for (const [rid, teamName, captain, phone, top, others] of E2_APPROVED) {
    const roster = [
      { name: captain, phone, roles: ['head_coach', 'manager'], jerseyNo: '' },
      ...others.map(([name, p], i) => ({
        name, phone: p, roles: i === 0 ? ['captain', 'player'] : ['player'], jerseyNo: String(i + 1),
      })),
    ];
    insertTeam(rid, 'evt_demo2', teamName, [top, '黑', '白'], roster, 'approved', 6);
  }
  for (const [rid, teamName, captain, phone, top, others] of E2_PENDING) {
    const roster = [
      { name: captain, phone, roles: ['head_coach', 'manager'], jerseyNo: '' },
      ...others.map(([name, p], i) => ({
        name, phone: p, roles: i === 0 ? ['captain', 'player'] : ['player'], jerseyNo: String(i + 1),
      })),
    ];
    insertTeam(rid, 'evt_demo2', teamName, [top, '黑', '白'], roster, 'pending', 2);
  }

  const insertGroup = db.prepare(
    'INSERT INTO event_groups (event_id, group_name, position, registration_id) VALUES (?, ?, ?, ?)');
  for (const [g, ids] of Object.entries(GROUP_TEAMS)) {
    ids.forEach((rid, i) => insertGroup.run('evt_demo1', g, i, rid));
  }

  const insertMatch = db.prepare(
    `INSERT INTO matches
      (id, event_id, team_a_id, team_b_id, stage, group_name, knockout_round,
       match_date, start_time, venue, referee, assistant1, assistant2, fourth_official,
       special_note, lineup_a, lineup_b, status, score_a, score_b,
       finished_by, finished_at, created_by, created_at)
     VALUES (?, 'evt_demo1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'usr_admin', ?)`);
  const insertGoal = db.prepare(
    `INSERT INTO match_goals (id, match_id, side, player, player_no, goal_time, is_penalty)
     VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertCard = db.prepare(
    `INSERT INTO match_cards (id, match_id, team, player, player_no, card_type, card_time)
     VALUES (?, ?, ?, ?, ?, ?, ?)`);

  let matchSeq = 0;
  const groupPairs = (ids) => {
    const pairs = [];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) pairs.push([ids[i], ids[j]]);
    }
    return pairs;
  };

  for (const [gIdx, [groupName, ids]] of Object.entries(GROUP_TEAMS).entries()) {
    const pairs = groupPairs(ids);
    pairs.forEach(([aId, bId], pIdx) => {
      matchSeq += 1;
      const mid = `mt_evt1_g${groupName}${pIdx + 1}`;
      const finished = pIdx < 2;
      const scoreA = finished ? (pIdx === 0 ? 2 + (gIdx % 2) : 1) : 0;
      const scoreB = finished ? (pIdx === 0 ? gIdx % 2 : 1 + (gIdx % 2)) : 0;
      const date = `2026-09-${String(1 + gIdx * 2 + pIdx).padStart(2, '0')}`;
      insertMatch.run(
        mid, aId, bId, 'group', groupName, '',
        date, pIdx % 2 === 0 ? '19:00' : '16:00', VENUES[matchSeq % VENUES.length],
        REFEREES[matchSeq % REFEREES.length],
        REFEREES[(matchSeq + 1) % REFEREES.length],
        REFEREES[(matchSeq + 2) % REFEREES.length],
        REFEREES[(matchSeq + 3) % REFEREES.length],
        '',
        JSON.stringify(lineupOf(rosterByReg[aId].roster, rosterByReg[aId].color)),
        JSON.stringify(lineupOf(rosterByReg[bId].roster, rosterByReg[bId].color)),
        finished ? 'finished' : 'scheduled', scoreA, scoreB,
        finished ? 'usr_admin' : null,
        finished ? `${date}T12:30:00.000Z` : null,
        now,
      );
      if (finished) {
        const goalsA = rosterByReg[aId].roster
          .filter((m) => m.roles.includes('player') || m.roles.includes('captain'))
          .slice(0, scoreA);
        const goalsB = rosterByReg[bId].roster
          .filter((m) => m.roles.includes('player') || m.roles.includes('captain'))
          .slice(0, scoreB);
        goalsA.forEach((m, i) => insertGoal.run(
          `g_${mid}_a${i}`, mid, 'A', m.name, m.jerseyNo, `${12 + i * 9}'`, 0));
        goalsB.forEach((m, i) => insertGoal.run(
          `g_${mid}_b${i}`, mid, 'B', m.name, m.jerseyNo, `${35 + i * 9}'`, 0));
        if (pIdx === 0) {
          const cardPlayer = rosterByReg[bId].roster.find((m) => m.roles.includes('player'));
          insertCard.run(`c_${mid}`, mid, rosterByReg[bId].teamName,
            cardPlayer.name, cardPlayer.jerseyNo, 'yellow', "33'");
          // 再补一张红牌，用于演示红牌停赛与停赛台账
          const redPlayer = rosterByReg[bId].roster
            .filter((m) => m.roles.includes('player'))[1] || cardPlayer;
          insertCard.run(`r_${mid}`, mid, rosterByReg[bId].teamName,
            redPlayer.name, redPlayer.jerseyNo, 'red', "78'");
          demoCards.push({ regId: bId, yellow: cardPlayer, red: redPlayer });
        }
      }
    });
  }

  // 多张牌的演示数据：给「已完赛 2 场」的球队各安排一名球员累计 2 张牌
  const finishedGroupMatches = db.prepare(
    `SELECT id FROM matches
      WHERE event_id = 'evt_demo1' AND stage = 'group' AND status = 'finished'
        AND (team_a_id = ? OR team_b_id = ?)
      ORDER BY id`);
  const multiCardPlayers = [];
  for (const [regId, cardType] of [
    ['reg_e1_5', 'yellow'],   // 宇航学院一队
    ['reg_e1_9', 'yellow'],   // 数学与统计学院一队
    ['reg_e1_13', 'red'],     // 外国语学院一队
  ]) {
    const roster = rosterByReg[regId]?.roster || [];
    const player = roster.find((m) => m.roles.includes('player'));
    if (!player) continue;
    const rows = finishedGroupMatches.all(regId, regId);
    rows.forEach((row, i) => {
      insertCard.run(`x_${regId}_${i}`, row.id, rosterByReg[regId].teamName,
        player.name, player.jerseyNo, cardType, `${28 + i * 13}'`);
    });
    if (cardType === 'yellow' && rows.length) multiCardPlayers.push({ regId, player });
  }

  // 停赛名单示例：红牌停赛（下一轮停赛）+ 累计黄牌停赛（下一轮停赛）+ 已执行停赛（累计黄牌清零）
  if (demoCards.length >= 2) {
    const insertSusp = db.prepare(
      `INSERT INTO player_suspensions
         (id, event_id, registration_id, team_name, player, player_no, reason, note,
          matches_suspended, status, cleared_yellow, created_by, created_at)
       VALUES (?, 'evt_demo1', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'usr_admin', ?)`);
    const pending = demoCards[0];
    insertSusp.run('sus_demo_pending', pending.regId, rosterByReg[pending.regId].teamName,
      pending.red.name, pending.red.jerseyNo, 'red_card',
      '严重犯规红牌，停赛两场（演示数据）', 2, 'pending', 0, now);
    const served = demoCards[1];
    insertSusp.run('sus_demo_served', served.regId, rosterByReg[served.regId].teamName,
      served.yellow.name, served.yellow.jerseyNo, 'yellow_accumulation',
      '累计黄牌停赛一轮，已执行（演示数据）', 1, 'served', 1, now);
    // 累计 2 张黄牌的球员：登记为下一轮停赛
    const acc = multiCardPlayers[0];
    if (acc) {
      insertSusp.run('sus_demo_yellow_acc', acc.regId, rosterByReg[acc.regId].teamName,
        acc.player.name, acc.player.jerseyNo, 'yellow_accumulation',
        '累计 2 张黄牌，下一轮停赛（演示数据）', 1, 'pending', 0, now);
    }
    // 一名红牌球员标为「已执行停赛」，用于演示两种状态
    const doneRed = demoCards[1];
    insertSusp.run('sus_demo_red_served', doneRed.regId, rosterByReg[doneRed.regId].teamName,
      doneRed.red.name, doneRed.red.jerseyNo, 'red_card',
      '红牌停赛一轮已执行（演示数据）', 1, 'served', 0, now);
    // 其余红牌球员各补一条「下一轮停赛」，保证红牌榜状态不空
    const redRows = db.all(
      `SELECT DISTINCT c.team, c.player, c.player_no
         FROM match_cards c JOIN matches m ON m.id = c.match_id
        WHERE m.event_id = 'evt_demo1' AND c.card_type = 'red'`);
    let redSeq = 0;
    for (const row of redRows) {
      const reg = db.get(
        'SELECT id, team_name FROM registrations WHERE event_id = ? AND team_name = ?',
        ['evt_demo1', row.team],
      );
      if (!reg) continue;
      const exists = db.get(
        `SELECT id FROM player_suspensions
          WHERE event_id = 'evt_demo1' AND registration_id = ? AND player = ? AND reason = 'red_card'`,
        [reg.id, row.player],
      );
      if (exists) continue;
      redSeq += 1;
      insertSusp.run(`sus_red_${redSeq}`, reg.id, reg.team_name, row.player,
        row.player_no || null, 'red_card', null, 1, 'pending', 0, now);
    }
    // 备注示例：严重违纪除红牌外追加停赛
    db.run(
      `UPDATE player_suspensions SET matches_suspended = 5, note = ?
        WHERE event_id = 'evt_demo1' AND reason = 'red_card' AND player = ?`,
      ['辱骂裁判，停赛5场', '周平'],
    );
  }

  // 淘汰赛（单回合、手动对阵）：两场半决赛 + 一场决赛
  const koDefs = [
    ['mt_evt1_sf1', 'reg_e1_1', 'reg_e1_5', '半决赛', '2026-09-25', '19:00'],
    ['mt_evt1_sf2', 'reg_e1_9', 'reg_e1_13', '半决赛', '2026-09-26', '19:00'],
    ['mt_evt1_final', 'reg_e1_1', 'reg_e1_9', '决赛', '2026-10-02', '19:00'],
  ];
  koDefs.forEach(([mid, aId, bId, round, date, time], i) => {
    insertMatch.run(
      mid, aId, bId, 'knockout', '', round,
      date, time, VENUES[i % VENUES.length],
      REFEREES[i % REFEREES.length],
      REFEREES[(i + 1) % REFEREES.length],
      REFEREES[(i + 2) % REFEREES.length],
      REFEREES[(i + 3) % REFEREES.length],
      '', '{"color":"","starting":[],"substitutes":[]}',
      '{"color":"","starting":[],"substitutes":[]}',
      'scheduled', 0, 0, null, null, now,
    );
  });

  // 比赛工作人员示例（比赛监督 / 拍照同学 / 录像同学 / 解说同学 / 战报同学）
  const updStaff = db.prepare(
    `UPDATE matches SET match_supervisor = ?, photographer = ?, videographer = ?,
        commentator = ?, reporter = ? WHERE id = ?`);
  updStaff.run('刘建国', '陈摄影', '王摄像', '李解说', '赵战报', 'mt_evt1_gA1');
  updStaff.run('刘建国', '陈摄影', '', '', '', 'mt_evt1_gB1');
  updStaff.run('周老师', '李摄影', '赵摄像', '孙解说', '吴战报', 'mt_evt1_sf1');

  // =========================================================
  // 2026 秋季女足联赛：单循环联赛赛制演示数据
  //   8 支球队，每两队交手一次 → 7 轮 28 场；前两轮完赛，便于查看联赛积分榜
  // =========================================================
  db.prepare(
    `INSERT INTO events (id, name, season, description, format, status, created_by, created_at)
     VALUES (?, ?, ?, ?, 'league', 'live', 'usr_admin', ?)`,
  ).run('evt_women', '2026秋季女足联赛', '2026',
    '单循环联赛赛制演示：8 支球队，每两队交手一次，共 7 轮 28 场', now);

  const W_TEAMS = [
    ['reg_w1', '信息与电子学院女足', '王丽', '李静', '红', '黑', '白'],
    ['reg_w2', '机械与车辆学院女足', '张敏', '刘洋', '蓝', '蓝', '黑'],
    ['reg_w3', '自动化学院女足', '陈静', '杨帆', '黄', '黑', '黄'],
    ['reg_w4', '材料学院女足', '赵雪', '孙婷', '绿', '绿', '白'],
    ['reg_w5', '宇航学院女足', '周敏', '吴倩', '紫', '白', '紫'],
    ['reg_w6', '计算机学院女足', '徐丽', '郑洁', '橙', '黑', '橙'],
    ['reg_w7', '数学与统计学院女足', '马晓', '冯雪', '白', '蓝', '白'],
    ['reg_w8', '外国语学院女足', '何静', '许悦', '黑', '黑', '红'],
  ];
  W_TEAMS.forEach(([rid, teamName, coach, captain, top, shorts, socks], idx) => {
    const roster = makeRoster(40 + idx, coach, captain, 12);
    rosterByReg[rid] = { roster, teamName, color: top };
    insertTeam(rid, 'evt_women', teamName, [top, shorts, socks], roster, 'approved', 12);
  });
  // 指派数据录入员，方便演示录分与 AI 识图
  insertStaff.run('evt_women', 'usr_op', 'data_operator', 'usr_admin', now);

  // 轮转法排单循环对阵（8 支为偶数，无轮空）
  const wIds = W_TEAMS.map(([rid]) => rid);
  const wRounds = [];
  const rot = [...wIds];
  for (let r = 0; r < wIds.length - 1; r += 1) {
    const round = [];
    for (let i = 0; i < rot.length / 2; i += 1) {
      round.push([rot[i], rot[rot.length - 1 - i]]);
    }
    wRounds.push(round);
    rot.splice(1, 0, rot.pop());
  }

  const insertWMatch = db.prepare(
    `INSERT INTO matches
      (id, event_id, team_a_id, team_b_id, stage, group_name, knockout_round, round_name,
       match_date, start_time, venue, status, score_a, score_b,
       finished_by, finished_at, created_by, created_at)
     VALUES (?, 'evt_women', ?, ?, 'group', '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'usr_admin', ?)`);
  const insertWGoal = db.prepare(
    `INSERT INTO match_goals (id, match_id, side, player, player_no, goal_time, is_penalty)
     VALUES (?, ?, ?, ?, ?, ?, 0)`);

  let wSeq = 0;
  wRounds.forEach((round, ri) => {
    const finished = ri < 2; // 前两轮先完赛
    round.forEach(([rawA, rawB], mi) => {
      // 隔轮对调主客，避免同一支队总是排在主队位置
      const swap = ri % 2 === 1;
      const aId = swap ? rawB : rawA;
      const bId = swap ? rawA : rawB;
      wSeq += 1;
      const mid = `mt_w_${wSeq}`;
      const scoreA = finished ? (mi % 3) : 0;
      const scoreB = finished ? ((mi + 1) % 2) : 0;
      insertWMatch.run(
        mid, aId, bId, `第${ri + 1}轮`,
        `2026-10-${String(8 + ri * 2).padStart(2, '0')}`,
        ['15:00', '16:30', '14:00', '17:00'][mi % 4],
        VENUES[mi % VENUES.length],
        finished ? 'finished' : 'scheduled', scoreA, scoreB,
        finished ? 'usr_admin' : null, finished ? now : null, now,
      );
      if (finished && scoreA > 0) {
        const scorer = rosterByReg[aId].roster
          .find((m) => (m.roles || []).includes('player'));
        if (scorer) {
          insertWGoal.run(`g_w_${wSeq}`, mid, 'A', scorer.name, scorer.jerseyNo, "23'");
        }
      }
    });
  });

  return true;
}
