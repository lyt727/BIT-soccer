// =============================================================
// 比赛编辑统一界面：比赛信息 + 比赛数据 + 工作人员
//
// 入口：
//   1) 赛程安排里每场比赛的「编辑」按钮；
//   2) AI 识图失败后的「改用人工录入」兜底；
//   3) AI 识图成功后的「复核并提交」。
// 三块内容一次提交到 PATCH /matches/:id/full，一个事务写库，
// 避免分步保存造成页面、数据库、榜单之间的数据不一致。
//
// 权限：管理员 / 被指派的数据录入员可编辑，参赛队员只读；
//       赛事结束后只有管理员可以更正（后端同样校验）。
// 比分留空 = 本场尚未开赛；填写比分并保存 = 写入赛果并标记为已完赛。
// =============================================================
import { api } from '../lib/api.js';
import { el, clear, toast, btn, openModal, confirmBox, reloadKeepingScroll } from '../lib/ui.js';
import {
  buildLineupState, setStatus, toggleFlag, addExtraPlayer, updateExtraPlayer, removeRow,
  validateLineup, toPayload, STATUS_LABEL,
} from '../lib/lineup.js';

const KO_ROUNDS = ['1/8决赛', '1/4决赛', '半决赛', '三四名决赛', '决赛'];
const CUSTOM_ROUND = '__custom__';

// 裁判组之外的工作人员（比赛监督 / 拍照 / 录像 / 解说 / 战报）
const STAFF_FIELDS = [
  ['supervisor', '比赛监督'],
  ['photographer', '拍照'],
  ['videographer', '录像'],
  ['commentator', '解说'],
  ['reporter', '战报'],
];
// 未填写时的提示语：只有拍照/录像/解说/战报带「同学」二字
const staffPlaceholder = (key, label) => (key === 'supervisor'
  ? `请输入${label}姓名`
  : `请输入${label}同学姓名`);

export async function openMatchEditor({ event, matches = [], match = null, aiResult = null }) {
  const list = matches.filter(Boolean);
  const target = resolveTarget(list, match, aiResult);
  if (!target) {
    toast('该赛事还没有可编辑的比赛，请先在「赛程安排」中添加比赛', 'error', 3600);
    return;
  }
  let teams = [];
  try {
    teams = await api(`/events/${event.id}/registrations?status=approved`);
  } catch {
    teams = []; // 拉不到球队列表时不阻断编辑，沿用当前对阵
  }
  const state = { match: target, ai: aiResult, teams };
  const modal = openModal({ title: titleOf(target, aiResult), body: el('div') });

  const draw = () => {
    clear(modal.body);
    if (!match && list.length > 1) {
      const sel = el('select', {}, list.map((m) => el('option', {
        value: m.id, selected: m.id === state.match.id,
      }, `${m.date || '待定'} ${m.teamA.name} vs ${m.teamB.name}（${m.status === 'finished' ? '已完赛' : '未开赛'}）`)));
      sel.addEventListener('change', () => {
        state.match = list.find((m) => m.id === sel.value) || state.match;
        state.ai = null;
        draw();
      });
      modal.body.append(el('label', { class: 'field' }, el('span', {}, '选择比赛'), sel));
    }
    // 名单状态：从报名名单铺底，再套上已保存/AI 识别的名单（AI 识别到但不在
    // 报名名单里的人会作为「名单外球员」保留，不会被丢掉）
    const membersOfTeam = (regId) => (state.teams || [])
      .find((t) => t.id === regId)?.members || [];
    const m = state.match;
    state.lineup = {
      A: buildLineupState({
        lineup: m.lineups?.A,
        members: membersOfTeam(m.teamA.registrationId),
        aiLineup: state.ai?.match?.lineups?.A,
      }),
      B: buildLineupState({
        lineup: m.lineups?.B,
        members: membersOfTeam(m.teamB.registrationId),
        aiLineup: state.ai?.match?.lineups?.B,
      }),
    };
    modal.body.append(buildForm(event, state, draw));
  };
  draw();

  const save = async () => {
    // 首发名单必须正好 1 名守门员 + 1 名队长（后端也会再校验一次）
    const lineupErrors = [
      ...validateLineup(state.lineup.A, '主队').errors,
      ...validateLineup(state.lineup.B, '客队').errors,
    ];
    if (lineupErrors.length) {
      toast(lineupErrors.join('；'), 'error', 5200);
      return;
    }
    const payload = collect(modal.body, state);
    const hasResult = payload.scoreA !== null && payload.scoreB !== null;
    if (hasResult
      && (payload.goalsA.length !== payload.scoreA || payload.goalsB.length !== payload.scoreB)) {
      toast('进球球员行数需与进球数一致（每球一行，可留空记「未登记」）', 'error', 3800);
      return;
    }
    if (!hasResult && state.match.status === 'finished') {
      const ok = await confirmBox(
        '比分留空将撤销本场赛果，并清除已录入的进球、换人、红黄牌记录，确定继续？',
        { title: '撤销本场赛果', okText: '确定撤销', danger: true });
      if (!ok) return;
    }
    try {
      await api(`/matches/${state.match.id}/full`, { method: 'PATCH', body: payload });
      modal.close();
      toast(hasResult ? '比赛信息与比赛数据已保存' : '比赛信息已保存', 'success');
      setTimeout(() => reloadKeepingScroll(), 400);
    } catch (err) {
      toast(err.message, 'error', 3800);
    }
  };
  modal.setFoot([
    btn('取消', { onClick: () => modal.close() }),
    btn('保存', { type: 'primary', onClick: save }),
  ]);
}

