import { api, session, hasPerm } from '../lib/api.js';
import {
  el, clear, toast, btn, empty, openModal, badge, statBox, confirmBox,
} from '../lib/ui.js';
import { fileToDataUrl } from '../lib/api.js';
import { exportExcel } from '../lib/export.js';

export async function renderStats(container, event) {
  clear(container);
  const canRecord = hasPerm(session.user, 'result.record') && event.staffRole;
  try {
    const [matches, standings, scorers] = await Promise.all([
      api(`/events/${event.id}/matches`),
      api(`/events/${event.id}/standings`),
      api(`/events/${event.id}/scorers`),
    ]);
    container.append(el('div', { class: 'section-title' },
      '比赛结果与榜单',
      el('small', {}, '榜单由系统自动计算，胜 3 平 1 负 0')));
    const actions = el('div', { class: 'row wrap', style: { marginBottom: '4px' } });
    if (canRecord && event.status !== 'ended') {
      actions.append(btn('✍ 人工录入结果', {
        type: 'outline', cls: 'sm', onClick: () => openManualResult(event, matches),
      }));
      actions.append(el('span', { class: 'badge', style: { alignSelf: 'center' } },
        'AI 识图入口：赛程安排'));
    } else {
      actions.append(el('span', { class: 'small muted' },
        event.staffRole ? '录入功能仅对已指派工作人员开放' : '榜单只读'));
    }
    container.append(actions);
    container.append(el('div', { class: 'section-title mt8' }, '积分榜'));
    container.append(standingsTable(standings));
    container.append(el('div', { class: 'section-title' }, '射手榜'));
    container.append(scorersTable(scorers));
  } catch (err) {
    container.append(empty(err.message, '⚠️'));
  }
}

export async function renderLeaderboards(container, event) {
  clear(container);
  try {
    const [groupStandings, scorers, matches, cards] = await Promise.all([
      api(`/events/${event.id}/standings-by-group`),
      api(`/events/${event.id}/scorers`),
      api(`/events/${event.id}/matches`),
      api(`/events/${event.id}/card-stats`),
    ]);
    container.append(el('div', { class: 'section-title' },
      '小组赛积分榜',
      el('small', {}, '胜 3 平 1 负 0，按小组分别排名')));
    for (const group of groupStandings) {
      container.append(sectionWithExport(
        `${group.groupName} 组`, `${group.rows.length} 支球队`,
        `${event.name}-${group.groupName}组积分榜`,
        ['排名', '球队', '已赛', '胜', '平', '负', '进球', '失球', '净胜球', '积分'],
        group.rows.map((r) => [r.rank, r.teamName, r.played, r.win, r.draw, r.loss,
          r.goalsFor, r.goalsAgainst, r.goalDiff, r.points]),
      ));
      container.append(standingsTable(group.rows));
    }
    container.append(sectionWithExport(
      '射手榜', '', `${event.name}-射手榜`,
      ['排名', '球员', '球队', '总进球', '点球进球'],
      scorers.map((r) => [r.rank, r.player, r.teamName, r.goals, r.penalties]),
    ));
    container.append(scorersTable(scorers));

    container.append(sectionWithExport(
      '红牌榜', '红牌停赛一轮，停赛状态由管理员维护', `${event.name}-红牌榜`,
      ['排名', '号码', '球员', '球队', '红牌数', '状态'],
      cards.reds.map((r) => [r.rank, r.playerNo || '', r.player, r.teamName,
        r.redCards, r.statusLabel || '']),
    ));
    container.append(redCardsTable(cards.reds));
    container.append(sectionWithExport(
      '黄牌榜', '累计黄牌在“已完成停赛”后清零，总黄牌持续累加', `${event.name}-黄牌榜`,
      ['排名', '号码', '球员', '球队', '总黄牌数', '累计黄牌数', '状态'],
      cards.yellows.map((r) => [r.rank, r.playerNo || '', r.player, r.teamName,
        r.totalYellows, r.currentYellows, r.statusLabel || '']),
    ));
    container.append(yellowCardsTable(cards.yellows));
    if (hasPerm(session.user, 'suspension.manage')) {
      container.append(suspensionPanel(event, cards.suspensions,
        () => renderLeaderboards(container, event)));
    }
    const knockout = matches
      .filter((m) => m.stage === 'knockout')
      .sort((a, b) => {
        const order = { '1/8决赛': 1, '1/4决赛': 2, 半决赛: 3, 决赛: 4 };
        return (order[a.knockoutRound] || 9) - (order[b.knockoutRound] || 9)
          || String(a.date).localeCompare(String(b.date));
      });
    container.append(sectionWithExport(
      '淘汰赛赛果', '单回合淘汰赛，手动录入对阵与比分', `${event.name}-淘汰赛赛果`,
      ['轮次', '主队', '客队', '比分', '状态', '日期'],
      knockout.map((m) => [
        m.knockoutRound || '',
        m.teamA?.name || '',
        m.teamB?.name || '',
        m.status === 'finished' ? `${m.scoreA}:${m.scoreB}` : '未开赛',
        m.status === 'finished' ? '已完赛' : '未开赛',
        m.date,
      ]),
    ));
    container.append(knockout.length ? knockoutTable(knockout) : empty('暂无淘汰赛', '🏆'));
  } catch (err) {
    container.append(empty(err.message, '⚠️'));
  }
}

