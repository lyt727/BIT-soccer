import { api, session, hasPerm } from '../lib/api.js';
import {
  el, clear, toast, btn, empty, confirmBox, openModal, badge, statusBadge, reloadKeepingScroll,
} from '../lib/ui.js';
import { openAiFlow } from './stats.js';
import { openMatchEditor } from './match-editor.js';
import { exportExcel } from '../lib/export.js';

export async function renderSchedule(container, event) {
  clear(container);
  const isAdmin = session.user?.role === 'admin'
    || (hasPerm(session.user, 'match.manage') && event.staffRole === 'admin');
  try {
    const matches = await api(`/events/${event.id}/matches`);
    container.append(el('div', { class: 'section-title' },
      '赛程安排',
      el('small', {}, `共 ${matches.length} 场，按时间排序`)));
    container.append(btn('导出到Excel（全部比赛）', {
      type: 'outline', cls: 'block', style: { marginBottom: '8px' },
      onClick: () => exportSchedule(matches, event),
    }));
    if (isAdmin && event.status === 'live') {
      container.append(btn('＋ 添加比赛', {
        type: 'primary', cls: 'block', onClick: () => addMatchFlow(event),
      }));
    }
    const canAi = hasPerm(session.user, 'result.record') && event.staffRole && event.status !== 'ended';
    if (!isAdmin && canAi && event.status === 'live') {
      container.append(btn('＋ 添加淘汰赛', {
        type: 'primary', cls: 'block', onClick: () => addMatchFlow(event, 'knockout'),
      }));
    }
    if (!matches.length) {
      container.append(empty('暂无已安排的比赛', '📅'));
      return;
    }
    for (const m of matches) container.append(matchCard(m, isAdmin, event, matches, canAi));
  } catch (err) {
    container.append(empty(err.message, '⚠️'));
  }
}

function exportSchedule(matches, event) {
  exportExcel(
    `${event.name}-赛程安排`,
    '赛程安排',
    ['日期', '时间', '主队', '客队', '比分', '状态', '场地',
      '阶段', '组别', '轮次', '主裁判', '第一助理', '第二助理', '第四官员'],
    matches.map((m) => [
      m.date,
      m.time,
      m.teamA?.name || '',
      m.teamB?.name || '',
      m.status === 'finished' ? `${m.scoreA}:${m.scoreB}` : '未开赛',
      m.status === 'finished' ? '已完赛' : '未开赛',
      m.venue || '',
      m.stage === 'knockout' ? '淘汰赛'
        : ((event.format || 'group_knockout') === 'league' ? '联赛' : '小组赛'),
      m.stage === 'knockout' ? '' : (m.groupName || ''),
      m.stage === 'knockout' ? (m.knockoutRound || '') : (m.roundName || ''),
      m.referee || '',
      m.assistant1 || '',
      m.assistant2 || '',
      m.fourthOfficial || '',
    ]),
  );
}