function titleOf(match, aiResult) {
  if (aiResult) return `AI 识图结果复核 · ${match.teamA.name} vs ${match.teamB.name}`;
  return `编辑比赛信息 · ${match.teamA.name} vs ${match.teamB.name}`;
}

// AI 识别到的对阵优先，其次是调用方指定的比赛，最后退回第一场未开赛的比赛
function resolveTarget(list, match, aiResult) {
  if (match) return match;
  const a = aiResult?.match?.registrationA?.id;
  const b = aiResult?.match?.registrationB?.id;
  if (a && b) {
    const hit = list.find((m) => [m.teamA.registrationId, m.teamB.registrationId].includes(a)
      && [m.teamA.registrationId, m.teamB.registrationId].includes(b));
    if (hit) return hit;
  }
  return list.find((m) => m.status === 'scheduled') || list[0] || null;
}

// ---------------- 表单渲染 ----------------
function buildForm(event, state, redraw) {
  const { match, ai } = state;
  const format = event.format || 'group_knockout';
  const isLeague = format === 'league';
  const isKnockout = match.stage === 'knockout';
  const aiM = ai?.match || null;
  const pick = (a, b) => (a !== undefined && a !== null && String(a).trim() !== '' ? a : b);

  // ---- ① 比赛信息 ----
  const teamSel = (id, current) => {
    const opts = [...(state.teams || [])];
    if (current && !opts.some((t) => t.id === current.id)) opts.push(current);
    return el('select', { id }, opts.map((t) => el('option', {
      value: t.id, selected: (current?.id || '') === t.id,
    }, t.teamName || t.name || '未知球队')));
  };
  const currentA = { id: match.teamA.registrationId, teamName: match.teamA.name };
  const currentB = { id: match.teamB.registrationId, teamName: match.teamB.name };
  const selA = teamSel('me-team-a', currentA);
  const selB = teamSel('me-team-b', currentB);
  // 换人/红黄牌的「球队」直接取当前主客队，做成下拉，省去手打队名
  const teamNamesNow = () => {
    const names = [];
    for (const sel of [selA, selB]) {
      const name = selectedTextOf(sel);
      if (name && !names.includes(name)) names.push(name);
    }
    if (!names.length) {
      for (const n of [match.teamA.name, match.teamB.name]) {
        if (n && !names.includes(n)) names.push(n);
      }
    }
    return names;
  };

  const infoRows = [
    el('div', { class: 'grid cols-2 me-grid' }, field('主队', selA), field('客队', selB)),
    el('div', { class: 'row', style: { gap: '10px' } },
      el('div', { style: { flex: '1' } }, field('日期', el('input', {
        id: 'me-date', type: 'date', value: pick(aiM?.date, match.date),
      }), false)),
      el('div', { style: { flex: '1' } }, field('时间', el('input', {
        id: 'me-time', type: 'time', value: pick(aiM?.time, match.time),
      }), false))),
    field('场地', el('input', {
      id: 'me-venue', value: pick(aiM?.venue, match.venue), placeholder: '如：西操场 1 号场',
    }), false),
    el('div', { class: 'grid cols-2 me-grid' },
      field('主裁判', el('input', {
        id: 'me-ref-main', value: pick(aiM?.referees?.main, match.referee), placeholder: '主裁判姓名',
      }), false),
      field('第一助理裁判', el('input', {
        id: 'me-ref-a1', value: pick(aiM?.referees?.assistant1, match.assistant1), placeholder: '一助姓名',
      }), false),
      field('第二助理裁判', el('input', {
        id: 'me-ref-a2', value: pick(aiM?.referees?.assistant2, match.assistant2), placeholder: '二助姓名',
      }), false),
      field('第四官员', el('input', {
        id: 'me-ref-fourth', value: pick(aiM?.referees?.fourth, match.fourthOfficial), placeholder: '第四官员姓名',
      }), false)),
    field('特殊情况说明', el('textarea', {
      id: 'me-note', rows: 2, placeholder: '如：比赛延期/中断/补时/申诉等',
    }, pick(aiM?.specialNote, match.specialNote)), false),
  ];
  if (!isLeague && !isKnockout) {
    infoRows.unshift(field('小组', el('select', { id: 'me-group' },
      ['A', 'B', 'C', 'D', 'E', 'F'].map((g) => el('option', {
        value: g, selected: (match.groupName || 'A') === g,
      }, `${g} 组`)))));
  }
  if (isKnockout) {
    const cur = match.knockoutRound || KO_ROUNDS[0];
    const isCustom = Boolean(cur) && !KO_ROUNDS.includes(cur);
    const roundSel = el('select', { id: 'me-round' },
      KO_ROUNDS.map((r) => el('option', { value: r, selected: cur === r }, r)),
      el('option', { value: CUSTOM_ROUND, selected: isCustom }, '自定义…'));
    const customIn = el('input', {
      id: 'me-round-custom', placeholder: '如：八强附加赛', value: isCustom ? cur : '',
    });
    const customWrap = field('自定义轮次名称', customIn);
    customWrap.style.display = isCustom ? 'block' : 'none';
    roundSel.addEventListener('change', () => {
      customWrap.style.display = roundSel.value === CUSTOM_ROUND ? 'block' : 'none';
    });
    infoRows.unshift(field('淘汰赛轮次', roundSel), customWrap);
  }
  if (isLeague) {
    infoRows.unshift(field('轮次', el('input', {
      id: 'me-league-round',
      placeholder: '如：第1轮（留空则不显示轮次）',
      value: match.roundName || '',
    }), false));
  }

  // ---- ② 比赛数据 ----
  const existingGoalsA = aiM ? normGoals(aiM.goals, 'A') : normGoals(match.goals, 'A');
  const existingGoalsB = aiM ? normGoals(aiM.goals, 'B') : normGoals(match.goals, 'B');
  const existingSubs = aiM ? normSubs(aiM.substitutions) : normSubs(match.substitutions);
  const existingCards = aiM ? normCards(aiM.cards) : normCards(match.cards);
  // 进球行数取「比分」与「识别到的进球条数」的较大值：
  // 两者对不上时也不会把多出来的进球记录藏起来，交给操作人核对后删改。
  const initScoreA = aiM
    ? Math.max(Number(aiM.scoreA) || 0, existingGoalsA.length)
    : (match.status === 'finished' ? match.scoreA : '');
  const initScoreB = aiM
    ? Math.max(Number(aiM.scoreB) || 0, existingGoalsB.length)
    : (match.status === 'finished' ? match.scoreB : '');

  const goalsA = el('div', { id: 'me-goals-a' });
  const goalsB = el('div', { id: 'me-goals-b' });
  const scoreAIn = numberInput('me-score-a', initScoreA);
  const scoreBIn = numberInput('me-score-b', initScoreB);
  const syncGoals = (box, side, value) => {
    const kept = [...box.querySelectorAll('.goal-row')].map(readGoalRow);
    renderGoalRows(box, side, clamp(value), kept);
  };
  scoreAIn.addEventListener('input', () => syncGoals(goalsA, 'A', scoreAIn.value));
  scoreBIn.addEventListener('input', () => syncGoals(goalsB, 'B', scoreBIn.value));
  renderGoalRows(goalsA, 'A', clamp(initScoreA), existingGoalsA);
  renderGoalRows(goalsB, 'B', clamp(initScoreB), existingGoalsB);

  const subsBox = el('div', { id: 'me-subs' });
  const cardsBox = el('div', { id: 'me-cards' });
  existingSubs.forEach((s) => addSubRow(subsBox, s, teamNamesNow));
  existingCards.forEach((c) => addCardRow(cardsBox, c, teamNamesNow));
  // 改了主客队，已有行里的球队下拉同步刷新
  const syncRowTeams = () => {
    const names = teamNamesNow();
    const rows = [
      ...subsBox.querySelectorAll('.s-team'),
      ...cardsBox.querySelectorAll('.c-team'),
    ];
    for (const sel of rows) fillTeamSelect(sel, names);
  };
  selA.addEventListener('change', syncRowTeams);
  selB.addEventListener('change', syncRowTeams);

  const dataRows = [
    el('div', { class: 'score-inputs match-editor-score' },
      el('div', {}, label('主队进球'), scoreAIn),
      el('span', { class: 'vs' }, 'VS'),
      el('div', {}, label('客队进球'), scoreBIn)),
    el('div', { class: 'me-hint center' },
      match.status === 'finished'
        ? '本场已完赛；改动比分与事件后保存即时生效。'
        : '比分留空表示本场尚未开赛；填写比分并保存后本场标记为「已完赛」。'),
    el('div', { class: 'section-title lv2' }, '双方名单（从报名名单里点选）'),
    el('div', { class: 'me-note' },
      '左边主队、右边客队；每队先是首发、下面是替补。首发名单必须正好有 1 名守门员和 1 名队长（🧤 守门员 / © 队长）。'),
    el('div', { class: 'grid cols-2 me-grid' },
      lineupTeamBlock('A', match.teamA.name, state.lineup.A),
      lineupTeamBlock('B', match.teamB.name, state.lineup.B)),
    el('div', { class: 'section-title lv2' }, '主队进球球员'),
    goalsA,
    el('div', { class: 'section-title lv2' }, '客队进球球员'),
    goalsB,
    el('div', { class: 'row between me-subhead' },
      el('div', { class: 'section-title lv2', style: { margin: 0 } }, '换人记录'),
      el('button', {
        class: 'btn sm outline', type: 'button',
        onclick: () => addSubRow(subsBox, {}, teamNamesNow),
      }, '＋ 添加')),
    subsBox,
    el('div', { class: 'row between me-subhead' },
      el('div', { class: 'section-title lv2', style: { margin: 0 } }, '红黄牌记录'),
      el('button', {
        class: 'btn sm outline', type: 'button',
        onclick: () => addCardRow(cardsBox, {}, teamNamesNow),
      }, '＋ 添加')),
    cardsBox,
  ];

  // ---- ③ 工作人员 ----
  const staffRows = STAFF_FIELDS.map(([key, labelText]) => field(labelText, el('input', {
    id: `me-staff-${key}`,
    value: pick(aiM?.staff?.[key], match.matchStaff?.[key]),
    placeholder: staffPlaceholder(key, labelText),
  }), false));

  return el('div', { class: 'match-editor' },
    el('div', { class: 'section-title lv1' }, '一、比赛信息'),
    ...infoRows,
    el('div', { class: 'section-title lv1' }, '二、比赛数据'),
    ...dataRows,
    el('div', { class: 'section-title lv1' }, '三、工作人员'),
    el('div', { class: 'me-note' },
      '裁判组在主裁判/第一助理/第二助理/第四官员中填写；此处填写比赛监督、拍照、录像、解说、战报。'),
    el('div', { class: 'grid cols-2 me-grid' }, ...staffRows),
  );
}