export async function renderStaffStats(container, event) {
  clear(container);
  try {
    const data = await api(`/events/${event.id}/staff-stats`);
    container.append(sectionWithExport(
      '裁判组统计', '按姓名统计执法场次', `${event.name}-裁判组统计`,
      ['角色', '姓名', '工作场次'],
      (data.referees || []).map((r) => [r.role, r.name, r.matches]),
    ));
    container.append(staffStatTable(data.referees, '暂无裁判数据'));
    container.append(sectionWithExport(
      '其他工作人员统计', '比赛监督 / 拍照 / 录像 / 解说 / 战报',
      `${event.name}-其他工作人员统计`,
      ['角色', '姓名', '工作场次'],
      (data.staff || []).map((r) => [r.role, r.name, r.matches]),
    ));
    container.append(staffStatTable(data.staff, '暂无工作人员数据'));
  } catch (err) {
    container.append(empty(err.message, '⚠️'));
  }
}

function sectionWithExport(title, subtitle, filename, headers, rows) {
  return el('div', { class: 'row between wrap', style: { margin: '20px 2px 10px' } },
    el('div', { class: 'section-title', style: { margin: 0 } }, title,
      subtitle ? el('small', {}, subtitle) : null),
    btn('导出到Excel', {
      cls: 'sm', type: 'outline',
      onClick: () => exportExcel(filename, title, headers, rows),
    }));
}

function staffStatTable(rows, emptyText) {
  if (!rows || !rows.length) return empty(emptyText, '🧑‍⚖️');
  const table = el('table', {},
    el('thead', {}, el('tr', {},
      el('th', {}, '角色'), el('th', {}, '姓名'), el('th', { class: 'num' }, '工作场次'))),
    el('tbody', {}, rows.map((r) => el('tr', {},
      el('td', {}, r.role),
      el('td', { style: { fontWeight: '500' } }, r.name),
      el('td', { class: 'num', style: { fontWeight: '700', color: '#0b7a43' } }, r.matches)))));
  return el('div', { class: 'table-card' }, el('div', { class: 'table-wrap' }, table));
}

// ---------------- 红黄牌榜与停赛台账 ----------------
const SUSP_COLOR = { pending: '#c62828', served: '#0b7a43', void: '#8a8f8c' };

function cardStatusCell(row) {
  if (!row.statusLabel) return el('span', { class: 'small muted' }, '—');
  return el('span', {
    style: {
      color: SUSP_COLOR[row.status] || '#333',
      fontWeight: '600', whiteSpace: 'nowrap',
    },
  }, row.statusLabel);
}

function redCardsTable(rows) {
  if (!rows.length) return empty('暂无红牌记录', '🟥');
  const table = el('table', {},
    el('thead', {}, el('tr', {},
      el('th', {}, '排名'), el('th', {}, '号码'), el('th', {}, '球员'),
      el('th', {}, '球队'), el('th', { class: 'num' }, '红牌'), el('th', {}, '状态'))),
    el('tbody', {}, rows.map((r) => el('tr', {},
      el('td', { class: 'num' }, r.rank),
      el('td', { class: 'num' }, r.playerNo || '—'),
      el('td', { style: { fontWeight: '500' } }, r.player),
      el('td', {}, r.teamName),
      el('td', { class: 'num', style: { fontWeight: '700', color: '#c62828' } }, r.redCards),
      el('td', {}, cardStatusCell(r))))));
  return el('div', { class: 'table-card' }, el('div', { class: 'table-wrap' }, table));
}

function yellowCardsTable(rows) {
  if (!rows.length) return empty('暂无黄牌记录', '🟨');
  const table = el('table', {},
    el('thead', {}, el('tr', {},
      el('th', {}, '排名'), el('th', {}, '号码'), el('th', {}, '球员'), el('th', {}, '球队'),
      el('th', { class: 'num' }, '总黄牌'), el('th', { class: 'num' }, '累计黄牌'),
      el('th', {}, '状态'))),
    el('tbody', {}, rows.map((r) => el('tr', {},
      el('td', { class: 'num' }, r.rank),
      el('td', { class: 'num' }, r.playerNo || '—'),
      el('td', { style: { fontWeight: '500' } }, r.player),
      el('td', {}, r.teamName),
      el('td', { class: 'num' }, r.totalYellows),
      el('td', { class: 'num', style: { fontWeight: '700', color: '#e08a00' } }, r.currentYellows),
      el('td', {}, cardStatusCell(r))))));
  return el('div', { class: 'table-card' }, el('div', { class: 'table-wrap' }, table));
}