function matchCard(m, isAdmin, event, matches, canAi) {
  const scoreText = m.status === 'finished'
    ? el('span', { style: { fontSize: '19px', fontWeight: '700', color: '#075e32' } },
      `${m.scoreA} : ${m.scoreB}`)
    : el('span', { class: 'muted' }, 'VS');
  const summary = [];
  if (m.status === 'finished') {
    if (m.summary.yellowCards) summary.push(badge(`黄牌 ${m.summary.yellowCards}`, 'warn'));
    if (m.summary.redCards) summary.push(badge(`红牌 ${m.summary.redCards}`, 'rejected'));
    if (m.summary.substitutions) summary.push(badge(`换人 ${m.summary.substitutions}`, 'pending'));
  }
  // 比赛信息编辑：管理员与数据录入员都可以，参赛队员只读；
  // 赛事结束后比赛数据锁定，只有管理员还能改（与后端校验一致）
  const endedLocked = event.status === 'ended' && session.user?.role !== 'admin';
  const canManage = hasPerm(session.user, 'result.record') && Boolean(event.staffRole) && !endedLocked;
  const actions = canManage ? el('div', { class: 'row' },
    btn('编辑', {
      cls: 'sm', type: 'outline', onClick: () => editMatchFlow(event, m),
    }),
    btn('删除', {
      cls: 'sm', danger: true, onClick: () => deleteMatch(m),
    })) : null;
  return el('div', { class: 'list-item', style: { alignItems: 'flex-start' } },
    el('div', { class: 'main' },
      el('div', { class: 'row wrap' },
        el('b', {}, `${m.date} ${m.time}`),
        statusBadge(m.status),
        badge(m.stage === 'knockout'
          ? `淘汰赛·${m.knockoutRound || '待定'}`
          : ((event.format || 'group_knockout') === 'league'
            ? `联赛${m.roundName ? `·${m.roundName}` : ''}`
            : `小组赛·${m.groupName || '-'}组`),
          m.stage === 'knockout' ? 'rejected' : 'player')),
      el('div', { class: 'row', style: { margin: '8px 0', gap: '14px' } },
        el('span', { style: { flex: '1', textAlign: 'right' } }, m.teamA.name),
        scoreText,
        el('span', { style: { flex: '1' } }, m.teamB.name)),
      el('div', { class: 'desc' },
        `场地：${m.venue} · 主裁：${m.referee || '-'} / 一助：${m.assistant1 || '-'} / 二助：${m.assistant2 || '-'} / 第四官员：${m.fourthOfficial || '-'}`),
      m.specialNote ? el('div', { class: 'warning-box mt8' }, `⚠ 特殊情况：${m.specialNote}`) : null,
      staffSummary(m) ? el('div', { class: 'small muted mt8' }, staffSummary(m)) : null,
      summary.length ? el('div', { class: 'row mt8' }, ...summary) : null,
      el('div', { class: 'row wrap mt8' },
        el('button', {
          class: 'btn sm outline', type: 'button',
          onclick: () => openMatchStats(m, event),
        }, m.status === 'finished' ? '📊 技术统计与时间轴' : '📋 名单与赛前信息'),
        canAi ? btn('🤖 AI 识图', {
          type: 'accent', cls: 'sm', onClick: () => openAiFlow(event, matches, null, m.id),
        }) : null,
        (canManage || m.report) ? btn(m.report ? '📝 查看AI战报' : '📝 AI 生成战报', {
          type: 'outline', cls: 'sm', onClick: () => openReportFlow(m, canManage),
        }) : null,
        // 特殊情况说明的快捷入口（内容同样在「编辑」统一界面里可改）
        canManage ? btn('✎ 特殊情况说明', {
          type: 'outline', cls: 'sm', onClick: () => editNoteModal(m),
        }) : null),
    ),
    actions);
}

// ---------------- AI 战报 ----------------
// 一个入口：没战报就生成，有战报就直接看（管理员/数据录入员还能就地编辑、复制、重新生成）。
// 重新生成每场只允许一次，这条限制在后端把关。
function openReportFlow(m, canManage) {
  if (!canManage) {
    showReportModal(m);   // 参赛队员：只读
    return;
  }
  if (m.report) {
    openReportEditor(m);
    return;
  }
  if (m.status !== 'finished') {
    const tip = openModal({
      title: '无法生成战报',
      body: el('div', {},
        el('div', { class: 'warning-box' }, '比赛尚未结束，无法生成战报。'),
        el('div', { class: 'small muted' },
          '请先在「编辑比赛信息」里录入比分与比赛事件，把这场标记为「已完赛」之后再来生成。')),
    });
    tip.setFoot([btn('知道了', { type: 'primary', onClick: () => tip.close() })]);
    return;
  }
  generateReport(m);
}