// ---------------- 双方名单（左主队 / 右客队，各队首发在上、替补在下）----------------
const byNo = (a, b) => (parseInt(a.no, 10) || 999) - (parseInt(b.no, 10) || 999)
  || String(a.name).localeCompare(String(b.name), 'zh-Hans-CN');

function lineupTeamBlock(side, teamName, teamState) {
  const root = el('div', { class: 'lineup-side', dataset: { side } });
  const counters = el('div', { class: 'lp-counters small' });
  const lists = el('div', { class: 'lp-lists' });
  const colorIn = el('input', {
    id: `me-color-${side.toLowerCase()}`, value: teamState.color, placeholder: '如：红白',
  });
  colorIn.addEventListener('input', () => { teamState.color = colorIn.value.trim(); });
  root.append(
    el('div', { class: 'lp-head' },
      el('div', { class: 'lp-team' }, teamName),
      el('div', { class: 'lp-color' },
        el('span', { class: 'small muted' }, '比赛服颜色'), colorIn)),
    counters,
    lists);

  const render = () => {
    clear(lists);
    const start = teamState.rows.filter((r) => r.status === 'start').sort(byNo);
    const benchRows = teamState.rows.filter((r) => r.status === 'bench').sort(byNo);
    const idle = teamState.rows.filter((r) => r.status === 'none').sort(byNo);
    const captains = start.filter((r) => r.captain).length;
    const keepers = start.filter((r) => r.gk).length;
    const okFlags = !start.length || (captains === 1 && keepers === 1);
    clear(counters);
    counters.className = `lp-counters small ${okFlags ? 'muted' : 'lp-warn'}`;
    counters.append(el('span', {},
      `首发 ${start.length} 人 · 🧤 ${keepers} · © ${captains}`
      + (okFlags ? '' : '　首发必须有且只有 1 名守门员、1 名队长')));
    lists.append(
      lineupList('start', `首发（${start.length} 人）`, start, teamState, render),
      lineupList('bench', `替补（${benchRows.length} 人）`, benchRows, teamState, render),
      lineupList('none', `未上场（${idle.length} 人）`, idle, teamState, render),
      lineupExtraBlock(teamState, render));
  };
  render();
  return root;
}