function suspensionPanel(event, suspensions, reload) {
  const box = el('div', {});
  box.append(el('div', { class: 'row between wrap', style: { margin: '20px 2px 10px' } },
    el('div', { class: 'section-title', style: { margin: 0 } }, '停赛台账',
      el('small', {}, '全部人工维护：登记后为「下一轮停赛」，赛后标记「已完成停赛」即自动清零累计黄牌')),
    btn('＋ 登记停赛', {
      type: 'primary', cls: 'sm',
      onClick: () => openSuspensionForm(event, reload),
    })));
  if (!suspensions.length) {
    box.append(empty('暂无停赛记录', '🟥'));
    return box;
  }
  const patch = async (s, status, message) => {
    if (!await confirmBox(message)) return;
    try {
      const r = await api(`/suspensions/${s.id}`, { method: 'PATCH', body: { status } });
      toast(status === 'served'
        ? `已标记完成停赛，清零累计黄牌 ${r.clearedYellow} 张`
        : '已更新停赛状态', 'success');
      reload();
    } catch (err) { toast(err.message, 'error'); }
  };
  for (const s of suspensions) {
    box.append(el('div', { class: 'list-item' },
      el('div', { class: 'main' },
        el('div', { class: 'row wrap' },
          el('span', { class: 'title' }, `${s.player}${s.playerNo ? ` · ${s.playerNo} 号` : ''}`),
          el('span', { class: 'small muted' }, s.teamName),
          cardStatusCell(s)),
        el('div', { class: 'desc' },
          `${s.reasonLabel}${s.note ? ` · ${s.note}` : ''}`)),
      el('div', { class: 'row wrap' },
        s.status !== 'served' ? btn('已完成停赛', {
          cls: 'sm', type: 'outline',
          onClick: () => patch(s, 'served',
            `把「${s.player}」标记为已完成停赛？累计黄牌数将清零（总黄牌数不变）。`),
        }) : null,
        s.status !== 'void' ? btn('标记失效', {
          cls: 'sm', type: 'outline',
          onClick: () => patch(s, 'void', '标记为已失效（例如球队被淘汰、停赛无法执行）？'),
        }) : null,
        s.status !== 'pending' ? btn('恢复停赛', {
          cls: 'sm', type: 'outline',
          onClick: () => patch(s, 'pending', '恢复为「下一轮停赛」？'),
        }) : null,
        btn('删除', {
          cls: 'sm', type: 'outline',
          onClick: async () => {
            if (!await confirmBox(`删除「${s.player}」的停赛记录？`)) return;
            try {
              await api(`/suspensions/${s.id}`, { method: 'DELETE' });
              toast('已删除', 'success');
              reload();
            } catch (err) { toast(err.message, 'error'); }
          },
        }))));
  }
  return box;
}

const MEMBER_ROLE_LABEL = {
  head_coach: '主教练', manager: '领队', captain: '队长', player: '队员',
};

async function openSuspensionForm(event, onDone) {
  let regs = [];
  try {
    regs = await api(`/events/${event.id}/registrations`);
  } catch (err) { toast(err.message, 'error'); return; }
  const teams = (regs || []).filter((r) => r.status === 'approved');
  if (!teams.length) { toast('该赛事还没有已通过的报名球队', 'error'); return; }

  const teamSel = el('select', { id: 'susp-team' },
    teams.map((t) => el('option', { value: t.id }, t.teamName)));
  const playerSel = el('select', { id: 'susp-player' });
  const reasonSel = el('select', { id: 'susp-reason' },
    el('option', { value: 'red_card' }, '红牌'),
    el('option', { value: 'yellow_accumulation' }, '累计黄牌'));
  const noteInput = el('input', { id: 'susp-note', placeholder: '备注（可选）' });

  const fillPlayers = () => {
    clear(playerSel);
    const team = teams.find((t) => t.id === teamSel.value);
    for (const m of team?.members || []) {
      const roles = (m.roles || []).map((r) => MEMBER_ROLE_LABEL[r] || r).join('/');
      playerSel.append(el('option', {
        value: m.name,
        dataset: { no: m.jerseyNo || '' },
      }, `${m.jerseyNo ? `${m.jerseyNo} 号 ` : ''}${m.name}（${roles}）`));
    }
  };
  teamSel.onchange = fillPlayers;
  fillPlayers();

  const modal = openModal({
    title: '登记停赛',
    body: el('div', {},
      el('p', { class: 'small muted' },
        '登记后状态为「下一轮停赛」。比赛结束后回到这里点「已完成停赛」，累计黄牌会自动清零。'),
      field('球队', teamSel),
      field('球员', playerSel),
      field('停赛类型', reasonSel),
      field('备注', noteInput)),
  });
  const submit = async () => {
    const opt = playerSel.selectedOptions[0];
    if (!playerSel.value) { toast('请选择球员', 'error'); return; }
    try {
      await api(`/events/${event.id}/suspensions`, {
        method: 'POST',
        body: {
          registrationId: teamSel.value,
          player: playerSel.value,
          playerNo: opt?.dataset?.no || '',
          reason: reasonSel.value,
          note: noteInput.value.trim(),
        },
      });
      modal.close();
      toast('已登记停赛（下一轮停赛）', 'success');
      onDone();
    } catch (err) { toast(err.message, 'error'); }
  };
  modal.setFoot([
    btn('取消', { onClick: () => modal.close() }),
    btn('登记', { type: 'primary', onClick: submit }),
  ]);
}