async function generateReport(m) {
  const modal = openModal({
    title: '正在生成战报…',
    body: el('div', { class: 'progress' },
      el('div', { class: 'spinner' }), '正在根据比分、进球、换人、红黄牌撰写战报…'),
  });
  try {
    const fresh = await api(`/matches/${m.id}/report`, { method: 'POST' });
    modal.close();
    toast(fresh.reportSource === 'ai'
      ? `战报已生成（${fresh.reportModel}）`
      : '战报已生成（本地模板）', 'success', 3200);
    openReportEditor(fresh, true);
  } catch (err) {
    modal.close();
    toast(err.message, 'error', 4200);
  }
}

// 参赛队员看到的：只有正文和一个复制按钮
function showReportModal(m) {
  const text = m.report || '';
  const box = openModal({
    title: `战报 · ${m.teamA.name} vs ${m.teamB.name}`,
    body: el('div', {},
      text
        ? el('div', { class: 'card', style: { whiteSpace: 'pre-wrap', lineHeight: '1.8', fontSize: '14px' } }, text)
        : el('div', { class: 'empty' }, '暂无战报', '📝')),
  });
  box.setFoot([
    text ? copyReportButton(text) : null,
    btn('关闭', { type: 'primary', onClick: () => box.close() }),
  ].filter(Boolean));
}

function copyReportButton(getText) {
  return btn('复制', {
    onClick: async () => {
      try {
        await navigator.clipboard.writeText(typeof getText === 'function' ? getText() : getText);
        toast('战报已复制', 'success');
      } catch {
        toast('复制失败，请手动选择文本', 'error');
      }
    },
  });
}

// 管理员 / 数据录入员：看得见正文、能就地改、能复制、能重新生成一次
function openReportEditor(m, isNew = false) {
  let dirty = false;
  let regenCount = Number(m.reportRegenCount) || 0;
  const sourceLine = m.reportSource === 'ai' ? `由 ${m.reportModel || 'AI'} 生成`
    : (isNew ? '由本地模板生成（未配置 AI 或调用失败）' : '');
  const area = el('textarea', {
    id: 'report-text', rows: 9,
    style: { lineHeight: '1.7' },
    placeholder: '（暂无战报）',
  }, m.report || '');
  const hint = el('div', { class: 'me-hint' },
    regenCount >= 1
      ? '这场比赛已经重新生成过一次，还想改动请直接编辑上面的正文。'
      : '点「重新生成」会生成新的内容，每场比赛只允许重新生成一次。');
  const box = openModal({
    title: `战报 · ${m.teamA.name} vs ${m.teamB.name}`,
    body: el('div', {},
      sourceLine ? el('div', { class: 'small muted', style: { marginBottom: '6px' } }, sourceLine) : null,
      area,
      hint),
  });
  const save = async () => {
    try {
      await api(`/matches/${m.id}/report`, { method: 'PATCH', body: { report: area.value } });
      dirty = true;
      box.close();
      toast('战报已保存', 'success');
      reloadKeepingScroll();
    } catch (err) { toast(err.message, 'error', 3800); }
  };
  const regenerate = async () => {
    const okToGo = await confirmBox(
      '重新生成会用新内容覆盖当前正文，且每场比赛只允许重新生成一次。确定继续？',
      { title: '重新生成战报', okText: '重新生成' },
    );
    if (!okToGo) return;
    box.close();
    generateReport(m);
  };
  box.setFoot([
    copyReportButton(() => area.value),
    regenCount < 1 ? btn('重新生成', { onClick: regenerate }) : null,
    btn('保存', { type: 'primary', onClick: save }),
    btn('关闭', {
      onClick: () => { box.close(); if (dirty) reloadKeepingScroll(); },
    }),
  ].filter(Boolean));
}