function lineupList(status, title, rows, teamState, render) {
  return el('div', { class: 'lineup-list', dataset: { status } },
    el('div', { class: 'lp-list-title' }, title),
    ...rows.map((row) => lineupRow(row, teamState, render)),
    rows.length ? null : el('div', { class: 'small muted lp-empty' }, '（无）'));
}

function lineupRow(row, teamState, render) {
  const flagBtn = (flag, text, on, enabled, title) => el('button', {
    class: `lp-flag ${flag}${on ? ' on' : ''}`,
    type: 'button',
    title,
    disabled: enabled ? undefined : true,
    onclick: () => { toggleFlag(teamState, row.id, flag); render(); },
  }, text);
  const statusSel = el('select', {
    class: 'lp-status',
    onchange: (e) => { setStatus(teamState, row.id, e.target.value); render(); },
  }, ['none', 'start', 'bench'].map((s) => el('option', {
    value: s, selected: row.status === s,
  }, STATUS_LABEL[s])));
  return el('div', {
    class: `lineup-row${row.extra ? ' extra' : ''}`,
    dataset: { id: row.id, status: row.status, extra: row.extra ? '1' : '0' },
  },
  row.extra
    ? el('input', {
      class: 'lp-no-in', value: row.no, placeholder: '号',
      oninput: (e) => updateExtraPlayer(teamState, row.id, { no: e.target.value }),
    })
    : el('span', { class: 'lp-no' }, row.no || '—'),
  row.extra
    ? el('input', {
      class: 'lp-name-in', value: row.name, placeholder: '姓名',
      oninput: (e) => updateExtraPlayer(teamState, row.id, { name: e.target.value }),
    })
    : el('span', { class: 'lp-name' }, row.name),
  flagBtn('gk', '🧤', row.gk, row.status !== 'none',
    '本场守门员（首发必须有且只有 1 名；替补可标备选门将）'),
  flagBtn('captain', '©', row.captain, row.status === 'start',
    '本场队长（只能在首发，且只能一名）'),
  statusSel,
  row.extra ? el('button', {
    class: 'icon-btn', type: 'button', html: '✕',
    onclick: () => { removeRow(teamState, row.id); render(); },
  }) : null);
}