function standingsTable(rows) {
  if (!rows.length) return empty('暂无已完赛比赛', '🏆');
  const table = el('table', {},
    el('thead', {}, el('tr', {},
      ['排名', '球队', '赛', '胜', '平', '负', '进', '失', '净', '积分']
        .map((h) => el('th', { class: h === '积分' ? 'num' : '' }, h)))),
    el('tbody', {}, rows.map((r, i) => el('tr', {},
      el('td', { class: r.rank === 1 ? 'rank-top' : '' }, r.rank),
      el('td', { style: { fontWeight: '500' } }, r.teamName),
      el('td', { class: 'num' }, r.played),
      el('td', { class: 'num' }, r.win),
      el('td', { class: 'num' }, r.draw),
      el('td', { class: 'num' }, r.loss),
      el('td', { class: 'num' }, r.goalsFor),
      el('td', { class: 'num' }, r.goalsAgainst),
      el('td', { class: 'num' }, r.goalDiff > 0 ? `+${r.goalDiff}` : r.goalDiff),
      el('td', { class: 'num', style: { fontWeight: '700', color: '#0b7a43' } }, r.points)))));
  return el('div', { class: 'table-card' }, el('div', { class: 'table-wrap' }, table));
}

function scorersTable(rows) {
  if (!rows.length) return empty('暂无进球记录', '⚽');
  const table = el('table', {},
    el('thead', {}, el('tr', {},
      ['排名', '球员', '球队', '总进球', '其中点球'].map((h) => el('th', { class: h === '总进球' ? 'num' : '' }, h)))),
    el('tbody', {}, rows.map((r) => el('tr', {},
      el('td', { class: r.rank === 1 ? 'rank-top' : '' }, r.rank),
      el('td', { style: { fontWeight: '500' } }, r.player),
      el('td', {}, r.teamName),
      el('td', { class: 'num', style: { fontWeight: '700', color: '#0b7a43' } }, r.goals),
      el('td', { class: 'num' }, r.penalties)))));
  return el('div', { class: 'table-card' }, el('div', { class: 'table-wrap' }, table));
}

function knockoutTable(matches) {
  const table = el('table', {},
    el('thead', {}, el('tr', {},
      ['轮次', '主队', '客队', '比分', '状态', '日期']
        .map((h) => el('th', { class: h === '比分' ? 'num' : '' }, h)))),
    el('tbody', {}, matches.map((m) => el('tr', {},
      el('td', {}, m.knockoutRound || '-'),
      el('td', {}, m.teamA?.name || ''),
      el('td', {}, m.teamB?.name || ''),
      el('td', { class: 'num', style: { fontWeight: '700', color: '#0b7a43' } },
        m.status === 'finished' ? `${m.scoreA}:${m.scoreB}` : '未开赛'),
      el('td', {}, m.status === 'finished' ? '已完赛' : '未开赛'),
      el('td', {}, m.date)))));
  return el('div', { class: 'table-card' }, el('div', { class: 'table-wrap' }, table));
}

// ===================== 人工结果录入 =====================
function openManualResult(event, matches, prefill = null) {
  const openMatches = matches.filter((m) => m.status === 'scheduled');
  const all = [...openMatches, ...matches.filter((m) => m.status === 'finished')];
  const modal = openModal({
    title: prefill ? '比赛结果（AI 已回填，请逐项复核）' : '录入比赛结果',
    body: el('div', {}, el('p', { class: 'small muted' },
      prefill ? '以下字段来自 AI 识别，低置信度项已标红，请修正后提交。'
        : '进球数决定名单行数：每球一行，球员可留空（记为“未登记”）。')),
  });
  clear(modal.body);
  const body = resultFormBody(event, all, prefill);
  modal.body.append(body);
  const submit = async () => {
    try {
      const payload = collectResultForm(body, prefill ? 'ai' : 'manual');
      await api(`/matches/${payload.matchId}/result`, {
        method: 'POST',
        body: payload.data,
      });
      modal.close();
      toast(prefill ? '识别数据已核对并提交，榜单已更新' : '比赛结果已提交，榜单已自动更新', 'success');
      setTimeout(() => location.reload(), 400);
    } catch (err) {
      toast(err.message, 'error', 3800);
    }
  };
  modal.setFoot([
    btn('取消', { onClick: () => modal.close() }),
    btn('提交结果', { type: 'primary', onClick: submit }),
  ]);
}

