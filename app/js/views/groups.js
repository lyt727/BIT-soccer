import { api, session } from '../lib/api.js';
import { el, clear, toast, btn, empty, openModal, reloadKeepingScroll } from '../lib/ui.js';

export async function renderGroups(container, event) {
  clear(container);
  const format = event.format || 'group_knockout';
  const canManage = session.user?.role === 'admin';
  const approved = await approvedCount(event);
  try {
    if (format === 'league') {
      await renderLeagueDraw(container, event, canManage, approved);
      return;
    }
    if (format === 'knockout') {
      await renderKnockoutDraw(container, event, canManage, approved);
      return;
    }
    await renderGroupDraw(container, event, canManage, approved);
  } catch (err) {
    container.append(empty(err.message, '⚠️'));
    toast(err.message, 'error');
  }
}

async function approvedCount(event) {
  try {
    const regs = await api(`/events/${event.id}/registrations?status=approved`);
    return regs.length;
  } catch { return 0; }
}

// ---------------- 小组赛：抽签分组 ----------------
async function renderGroupDraw(container, event, canManage, approved) {
  const data = await api(`/events/${event.id}/groups`);
  const groups = data.groups || [];
  container.append(el('div', { class: 'section-title' },
    '抽签分组',
    el('small', {}, groups.length
      ? `${groups.length} 个小组 · 已覆盖全部已通过球队` : '尚未抽签')));
  if (canManage && event.status === 'live' && approved >= 2) {
    container.append(btn(groups.length ? '⟳ 重新抽签' : '开始抽签', {
      type: 'primary', cls: 'block', onClick: () => drawFlow(event, approved, groups),
    }));
  }
  if (!groups.length) {
    container.append(empty(
      event.status !== 'live' ? '报名结束后（赛事状态切到「进行中」）才能抽签分组'
        : (approved >= 2 ? '确认球队都已审核通过后，点击「开始抽签」自动均衡分组'
          : '已通过球队不足 2 支，暂不能抽签'), '🎲'));
    return;
  }
  const grid = el('div', { class: 'group-grid mt12' });
  for (const g of groups) {
    grid.append(el('div', { class: 'group-card' },
      el('h3', {}, `${g.groupName} 组 · ${g.teams.length} 支`),
      el('ol', {}, g.teams.map((t) => el('li', {}, t.teamName)))));
  }
  container.append(grid);
  container.append(el('p', { class: 'small muted mt12' },
    '规则：随机洗牌 + 轮转均衡分配，组间球队数差 ≤ 1。重新抽签将覆盖现有分组结果。'));
}

function drawFlow(event, approved, groups) {
  const modal = openModal({
    title: '抽签参数',
    body: el('div', {},
      el('p', { class: 'small muted' },
        `当前已确认参赛球队 ${approved} 支。${groups.length ? '重新抽签将覆盖现有分组结果。' : ''}`),
      el('label', { class: 'field' },
        el('span', { class: 'required' }, '小组数量'),
        el('select', { id: 'group-count' },
          [2, 3, 4, 6].map((n) => el('option', { value: n, selected: n === 4 }, `${n} 组`)))),
      el('label', { class: 'field' },
        el('span', {}, '每组球队数上限'),
        el('input', {
          id: 'group-max', type: 'number', min: 2, max: 8,
          value: Math.ceil(approved / 4),
        }))),
  });
  const start = btn('确认抽签', {
    type: 'primary', onClick: async () => {
      try {
        const groupCount = Number(modal.body.querySelector('#group-count').value);
        const maxInput = Number(modal.body.querySelector('#group-max').value);
        const maxPerGroup = maxInput || Math.ceil(approved / groupCount);
        const data = await api(`/events/${event.id}/draw`, {
          method: 'POST',
          body: { groupCount, maxPerGroup },
        });
        modal.close();
        toast(data.message, 'success');
        reloadKeepingScroll();
      } catch (err) { toast(err.message, 'error'); }
    },
  });
  modal.setFoot([btn('取消', { onClick: () => modal.close() }), start]);
}

// ---------------- 单循环联赛：抽签编排（生成全部对阵并分轮） ----------------
async function renderLeagueDraw(container, event, canManage, approved) {
  const matches = await api(`/events/${event.id}/matches`);
  const rounds = new Map();
  for (const m of matches) {
    const key = m.roundName || '未分轮次';
    if (!rounds.has(key)) rounds.set(key, []);
    rounds.get(key).push(m);
  }
  container.append(el('div', { class: 'section-title' },
    '抽签编排',
    el('small', {}, matches.length
      ? `单循环 · ${rounds.size} 轮 · 共 ${matches.length} 场`
      : '尚未编排')));
  if (canManage && event.status === 'live' && approved >= 2) {
    container.append(btn(matches.length ? '⟳ 重新编排' : '开始编排（单循环）', {
      type: 'primary', cls: 'block',
      onClick: () => leagueDrawFlow(event, approved, matches.length > 0),
    }));
  }
  if (!matches.length) {
    container.append(empty(
      event.status !== 'live' ? '报名结束后（赛事状态切到「进行中」）才能抽签编排'
        : (approved >= 2
          ? '点击「开始编排」，按单循环自动生成全部对阵并随机分轮'
          : '已通过球队不足 2 支，暂不能编排'), '🎲'));
    return;
  }
  const grid = el('div', { class: 'group-grid mt12' });
  for (const [name, list] of rounds) {
    grid.append(el('div', { class: 'group-card' },
      el('h3', {}, `${name} · ${list.length} 场`),
      el('ol', {}, list.map((m) => el('li', {}, `${m.teamA.name} vs ${m.teamB.name}`)))));
  }
  container.append(grid);
  container.append(el('p', { class: 'small muted mt12' },
    '规则：随机洗牌后按轮转法生成单循环对阵，每两队交手一次。'
    + '对阵与轮次会写入「赛程安排」，日期、时间、场地请在那边补充。'
    + '已录入比赛结果后不能重新编排。'));
}