// 名单外球员：不在报名名单里的人（AI 识别到或临时加的），保留在名单里单独标出，
// 绝不能因为"不在报名名单"就丢掉
function lineupExtraBlock(teamState, render) {
  const extras = teamState.rows.filter((r) => r.extra);
  return el('div', { class: 'lp-extra' },
    el('div', { class: 'lp-list-title' },
      `名单外球员（${extras.length} 人）`,
      el('span', { class: 'small muted' }, '　不在报名名单里的人，会保留在名单中')),
    extras.length
      ? el('div', { class: 'small muted lp-empty' }, '上面带「⚠」底色的就是他们')
      : el('div', { class: 'small muted lp-empty' }, '（无）'),
    el('button', {
      class: 'btn sm outline', type: 'button',
      onclick: () => { addExtraPlayer(teamState); render(); },
    }, '＋ 添加名单外球员'));
}

function field(labelText, input, required = true) {
  return el('label', { class: 'field' },
    el('span', { class: required ? 'required' : '' }, labelText), input);
}

function label(text) {
  return el('div', { class: 'small muted' }, text);
}

  function numberInput(id, value) {
  return el('input', {
    id, type: 'number', min: 0, max: 99,
    value: (value === '' || value === null || value === undefined) ? '' : Number(value),
    inputmode: 'numeric', placeholder: '未开赛',
    style: { textAlign: 'center', fontWeight: '700' },
  });
}