function resultFormBody(event, all, prefill) {
  const target = (prefill && all.find((m) =>
    ((m.teamA.registrationId === prefill.match.registrationA?.id
      || m.teamB.registrationId === prefill.match.registrationA?.id)
      && (m.teamA.registrationId === prefill.match.registrationB?.id
        || m.teamB.registrationId === prefill.match.registrationB?.id))
      && m.status === 'scheduled'))
    || all.find((m) => m.status === 'scheduled')
    || all[0];
  const sel = el('select', { id: 'rs-match' },
    all.map((m) => el('option', {
      value: m.id, selected: m.id === target?.id,
    }, `${m.date} ${m.teamA.name} vs ${m.teamB.name}（${m.status === 'finished' ? '已完赛-修订' : '未开赛'}）`)));
  const defaultScores = prefill ? [prefill.match.scoreA, prefill.match.scoreB] : [0, 0];
  const baseLineups = prefill?.match?.lineups || {
    A: target?.lineups?.A || null,
    B: target?.lineups?.B || null,
  };
  const refs = prefill?.match?.referees || {
    main: target?.referee || '',
    assistant1: target?.assistant1 || '',
    assistant2: target?.assistant2 || '',
    fourth: target?.fourthOfficial || '',
  };
  const goalsA = el('div', { id: 'goals-A' });
  const goalsB = el('div', { id: 'goals-B' });
  const inputA = numberInput('rs-scoreA', defaultScores[0]);
  const inputB = numberInput('rs-scoreB', defaultScores[1]);
  inputA.addEventListener('input', () => renderGoalRows(goalsA, 'A', clamp(inputA.value), prefill?.match.goals));
  inputB.addEventListener('input', () => renderGoalRows(goalsB, 'B', clamp(inputB.value), prefill?.match.goals));
  const subsBox = el('div', { id: 'subs-box' });
  const cardsBox = el('div', { id: 'cards-box' });
  if (prefill) {
    renderGoalRows(goalsA, 'A', prefill.match.scoreA, prefill.match.goals);
    renderGoalRows(goalsB, 'B', prefill.match.scoreB, prefill.match.goals);
    (prefill.match.substitutions || []).forEach((s) => addSubRow(subsBox, s));
    (prefill.match.cards || []).forEach((c) => addCardRow(cardsBox, c));
  } else {
    renderGoalRows(goalsA, 'A', 0);
    renderGoalRows(goalsB, 'B', 0);
  }
  return el('div', {},
    field('选择比赛', sel),
    el('div', { class: 'score-inputs' },
      el('div', {}, label('主队进球'), inputA),
      el('span', { class: 'vs' }, 'VS'),
      el('div', {}, label('客队进球'), inputB)),
    el('div', { class: 'section-title' }, '比赛服颜色与首发/替补名单（裁判报告自动填入，可修改）'),
    el('div', { class: 'grid cols-2', style: { gap: '8px' } },
      el('label', { class: 'field' },
        el('span', {}, '主队比赛服颜色'),
        el('input', { id: 'rs-colorA', value: baseLineups?.A?.color || prefill?.match?.kitColorA || '', placeholder: '如：红白' })),
      el('label', { class: 'field' },
        el('span', {}, '客队比赛服颜色'),
        el('input', { id: 'rs-colorB', value: baseLineups?.B?.color || prefill?.match?.kitColorB || '', placeholder: '如：蓝黑' }))),
    el('div', { class: 'grid cols-2', style: { gap: '8px' } },
      el('label', { class: 'field' },
        el('span', {}, '主队首发（号码 姓名，每行一人）'),
        el('textarea', { id: 'rs-lineupA-start', rows: 6 }, lineupToText(baseLineups?.A))),
      el('label', { class: 'field' },
        el('span', {}, '主队替补'),
        el('textarea', { id: 'rs-lineupA-bench', rows: 3 }, lineupToText({ starting: baseLineups?.A?.substitutes || [] }))),
      el('label', { class: 'field' },
        el('span', {}, '客队首发'),
        el('textarea', { id: 'rs-lineupB-start', rows: 6 }, lineupToText(baseLineups?.B))),
      el('label', { class: 'field' },
        el('span', {}, '客队替补'),
        el('textarea', { id: 'rs-lineupB-bench', rows: 3 }, lineupToText({ starting: baseLineups?.B?.substitutes || [] })))),
    el('div', { class: 'section-title' }, '主队进球球员'),
    goalsA,
    el('div', { class: 'section-title' }, '客队进球球员'),
    goalsB,
    el('div', { class: 'section-title' }, '裁判组（主裁判 / 一助 / 二助 / 第四官员）'),
    el('div', { class: 'grid cols-2', style: { gap: '8px' } },
      el('label', { class: 'field' },
        el('span', { class: 'required' }, '主裁判'),
        el('input', { id: 'rs-referee-main', value: refs.main || '', placeholder: '主裁判姓名' })),
      el('label', { class: 'field' },
        el('span', {}, '第一助理裁判'),
        el('input', { id: 'rs-referee-a1', value: refs.assistant1 || '', placeholder: '第一助理' })),
      el('label', { class: 'field' },
        el('span', {}, '第二助理裁判'),
        el('input', { id: 'rs-referee-a2', value: refs.assistant2 || '', placeholder: '第二助理' })),
      el('label', { class: 'field' },
        el('span', {}, '第四官员'),
        el('input', { id: 'rs-referee-fourth', value: refs.fourth || '', placeholder: '第四官员' }))),
    el('div', { class: 'row between mt12' },
      el('div', { class: 'section-title', style: { margin: 0 } }, '换人记录（选填）'),
      el('button', { class: 'btn sm outline', type: 'button', onclick: () => addSubRow(subsBox) }, '＋ 添加')),
    subsBox,
    el('div', { class: 'row between mt12' },
      el('div', { class: 'section-title', style: { margin: 0 } }, '红黄牌记录（选填）'),
      el('button', { class: 'btn sm outline', type: 'button', onclick: () => addCardRow(cardsBox) }, '＋ 添加')),
    cardsBox,
  );
}