// 「技术统计与时间轴」只做展示：编辑统一走每场比赛的「编辑」按钮
function openMatchStats(m, event) {
  const A = m.teamA.name;
  const B = m.teamB.name;
  const lineupBlock = (teamName, lineup) => el('div', { class: 'card', style: { flex: '1', margin: 0 } },
    el('div', { class: 'row between' },
      el('b', {}, teamName),
      lineup?.color ? badge(lineup.color, 'pending') : null,
      lineup?.starting?.length ? badge(`${lineup.starting.length} 首发`, 'approved') : null),
    el('div', { class: 'section-title', style: { margin: '10px 0 4px' } }, '首发'),
    lineup?.starting?.length
      // 只显示号码与姓名，不用 1、2、3… 的列表序号（号码本身已经足够定位球员）
      ? el('div', { class: 'small', style: { lineHeight: '1.9' } },
        lineup.starting.map((p) => el('div', {}, p.no ? `${p.no} 号 ${p.name}` : p.name)))
      : el('div', { class: 'small muted' }, '尚未录入'),
    el('div', { class: 'section-title', style: { margin: '10px 0 4px' } }, '替补'),
    lineup?.substitutes?.length
      ? el('div', { class: 'small', style: { lineHeight: '1.8' } },
        lineup.substitutes.map((p) => p.no ? `${p.no} 号 ${p.name}` : p.name).join('、'))
      : el('div', { class: 'small muted' }, '尚未录入'));

  const body = el('div', {},
    el('div', { class: 'score-inputs', style: { marginBottom: '12px' } },
      el('div', {}, el('b', {}, A)),
      el('span', { class: 'vs' }, m.status === 'finished' ? `${m.scoreA} : ${m.scoreB}` : 'VS'),
      el('div', {}, el('b', {}, B))),
    el('div', { class: 'small muted', style: { textAlign: 'center', marginBottom: '12px' } },
      `${m.date} ${m.time} · ${m.venue} · 主裁 ${m.referee || '-'} / 一助 ${m.assistant1 || '-'} / 二助 ${m.assistant2 || '-'} / 第四官员 ${m.fourthOfficial || '-'}`),
    el('div', { class: 'grid cols-2' }, lineupBlock(A, m.lineups?.A), lineupBlock(B, m.lineups?.B)),
    el('div', { class: 'section-title' }, '比赛时间轴（进球 / 红黄牌 / 换人）'),
    timelineBlock(m, A, B),
    el('div', { class: 'section-title' }, '战报'),
    m.report
      ? el('div', { class: 'card', style: { whiteSpace: 'pre-wrap', lineHeight: '1.8', fontSize: '14px' } }, m.report)
      : el('div', { class: 'empty' }, '暂无战报', '📝'),
    el('div', { class: 'section-title' }, '比赛工作人员（裁判组之外）'),
    staffBlock(m),
  );
  openModal({ title: `技术统计 · ${A} vs ${B}`, body, foot: [] });
}

const STAFF_FIELDS = [
  ['supervisor', '比赛监督'],
  ['photographer', '拍照'],
  ['videographer', '录像'],
  ['commentator', '解说'],
  ['reporter', '战报'],
];
function staffSummary(m) {
  const parts = STAFF_FIELDS
    .map(([key, label]) => (m.matchStaff?.[key] ? `${label}：${m.matchStaff[key]}` : null))
    .filter(Boolean);
  return parts.length ? parts.join(' · ') : '';
}

// 只读展示；编辑在「编辑比赛信息」统一界面里
function staffBlock(m) {
  return el('div', { class: 'card' },
    ...STAFF_FIELDS.map(([key, label]) => el('div', { class: 'small' },
      `${label}：${m.matchStaff?.[key] || '未填写'}`)));
}