function clamp(v) {
  const n = Math.max(0, Math.min(99, Number(v) || 0));
  return Number.isInteger(n) ? n : 0;
}

function readGoalRow(row) {
  return {
    no: row.querySelector('.g-no').value.trim(),
    player: row.querySelector('.g-player').value.trim(),
    time: row.querySelector('.g-time').value.trim(),
    penalty: row.querySelector('.g-penalty').checked,
  };
}

function renderGoalRows(box, side, count, rows = []) {
  clear(box);
  for (let i = 0; i < count; i += 1) {
    const init = rows[i] || {};
    box.append(el('div', {
      class: 'goal-row result-edit-row',
      dataset: { side },
      style: EVENT_ROW_STYLE,
    },
    el('input', {
      class: 'g-no num', placeholder: '号', value: init.no || '', style: { flex: '0 0 58px' },
    }),
    el('input', {
      class: 'g-player', placeholder: `第 ${i + 1} 球球员`, value: init.player || '',
      style: { flex: '1 1 118px', minWidth: '0' },
    }),
    el('input', {
      class: 'g-time num', placeholder: "23'", value: init.time || '', style: { flex: '0 0 78px' },
    }),
    el('label', { class: 'row me-check' },
      el('input', { class: 'g-penalty', type: 'checkbox', checked: Boolean(init.penalty), style: { width: 'auto' } }),
      '点球')));
  }
}