function collectResultForm(body, source) {
  const matchId = body.querySelector('#rs-match').value;
  const scoreA = clamp(body.querySelector('#rs-scoreA').value);
  const scoreB = clamp(body.querySelector('#rs-scoreB').value);
  const goalsA = [...body.querySelectorAll('.goal-row[data-side="A"]')].map((row) => ({
    no: row.querySelector('.g-no').value.trim(),
    player: row.querySelector('.g-player').value.trim(),
    time: row.querySelector('.g-time').value.trim(),
    penalty: row.querySelector('.g-penalty').checked,
  }));
  const goalsB = [...body.querySelectorAll('.goal-row[data-side="B"]')].map((row) => ({
    no: row.querySelector('.g-no').value.trim(),
    player: row.querySelector('.g-player').value.trim(),
    time: row.querySelector('.g-time').value.trim(),
    penalty: row.querySelector('.g-penalty').checked,
  }));
  const substitutions = [...body.querySelectorAll('.sub-row')].map((row) => ({
    team: row.querySelector('.s-team').value.trim(),
    offNo: row.querySelector('.s-offNo').value.trim(),
    offPlayer: row.querySelector('.s-off').value.trim(),
    onNo: row.querySelector('.s-onNo').value.trim(),
    onPlayer: row.querySelector('.s-on').value.trim(),
    time: row.querySelector('.s-time').value.trim(),
  })).filter((s) => s.offPlayer || s.onPlayer);
  const cards = [...body.querySelectorAll('.card-row')].map((row) => ({
    team: row.querySelector('.c-team').value.trim(),
    player: row.querySelector('.c-player').value.trim(),
    no: row.querySelector('.c-no').value.trim(),
    type: row.querySelector('.c-type').value,
    time: row.querySelector('.c-time').value.trim(),
  })).filter((c) => c.player);
  return {
    matchId,
    data: {
      scoreA, scoreB, goalsA, goalsB,
      substitutions, cards, source,
      refereeRoles: {
        main: body.querySelector('#rs-referee-main').value.trim(),
        assistant1: body.querySelector('#rs-referee-a1').value.trim(),
        assistant2: body.querySelector('#rs-referee-a2').value.trim(),
        fourth: body.querySelector('#rs-referee-fourth').value.trim(),
      },
      lineupA: {
        color: body.querySelector('#rs-colorA').value.trim(),
        starting: linesOfTextarea(body.querySelector('#rs-lineupA-start')),
        substitutes: linesOfTextarea(body.querySelector('#rs-lineupA-bench')),
      },
      lineupB: {
        color: body.querySelector('#rs-colorB').value.trim(),
        starting: linesOfTextarea(body.querySelector('#rs-lineupB-start')),
        substitutes: linesOfTextarea(body.querySelector('#rs-lineupB-bench')),
      },
    },
  };
}

function linesOfTextarea(node) {
  return (node.value || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
}

function lineupToText(lineup) {
  if (!lineup) return '';
  const arr = lineup.starting || [];
  return arr.map((p) => (p.no ? `${p.no} ${p.name}` : p.name)).join('\n');
}

function label(text) {
  return el('div', { class: 'small muted' }, text);
}

function numberInput(id, value) {
  return el('input', {
    id, type: 'number', min: 0, max: 99, value,
    inputmode: 'numeric', style: { textAlign: 'center', fontWeight: '700' },
  });
}

function renderGoalRows(box, side, count, aiGoals = []) {
  clear(box);
  for (let i = 0; i < count; i += 1) {
    const ai = aiGoals.filter((g) => g.side === side)[i];
    const row = el('div', {
      class: 'goal-row result-edit-row', dataset: { side },
      style: { gridTemplateColumns: '58px 1fr 78px 74px' },
    },
      el('input', { class: 'g-no', placeholder: '号', value: ai?.no || '' }),
      el('input', { class: 'g-player', placeholder: `第 ${i + 1} 球球员（可留空）`, value: ai?.player || '' }),
      el('input', { class: 'g-time', placeholder: "时间 23'", value: ai?.time || '' }),
      el('label', { class: 'row', style: { fontSize: '12px', gap: '4px' } },
        el('input', { class: 'g-penalty', type: 'checkbox', checked: ai?.penalty || false, style: { width: 'auto' } }),
        '点球'));
    box.append(row);
  }
}

function clamp(v) {
  const n = Math.max(0, Math.min(99, Number(v) || 0));
  return Number.isInteger(n) ? n : 0;
}

function field(labelText, input) {
  return el('label', { class: 'field' },
    el('span', { class: 'required' }, labelText), input);
}

function addSubRow(box, init = {}) {
  const row = el('div', { class: 'sub-row result-edit-row', style: { gridTemplateColumns: '76px 1fr 52px 1fr 52px 74px auto' } },
    el('input', { class: 's-team', placeholder: '球队', value: init.team || '' }),
    el('input', { class: 's-off', placeholder: '下场球员', value: init.offPlayer || '' }),
    el('input', { class: 's-offNo', placeholder: '号', value: init.offNo || '' }),
    el('input', { class: 's-on', placeholder: '上场球员', value: init.onPlayer || '' }),
    el('input', { class: 's-onNo', placeholder: '号', value: init.onNo || '' }),
    el('input', { class: 's-time', placeholder: "46'", value: init.time || '' }),
    el('button', { class: 'icon-btn', type: 'button', html: '✕', onclick: () => row.remove() }));
  box.append(row);
}

function addCardRow(box, init = {}) {
  const row = el('div', { class: 'card-row result-edit-row', style: { gridTemplateColumns: '1fr 1fr 60px 100px 74px auto' } },
    el('input', { class: 'c-team', placeholder: '球队', value: init.team || '' }),
    el('input', { class: 'c-player', placeholder: '球员', value: init.player || '' }),
    el('input', { class: 'c-no', placeholder: '号', value: init.no || '' }),
    el('select', { class: 'c-type' },
      el('option', { value: 'yellow', selected: init.type !== 'red' }, '黄牌'),
      el('option', { value: 'red', selected: init.type === 'red' }, '红牌')),
    el('input', { class: 'c-time', placeholder: "33'", value: init.time || '' }),
    el('button', { class: 'icon-btn', type: 'button', html: '✕', onclick: () => row.remove() }));
  box.append(row);
}

// ===================== AI 识图 =====================
export function openAiFlow(event, matches, aiStatus, preferMatchId = null) {
  const state = { images: [], preferMatchId };
  const preferMatch = matches.find((m) => m.id === preferMatchId);
  const modal = openModal({
    title: 'AI 比赛数据智能识别',
    body: el('div', {}),
  });
  clear(modal.body);
  const body = aiUploadBody(state, modal);
  modal.body.append(body);
  const startBtn = btn('开始识别', {
    type: 'primary', onClick: () => startRecognize(modal, state, event, matches),
  });
  modal.setFoot([
    btn('取消', { onClick: () => modal.close() }),
    startBtn,
  ]);
}

function aiUploadBody(state, modal) {
  const input = el('input', { type: 'file', accept: 'image/png,image/jpeg', multiple: true, hidden: true });
  const thumbs = el('div', { class: 'thumb-grid' });
  const zone = el('div', { class: 'dropzone' },
    el('div', { style: { fontSize: '17px' } }, '📷 点击上传裁判报告照片'),
    el('div', { class: 'small' }, '可多选，JPG/PNG，最多 6 张'));
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    for (const file of [...input.files]) {
      try {
        const img = await fileToDataUrl(file, 1600);
        const stored = { ...img, dataUrl: img.dataUrl };
        state.images.push(stored);
        const thumb = el('img', { class: 'thumb', src: stored.dataUrl, alt: stored.name });
        thumb.addEventListener('click', () => {
          state.images = state.images.filter((x) => x !== stored);
          thumb.remove();
        });
        thumbs.append(thumb);
      } catch (err) { toast(err.message, 'error'); }
    }
    input.value = '';
  });
  const sampleBtn = btn('载入示例裁判报告（演示用）', {
    type: 'outline', cls: 'sm', onClick: () => {
      const dataUrl = drawSampleScorecard();
      state.images = [{ dataUrl, name: '示例裁判报告.png' }];
      clear(thumbs);
      thumbs.append(el('img', { class: 'thumb', src: dataUrl }));
    },
  });
  return el('div', {},
    el('p', { class: 'small muted' },
      `裁判报告一次包含全部信息：双方首发/替补（号码+姓名）、比赛服颜色、比分、进球、换人、红黄牌、裁判名单。识别结果逐项可改，低置信度标红；确认后填入比赛并落库。`),
    zone,
    input,
    thumbs,
    el('div', { class: 'row mt8' }, sampleBtn),
    el('div', { class: 'small muted mt8' }, '演示环境未配置视觉模型密钥，将返回模拟识别结果；配置后自动调用真实视觉大模型。'));
}