function timelineBlock(m, teamA, teamB) {
  if (m.status !== 'finished') {
    return el('div', { class: 'empty' }, '比赛结束后将在此生成事件时间轴', '⏱');
  }
  if (!m.timeline?.length) {
    return el('div', { class: 'empty' }, '本场暂无进球 / 红黄牌 / 换人记录', '📄');
  }
  const tl = el('div', { class: 'timeline' });
  for (const ev of m.timeline) {
    const dotCls = {
      goal: 'goal', yellow_card: 'yellow', red_card: 'red', sub: 'sub',
    }[ev.type] || '';
    const icon = {
      goal: '⚽', yellow_card: '🟨', red_card: '🟥', sub: '🔄',
    }[ev.type] || '';
    const label = ev.type === 'goal'
      ? el('span', {}, `${ev.team} · ${ev.no ? `${ev.no} 号 ` : ''}${ev.player}${ev.penalty ? '（点球）' : ''}`)
      : ev.type === 'sub'
        ? el('span', {}, `${ev.team} · ${ev.offNo ? `${ev.offNo} 号 ` : ''}${ev.offPlayer} ↓ 换上 ${ev.onNo ? `${ev.onNo} 号 ` : ''}${ev.onPlayer}`)
        : el('span', {}, `${ev.team} · ${ev.no ? `${ev.no} 号 ` : ''}${ev.player}${ev.type === 'red_card' ? ' 红牌' : ' 黄牌'}`);
    tl.append(el('div', { class: 'tl-item' },
      el('span', { class: 'tl-time' }, ev.time || ''),
      el('span', { class: `tl-dot ${dotCls}` }, icon),
      el('div', { class: 'tl-text' }, label)));
  }
  return tl;
}

async function teamOptions(event) {
  const regs = await api(`/events/${event.id}/registrations?status=approved`);
  return regs;
}

async function addMatchFlow(event, forcedStage = null) {
  let teams = [];
  try {
    teams = await teamOptions(event);
  } catch (err) { toast(err.message, 'error'); return; }
  if (teams.length < 2) { toast('已通过球队不足 2 支，无法排赛', 'error'); return; }
  const modal = openModal({
    title: forcedStage === 'knockout' ? '添加淘汰赛' : '添加比赛',
    body: matchFormBody(teams, null, forcedStage, event.format || 'group_knockout'),
  });
  const submit = async () => {
    try {
      const payload = collectMatchForm(modal.body);
      await api(`/events/${event.id}/matches`, { method: 'POST', body: payload });
      modal.close();
      toast('比赛已加入赛程', 'success');
      reloadKeepingScroll();
    } catch (err) { toast(err.message, 'error'); }
  };
  modal.setFoot([btn('取消', { onClick: () => modal.close() }),
    btn('添加比赛', { type: 'primary', onClick: submit })]);
}

async function editMatchFlow(event, match) {
  // 统一编辑界面：比赛信息 + 比赛数据 + 工作人员，一次提交
  await openMatchEditor({ event, match });
}

const KO_ROUNDS = ['1/8决赛', '1/4决赛', '半决赛', '三四名决赛', '决赛'];
const CUSTOM_ROUND = '__custom__';