// 换人 / 红黄牌事件行：字段较多，用可换行的弹性行，窄屏自动折成两行，
// 避免在一行里被挤扁或横向溢出。
const EVENT_ROW_STYLE = {
  display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center',
  marginBottom: '6px',
};

function addSubRow(box, init = {}, teamNames = () => []) {
  const row = el('div', { class: 'sub-row result-edit-row', style: EVENT_ROW_STYLE },
    teamSelectBox('s-team', init.team, teamNames),
    el('input', {
      class: 's-off', placeholder: '下场球员', value: init.offPlayer || '',
      style: { flex: '1 1 88px', minWidth: '0' },
    }),
    el('input', {
      class: 's-offNo num', placeholder: '号', value: init.offNo || '',
      style: { flex: '0 0 52px' },
    }),
    el('input', {
      class: 's-on', placeholder: '上场球员', value: init.onPlayer || '',
      style: { flex: '1 1 88px', minWidth: '0' },
    }),
    el('input', {
      class: 's-onNo num', placeholder: '号', value: init.onNo || '',
      style: { flex: '0 0 52px' },
    }),
    el('input', {
      class: 's-time num', placeholder: "46'", value: init.time || '',
      style: { flex: '0 0 68px' },
    }),
    el('button', { class: 'icon-btn', type: 'button', html: '✕', onclick: () => row.remove() }));
  box.append(row);
}

function addCardRow(box, init = {}, teamNames = () => []) {
  const row = el('div', { class: 'card-row result-edit-row', style: EVENT_ROW_STYLE },
    teamSelectBox('c-team', init.team, teamNames),
    el('input', {
      class: 'c-player', placeholder: '球员', value: init.player || '',
      style: { flex: '1 1 88px', minWidth: '0' },
    }),
    el('input', {
      class: 'c-no num', placeholder: '号', value: init.no || '',
      style: { flex: '0 0 52px' },
    }),
    el('select', { class: 'c-type', style: { flex: '0 0 88px' } },
      el('option', { value: 'yellow', selected: init.type !== 'red' }, '黄牌'),
      el('option', { value: 'red', selected: init.type === 'red' }, '红牌')),
    el('input', {
      class: 'c-time num', placeholder: "33'", value: init.time || '',
      style: { flex: '0 0 68px' },
    }),
    el('button', { class: 'icon-btn', type: 'button', html: '✕', onclick: () => row.remove() }));
  box.append(row);
}

// 球队下拉：选项来自当前的主队 / 客队
function teamSelectBox(cls, value, teamNames) {
  const sel = el('select', { class: cls });
  fillTeamSelect(sel, teamNames(), value);
  return sel;
}

// 用给定的球队名重建下拉；已有取值若不在列表里则保留，避免误改已录入的数据
function fillTeamSelect(sel, names, preset = null) {
  const current = (preset === null || preset === undefined) ? sel.value : preset;
  const all = [...names];
  if (current && !all.includes(current)) all.push(current);
  if (!all.length) all.push('');
  clear(sel);
  for (const n of all) {
    sel.append(el('option', { value: n, selected: current ? current === n : n === all[0] }, n || '选择球队'));
  }
  sel.value = current || all[0];
}

function selectedTextOf(sel) {
  if (!sel) return '';
  const opts = sel.options ? [...sel.options] : [];
  const opt = sel.selectedIndex >= 0 ? opts[sel.selectedIndex] : opts[0];
  return String((opt && opt.textContent) || sel.value || '').trim();
}