async function startRecognize(modal, state, event, matches) {
  if (!state.images.length) {
    toast('请先上传至少 1 张图片', 'error');
    return;
  }
  const bodyEl = modal.body;
  clear(bodyEl);
  bodyEl.append(el('div', { class: 'progress' },
    el('div', { class: 'spinner' }),
    'AI 正在识别：预处理 → OCR/视觉模型 → 语义解析 → 结构化校验…'));
  try {
    const res = await api('/ai/recognize', {
      method: 'POST',
      body: {
        eventId: event.id,
        images: state.images.map((img) => ({ dataUrl: img.dataUrl, name: img.name })),
        preferMatchId: state.preferMatchId || null,
      },
    });
    renderAiResult(modal, bodyEl, res, event, matches);
  } catch (err) {
    clear(bodyEl);
    bodyEl.append(el('div', { class: 'warning-box' },
      `识别失败：${err.message}`, el('div', { class: 'small' }, '系统未写入任何脏数据，请改用人工录入。')));
    modal.setFoot([
      btn('返回上传', { onClick: () => { modal.close(); openAiFlow(event, matches, null); } }),
      btn('改用人工录入', { type: 'primary', onClick: () => { modal.close(); openManualResult(event, matches); } }),
    ]);
  }
}

function renderAiResult(modal, bodyEl, res, event, matches) {
  clear(bodyEl);
  const m = res.match;
  const conf = res.confidence;
  const low = (key) => (conf[key] != null && conf[key] < 0.75);
  const metaLine = el('div', { class: 'row wrap', style: { marginBottom: '8px' } },
    badge(res.meta.provider === 'demo' ? '模拟识别' : '真实视觉模型', res.meta.provider === 'demo' ? 'warn' : 'approved'),
    badge(`整体置信度 ${Math.round(conf.overall * 100)}%`, conf.overall >= 0.75 ? 'approved' : 'rejected'));
  const warnings = el('div', {});
  (res.warnings || []).forEach((w) => warnings.append(el('div', { class: 'warning-box' }, `⚠ ${w}`)));
  const preview = resultPreviewCard(res, low);
  bodyEl.append(metaLine, warnings, preview);
  modal.setFoot([
    btn('取消', { onClick: () => modal.close() }),
    btn('✍ 填入结果表单并提交', {
      type: 'primary', onClick: () => {
        modal.close();
        openManualResult(event, matches, {
          match: m,
          confidence: conf,
          warnings: res.warnings,
        });
      },
    }),
  ]);
}