function matchFormBody(teams, match, forcedStage = null, format = 'group_knockout') {
  const isLeague = format === 'league';
  const isKnockoutOnly = format === 'knockout';
  const selA = el('select', { id: 'mf-a' }, teams.map((t) => el('option', { value: t.id }, t.teamName)));
  const selB = el('select', { id: 'mf-b' }, teams.map((t) => el('option', { value: t.id }, t.teamName)));
  if (match) {
    selA.value = match.teamA.registrationId;
    selB.value = match.teamB.registrationId;
  }
  if (!match && teams[1]) selB.value = teams[1].id;
  const initialStage = match?.stage || forcedStage || (isKnockoutOnly ? 'knockout' : 'group');
  const stageSel = el('select', { id: 'mf-stage', disabled: Boolean(match) },
    el('option', { value: 'group', selected: initialStage === 'group' }, '小组赛'),
    el('option', { value: 'knockout', selected: initialStage === 'knockout' }, '淘汰赛'));
  const groupSel = el('select', { id: 'mf-group' },
    ['A', 'B', 'C', 'D', 'E', 'F'].map((g) => el('option', {
      value: g, selected: (match?.groupName || 'A') === g,
    }, `${g} 组`)));
  const currentKo = match?.knockoutRound || '1/8决赛';
  const roundSel = el('select', { id: 'mf-round' },
    KO_ROUNDS.map((r) => el('option', {
      value: r, selected: currentKo === r,
    }, r)),
    el('option', {
      value: CUSTOM_ROUND,
      selected: Boolean(match?.knockoutRound) && !KO_ROUNDS.includes(currentKo),
    }, '自定义…'));
  const customRound = el('input', {
    id: 'mf-round-custom',
    placeholder: '如：八强附加赛',
    value: KO_ROUNDS.includes(currentKo) ? '' : (match?.knockoutRound || ''),
  });
  const leagueRound = el('input', {
    id: 'mf-league-round',
    placeholder: '如：第1轮（留空则不显示轮次）',
    value: match?.roundName || '',
  });
  const groupWrap = field('小组', groupSel);
  const roundWrap = field('淘汰赛轮次', roundSel);
  const customWrap = field('自定义轮次名称', customRound);
  const leagueRoundWrap = field('轮次', leagueRound);
  const stageWrap = field('比赛阶段', stageSel);
  if (isLeague || isKnockoutOnly) stageWrap.style.display = 'none';
  const sync = () => {
    const ko = isKnockoutOnly || (!isLeague && stageSel.value === 'knockout');
    groupWrap.style.display = (!isLeague && !ko) ? 'block' : 'none';
    roundWrap.style.display = ko ? 'block' : 'none';
    customWrap.style.display = (ko && roundSel.value === CUSTOM_ROUND) ? 'block' : 'none';
    leagueRoundWrap.style.display = isLeague ? 'block' : 'none';
  };
  stageSel.addEventListener('change', sync);
  roundSel.addEventListener('change', sync);
  sync();
  return el('div', {},
    stageWrap,
    groupWrap,
    leagueRoundWrap,
    roundWrap,
    customWrap,
    field('主队', selA),
    field('客队', selB),
    el('div', { class: 'row', style: { gap: '10px' } },
      el('div', { style: { flex: '1' } }, field('日期', el('input', {
        id: 'mf-date', type: 'date', value: match?.date || '',
      }), false)),
      el('div', { style: { flex: '1' } }, field('时间', el('input', {
        id: 'mf-time', type: 'time', value: match?.time || '',
      }), false))),
      field('场地', el('input', {
      id: 'mf-venue', value: match?.venue || '', placeholder: '如：西操场 1 号场',
    }), false),
    el('div', { class: 'grid cols-2', style: { gap: '8px' } },
      field('主裁判', el('input', { id: 'mf-referee', value: match?.referee || '', placeholder: '主裁判姓名' }), false),
      field('第一助理裁判', el('input', { id: 'mf-assistant1', value: match?.assistant1 || '', placeholder: '一助姓名' }), false),
      field('第二助理裁判', el('input', { id: 'mf-assistant2', value: match?.assistant2 || '', placeholder: '二助姓名' }), false),
      field('第四官员', el('input', { id: 'mf-fourth', value: match?.fourthOfficial || '', placeholder: '第四官员姓名' }), false)),
      field('特殊情况备注', el('textarea', {
      id: 'mf-note', rows: 2, value: match?.specialNote || '', placeholder: '如：比赛延期/中断/补时/申诉等',
    }), false),
    el('div', { class: 'grid cols-2', style: { gap: '8px', marginTop: '12px' } },
      el('label', { class: 'field' },
        el('span', {}, `${match?.teamA?.name || '主队'} 比赛服颜色`),
        el('input', { id: 'mf-colorA', value: match?.lineups?.A?.color || '', placeholder: '如：红白' })),
      el('label', { class: 'field' },
        el('span', {}, `${match?.teamB?.name || '客队'} 比赛服颜色`),
        el('input', { id: 'mf-colorB', value: match?.lineups?.B?.color || '', placeholder: '如：蓝黑' }))),
    el('div', { class: 'section-title', style: { marginTop: '14px' } },
        '双方名单（每行：号码 姓名）'),
    el('div', { class: 'grid cols-2' },
      lineupEditor('主队 · 首发', 'mf-lineupA-start', match?.lineups?.A?.starting || []),
      lineupEditor('主队 · 替补', 'mf-lineupA-bench', match?.lineups?.A?.substitutes || []),
      lineupEditor('客队 · 首发', 'mf-lineupB-start', match?.lineups?.B?.starting || []),
      lineupEditor('客队 · 替补', 'mf-lineupB-bench', match?.lineups?.B?.substitutes || [])),
  );
}