// ---------------- 读取表单 ----------------
function collect(body, state) {
  const match = state.match;
  const q = (sel) => body.querySelector(sel);
  const val = (sel) => (q(sel) ? q(sel).value.trim() : '');
  const scoreOf = (sel) => (q(sel) && String(q(sel).value).trim() !== '' ? clamp(q(sel).value) : null);
  const scoreA = scoreOf('#me-score-a');
  const scoreB = scoreOf('#me-score-b');
  const readRows = (sel, map) => [...body.querySelectorAll(sel)].map(map);
  const roundSel = q('#me-round');
  const knockoutRound = roundSel
    ? (roundSel.value === CUSTOM_ROUND ? val('#me-round-custom') : roundSel.value)
    : '';
  return {
    // ① 比赛信息
    teamAId: val('#me-team-a'),
    teamBId: val('#me-team-b'),
    groupName: q('#me-group') ? val('#me-group') : undefined,
    knockoutRound: match.stage === 'knockout' ? knockoutRound : undefined,
    roundName: q('#me-league-round') ? val('#me-league-round') : undefined,
    date: val('#me-date'),
    time: val('#me-time'),
    venue: val('#me-venue'),
    referee: val('#me-ref-main'),
    assistant1: val('#me-ref-a1'),
    assistant2: val('#me-ref-a2'),
    fourthOfficial: val('#me-ref-fourth'),
    specialNote: val('#me-note'),
    // ② 比赛数据
    scoreA,
    scoreB,
    goalsA: readRows('.goal-row[data-side="A"]', readGoalRow),
    goalsB: readRows('.goal-row[data-side="B"]', readGoalRow),
    substitutions: readRows('.sub-row', (row) => ({
      team: row.querySelector('.s-team').value.trim(),
      offNo: row.querySelector('.s-offNo').value.trim(),
      offPlayer: row.querySelector('.s-off').value.trim(),
      onNo: row.querySelector('.s-onNo').value.trim(),
      onPlayer: row.querySelector('.s-on').value.trim(),
      time: row.querySelector('.s-time').value.trim(),
    })).filter((s) => s.offPlayer || s.onPlayer),
    cards: readRows('.card-row', (row) => ({
      team: row.querySelector('.c-team').value.trim(),
      player: row.querySelector('.c-player').value.trim(),
      no: row.querySelector('.c-no').value.trim(),
      type: row.querySelector('.c-type').value,
      time: row.querySelector('.c-time').value.trim(),
    })).filter((c) => c.player),
    lineupA: toPayload(state.lineup.A),
    lineupB: toPayload(state.lineup.B),
    // ③ 工作人员
    matchStaff: Object.fromEntries(STAFF_FIELDS.map(([key]) => [key, val(`#me-staff-${key}`)])),
    source: 'manual',
  };
}

  // ---------------- 兼容三种来源的数据结构 ----------------
  // AI 识别结果用 camelCase，数据库读出来的是 snake_case
function normGoals(list, side) {
  return (list || []).filter((g) => !g.side || g.side === side).map((g) => ({
    no: String(g.no ?? g.player_no ?? '').trim(),
    player: String(g.player || '').trim(),
    time: String(g.time ?? g.goal_time ?? '').trim(),
    penalty: Boolean(g.penalty ?? g.is_penalty),
  }));
}

function normSubs(list) {
  return (list || []).map((s) => ({
    team: String(s.team || '').trim(),
    offNo: String(s.offNo ?? s.off_no ?? '').trim(),
    offPlayer: String(s.offPlayer ?? s.off_player ?? '').trim(),
    onNo: String(s.onNo ?? s.on_no ?? '').trim(),
    onPlayer: String(s.onPlayer ?? s.on_player ?? '').trim(),
    time: String(s.time ?? s.sub_time ?? '').trim(),
  }));
}

function normCards(list) {
  return (list || []).map((c) => ({
    team: String(c.team || '').trim(),
    no: String(c.no ?? c.player_no ?? '').trim(),
    player: String(c.player || '').trim(),
    type: String((c.type ?? c.card_type) || '') === 'red' ? 'red' : 'yellow',
    time: String(c.time ?? c.card_time ?? '').trim(),
  }));
}