function resultPreviewCard(res, low) {
  const m = res.match;
  const score = el('div', { class: 'card', style: { marginBottom: '10px' } },
    el('div', { class: 'score-inputs' },
      el('b', {}, m.registrationA?.name || '主队'),
      el('span', { class: 'vs' }, `${m.scoreA} : ${m.scoreB}`),
      el('b', {}, m.registrationB?.name || '客队')),
    el('div', { class: 'small muted', style: { textAlign: 'center', marginTop: '4px' } },
      `比赛服：${m.kitColorA || '未识别'} vs ${m.kitColorB || '未识别'}`),
    low('score') ? badge('比分置信度低，请复核', 'conf-low') : badge('比分可信', 'conf-high'));
  const lineupBlock = (side, lineup) => el('div', {},
    el('b', { class: 'small' }, `${side}名单`),
    lineup?.starting?.length
      ? el('div', { class: 'small' },
        `首发：${lineup.starting.map((p) => (p.no ? `${p.no}号 ${p.name}` : p.name)).join('、')}`)
      : el('div', { class: 'small muted' }, '未识别'),
    lineup?.substitutes?.length
      ? el('div', { class: 'small' },
        `替补：${lineup.substitutes.map((p) => (p.no ? `${p.no}号 ${p.name}` : p.name)).join('、')}`)
      : null);
  const goalsA = (m.goals || []).filter((g) => g.side === 'A');
  const goalsB = (m.goals || []).filter((g) => g.side === 'B');
  const goalLine = (arr, sideName) => el('div', {},
    el('b', { class: 'small' }, `${sideName}进球（${arr.length}）`),
    arr.length ? el('div', {}, arr.map((g) => el('div', { class: 'small' },
      `⚽ ${g.no ? `${g.no}号 ` : ''}${g.player}${g.time ? ` ${g.time}` : ''}${g.penalty ? '（点球）' : ''}`)))
      : el('div', { class: 'small muted' }, '无'));
  const subs = (m.substitutions || []).length
    ? (m.substitutions || []).map((s) => el('div', { class: 'small' },
      `🔄 ${s.team} ${s.offNo ? `${s.offNo}号 ` : ''}${s.offPlayer} ↓ ${s.onNo ? `${s.onNo}号 ` : ''}${s.onPlayer} ↑${s.time ? ` ${s.time}` : ''}`))
    : el('div', { class: 'small muted' }, '无');
  const cards = (m.cards || []).length
    ? (m.cards || []).map((c) => el('div', { class: 'small' },
      `${c.type === 'red' ? '🟥' : '🟨'} ${c.team} ${c.no ? `${c.no}号 ` : ''}${c.player}${c.time ? ` ${c.time}` : ''}`))
    : el('div', { class: 'small muted' }, '无');
  const block = el('div', { class: 'card mt8' },
    el('b', {}, '识别结果（可在下一步表单中修改）'),
    score,
    el('div', { class: 'kv' },
      el('dt', {}, '名单'), el('dd', {},
        el('div', {}, lineupBlock(m.registrationA?.name, m.lineups?.A)),
        el('div', {}, lineupBlock(m.registrationB?.name, m.lineups?.B))),
      el('dt', {}, '裁判组'), el('dd', {}, refereeRolesText(m.referees)),
      el('dt', {}, '进球'), el('dd', {}, goalLine(goalsA, '主队')),
      el('dt', {}, ''), el('dd', {}, goalLine(goalsB, '客队')),
      el('dt', {}, '换人'), el('dd', {}, subs),
      el('dt', {}, '红黄牌'), el('dd', {}, cards),
    ));
  return block;
}

function refereeRolesText(r) {
  const roles = [
    r?.main ? ['主裁', r.main] : null,
    r?.assistant1 ? ['一助', r.assistant1] : null,
    r?.assistant2 ? ['二助', r.assistant2] : null,
    r?.fourth ? ['第四官员', r.fourth] : null,
  ].filter(Boolean);
  return roles.length ? roles.map(([k, v]) => `${k} ${v}`).join(' / ') : '未识别';
}

function drawSampleScorecard() {
  const canvas = document.createElement('canvas');
  canvas.width = 900; canvas.height = 560;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f7faf8'; ctx.fillRect(0, 0, 900, 560);
  ctx.strokeStyle = '#0b7a43'; ctx.lineWidth = 4; ctx.strokeRect(20, 20, 860, 520);
  ctx.fillStyle = '#0b7a43';
  ctx.font = 'bold 34px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('2026 北理工校园足球联赛 · 小组赛裁判报告', 450, 72);
  ctx.font = '22px sans-serif'; ctx.fillStyle = '#333';
  ctx.fillText('信息与电子学院一队  2 : 1  机械与车辆学院一队', 450, 135);
  const rows = [
    "23'  王强（信息）进球",
    "41'  李昂（信息）进球",
    "67'  李明（机械）点球",
    "46'  张磊 ↓  李昂 ↑",
    "55'  马超 ↓  许飞 ↑",
    "33'  王伟（机械）黄牌",
  ];
  ctx.textAlign = 'left'; ctx.font = '24px sans-serif';
  rows.forEach((row, i) => ctx.fillText(row, 90, 210 + i * 48));
  ctx.fillText('主裁判：赵明      助理裁判：周舟', 90, 520);
  return canvas.toDataURL('image/png');
}