function lineupEditor(label, id, names) {
  const text = names.map((p) => (p.no ? `${p.no} ${p.name}` : p.name)).join('\n');
  return el('label', { class: 'field' },
    el('span', {}, label),
    el('textarea', {
      id, rows: 4, placeholder: '每行输入一名球员',
    }, text));
}

function linesOf(node) {
  return (node.value || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
}

function field(label, input, required = true) {
  return el('label', { class: 'field' },
    el('span', { class: required ? 'required' : '' }, label), input);
}

function collectMatchForm(body) {
  return {
    teamAId: body.querySelector('#mf-a').value,
    teamBId: body.querySelector('#mf-b').value,
    stage: body.querySelector('#mf-stage').value,
    groupName: body.querySelector('#mf-group').value,
    knockoutRound: (() => {
      const v = body.querySelector('#mf-round').value;
      return v === CUSTOM_ROUND ? body.querySelector('#mf-round-custom').value.trim() : v;
    })(),
    roundName: body.querySelector('#mf-league-round').value.trim(),
    date: body.querySelector('#mf-date').value,
    time: body.querySelector('#mf-time').value,
    venue: body.querySelector('#mf-venue').value.trim(),
    referee: body.querySelector('#mf-referee').value.trim(),
    assistant1: body.querySelector('#mf-assistant1').value.trim(),
    assistant2: body.querySelector('#mf-assistant2').value.trim(),
    fourthOfficial: body.querySelector('#mf-fourth').value.trim(),
    specialNote: body.querySelector('#mf-note').value.trim(),
    lineupA: {
      color: body.querySelector('#mf-colorA').value.trim(),
      starting: linesOf(body.querySelector('#mf-lineupA-start')),
      substitutes: linesOf(body.querySelector('#mf-lineupA-bench')),
    },
    lineupB: {
      color: body.querySelector('#mf-colorB').value.trim(),
      starting: linesOf(body.querySelector('#mf-lineupB-start')),
      substitutes: linesOf(body.querySelector('#mf-lineupB-bench')),
    },
  };
}

async function deleteMatch(match) {
  const ok = await confirmBox(
    match.status === 'finished'
      ? '该比赛已完赛，删除后将同时移除比分、进球与换人/红黄牌统计，确认删除？'
      : '确定删除这场未开赛的比赛吗？',
    { title: '删除比赛', okText: '删除', danger: true },
  );
  if (!ok) return;
  try {
    await api(`/matches/${match.id}`, { method: 'DELETE' });
    toast('比赛已删除', 'success');
    reloadKeepingScroll();
  } catch (err) { toast(err.message, 'error'); }
}

function editNoteModal(m) {
  const modal = openModal({
    title: `特殊情况说明 · ${m.teamA.name} vs ${m.teamB.name}`,
    body: el('div', {},
      el('p', { class: 'small muted' },
        '管理员或数据录入员可编辑，例如：延期、中断、补赛、争议判罚、空场等；参赛队员仅可阅读。'),
      el('label', { class: 'field' },
        el('span', {}, '备注内容'),
        el('textarea', {
          id: 'note-text', rows: 3,
          placeholder: '如：上半场因降雨中断约 5 分钟',
        }, m.specialNote || ''))),
  });
  const submit = async () => {
    try {
      const text = modal.body.querySelector('#note-text').value.trim();
      await api(`/matches/${m.id}/note`, { method: 'PATCH', body: { specialNote: text } });
      modal.close();
      toast('特殊情况说明已更新', 'success');
      reloadKeepingScroll();
    } catch (err) { toast(err.message, 'error'); }
  };
  modal.setFoot([
    btn('取消', { onClick: () => modal.close() }),
    btn('保存备注', { type: 'primary', onClick: submit }),
  ]);
}