function leagueDrawFlow(event, approved, hasMatches) {
  const total = (approved * (approved - 1)) / 2;
  const modal = openModal({
    title: '单循环编排',
    body: el('div', {},
      el('p', { class: 'small muted' },
        `当前已确认参赛球队 ${approved} 支，将生成 ${total} 场对阵（每两队交手一次），`
        + `并尽量平均分配到各轮。${hasMatches ? '重新编排会覆盖现有对阵。' : ''}`)),
  });
  const start = btn('确认编排', {
    type: 'primary', onClick: async () => {
      try {
        const data = await api(`/events/${event.id}/draw`, {
          method: 'POST',
          body: { replace: hasMatches },
        });
        modal.close();
        toast(data.message, 'success');
        reloadKeepingScroll();
      } catch (err) { toast(err.message, 'error'); }
    },
  });
  modal.setFoot([btn('取消', { onClick: () => modal.close() }), start]);
}

// ---------------- 纯淘汰赛：抽签决定首轮对手 ----------------
const KO_ROUND_CHOICES = ['1/8决赛', '1/4决赛', '半决赛', '决赛'];

function autoRoundFor(count) {
  if (count >= 16) return '1/8决赛';
  if (count >= 8) return '1/4决赛';
  if (count >= 4) return '半决赛';
  return '决赛';
}

async function renderKnockoutDraw(container, event, canManage, approved) {
  const matches = await api(`/events/${event.id}/matches`);
  const first = matches[0];
  container.append(el('div', { class: 'section-title' },
    '抽签对阵',
    el('small', {}, matches.length
      ? `${first?.knockoutRound || '首轮'} · 共 ${matches.length} 场`
      : '尚未抽签')));
  if (canManage && event.status === 'live' && approved >= 2) {
    container.append(btn(matches.length ? '⟳ 重新抽签' : '开始抽签（生成首轮对阵）', {
      type: 'primary', cls: 'block',
      onClick: () => knockoutDrawFlow(event, approved, matches.length > 0),
    }));
  }
  if (!matches.length) {
    container.append(empty(
      event.status !== 'live' ? '报名结束后（赛事状态切到「进行中」）才能抽签对阵'
        : (approved >= 2 ? '点「开始抽签」，随机配对生成首轮淘汰赛对阵'
          : '已通过球队不足 2 支，暂不能抽签'), '🎲'));
    return;
  }
  const rows = matches.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  container.append(el('div', { class: 'table-card mt12' }, el('div', { class: 'table-wrap' },
    el('table', {},
      el('thead', {}, el('tr', {},
        el('th', {}, '轮次'), el('th', {}, '对阵'), el('th', {}, '日期'))),
      el('tbody', {}, rows.map((m) => el('tr', {},
        el('td', {}, m.knockoutRound || ''),
        el('td', { style: { fontWeight: '500' } }, `${m.teamA.name} vs ${m.teamB.name}`),
        el('td', {}, `${m.date || '待定'} ${m.time || ''}`.trim()))))))));
  container.append(el('p', { class: 'small muted mt12' },
    '规则：随机配对生成首轮对阵；球队数为奇数时最后一支轮空。'
    + '日期、场地、裁判请在「赛程安排」里补充。已录入比赛结果后不能重新抽签。'));
}

function knockoutDrawFlow(event, approved, hasMatches) {
  const roundSel = el('select', { id: 'ko-round' },
    KO_ROUND_CHOICES.map((r) => el('option', {
      value: r, selected: r === autoRoundFor(approved),
    }, r)));
  const modal = openModal({
    title: '淘汰赛抽签',
    body: el('div', {},
      el('p', { class: 'small muted' },
        `当前已确认参赛球队 ${approved} 支，将随机配对生成 ${Math.floor(approved / 2)} 场首轮对阵`
        + `${approved % 2 ? '（1 支轮空）' : ''}。${hasMatches ? '重新抽签会覆盖现有对阵。' : ''}`),
      el('label', { class: 'field' },
        el('span', { class: 'required' }, '首轮轮次'),
        roundSel)),
  });
  const start = btn('确认抽签', {
    type: 'primary', onClick: async () => {
      try {
        const data = await api(`/events/${event.id}/draw`, {
          method: 'POST',
          body: { roundName: roundSel.value, replace: hasMatches },
        });
        modal.close();
        toast(data.message, 'success');
        reloadKeepingScroll();
      } catch (err) { toast(err.message, 'error'); }
    },
  });
  modal.setFoot([btn('取消', { onClick: () => modal.close() }), start]);
}
