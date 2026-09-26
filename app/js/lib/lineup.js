// =============================================================
// 比赛名单的纯数据逻辑（不碰 DOM，方便单独测）
//
// 一行球员：{ id, no, name, gk, captain, status, extra }
//   status: 'start'(首发) | 'bench'(替补) | 'none'(未上)
//   extra:  true 表示"不在报名名单里"（AI 识别到或临时添加），单独展示但不丢
//
// 规则（与后端一致）：
//   · 首发名单非空时，必须**有且只有 1 名队长、1 名守门员**
//   · 队长只出现在首发；守门员可以出现在首发或替补（备选门将）
//   · 移到"未上"的人，标记自动清掉（不在名单里就不该带标记）
//   · 队长每队唯一：标了一个，旧的自动取消
// =============================================================

export const STATUS_LABEL = { start: '首发', bench: '替补', none: '－' };

const normNo = (v) => String(v ?? '').trim();
const normName = (v) => String(v ?? '').trim();

// 用「号码+姓名」匹配已保存的名单与报名名单；匹配不上时退化为只按姓名或只按号码
function findRow(rows, no, name) {
  return rows.find((r) => r.no === no && r.name === name)
    || rows.find((r) => r.name && r.name === name)
    || (no ? rows.find((r) => r.no === no) : null);
}

export function buildLineupState({ lineup = null, members = [], aiLineup = null } = {}) {
  const rows = [];
  let seq = 0;
  const addRow = (no, name, extra) => {
    seq += 1;
    const row = {
      id: `p${seq}`, no: normNo(no), name: normName(name),
      gk: false, captain: false, status: 'none', extra: Boolean(extra),
    };
    rows.push(row);
    return row;
  };

  // 报名名单里"能上场"的人（参赛队员 / 队长）先铺进来，全部默认未上
  for (const m of members) {
    const roles = Array.isArray(m.roles) ? m.roles : [];
    const canPlay = roles.length === 0 || roles.includes('player') || roles.includes('captain');
    const name = normName(m.name);
    if (!canPlay || !name) continue;
    addRow(m.jerseyNo, name, false);
  }

  const saved = lineup || {};
  const apply = (list, status) => {
    for (const p of (Array.isArray(list) ? list : [])) {
      const no = normNo(p.no ?? p.number);
      const name = normName(p.name ?? p.player);
      if (!no && !name) continue;
      const row = findRow(rows, no, name) || addRow(no, name, true);
      row.status = status;
      row.gk = Boolean(p.gk ?? p.goalkeeper);
      row.captain = Boolean(p.captain);
    }
  };
  apply(aiLineup?.starting?.length ? aiLineup.starting : saved.starting, 'start');
  apply(aiLineup?.substitutes?.length ? aiLineup.substitutes : saved.substitutes, 'bench');

  return { color: normName(aiLineup?.color || saved.color), rows };
}

export function rowById(state, id) {
  return state.rows.find((r) => r.id === id) || null;
}

export function setStatus(state, id, status) {
  const row = rowById(state, id);
  if (!row) return state;
  row.status = ['start', 'bench', 'none'].includes(status) ? status : 'none';
  if (row.status !== 'start') row.captain = false;   // 队长只能在首发
  if (row.status === 'none') row.gk = false;         // 未上的人不带标记
  return state;
}

export function toggleFlag(state, id, flag) {
  const row = rowById(state, id);
  if (!row) return state;
  if (flag === 'gk') {
    if (row.status !== 'none') row.gk = !row.gk;
  } else if (flag === 'captain') {
    if (row.status !== 'start') return state;
    const next = !row.captain;
    for (const r of state.rows) r.captain = false;   // 每队只留一个队长
    row.captain = next;
  }
  return state;
}

export function addExtraPlayer(state, { no = '', name = '' } = {}) {
  return buildExtraRow(state, no, name);
}

function buildExtraRow(state, no, name) {
  const seq = state.rows.length + 1;
  const row = {
    id: `x${Date.now().toString(36)}${seq}`, no: normNo(no), name: normName(name),
    gk: false, captain: false, status: 'none', extra: true,
  };
  state.rows.push(row);
  return row;
}

export function updateExtraPlayer(state, id, { no, name } = {}) {
  const row = rowById(state, id);
  if (!row || !row.extra) return state;
  if (no !== undefined) row.no = normNo(no);
  if (name !== undefined) row.name = normName(name);
  return state;
}

export function removeRow(state, id) {
  state.rows = state.rows.filter((r) => r.id !== id);
  return state;
}

export function starters(state) {
  return state.rows.filter((r) => r.status === 'start');
}

export function bench(state) {
  return state.rows.filter((r) => r.status === 'bench');
}

// 与后端同一条规则：首发非空时，队长与守门员各恰好一名
export function validateLineup(state, teamLabel = '球队', limit = 11) {
  const errors = [];
  const list = starters(state).filter((r) => r.name || r.no);
  if (list.length) {
    if (list.length > limit) {
      errors.push(`${teamLabel}首发最多 ${limit} 人（当前 ${list.length} 人）`);
    }
    const captains = list.filter((r) => r.captain).length;
    const keepers = list.filter((r) => r.gk).length;
    if (captains !== 1) errors.push(`${teamLabel}首发里必须有且只有 1 名队长（当前 ${captains} 名）`);
    if (keepers !== 1) errors.push(`${teamLabel}首发里必须有且只有 1 名守门员（当前 ${keepers} 名）`);
  }
  return { ok: errors.length === 0, errors };
}

export function toPayload(state) {
  const sortByNo = (arr) => [...arr].sort((a, b) =>
    (parseInt(a.no, 10) || 999) - (parseInt(b.no, 10) || 999)
    || String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));
  const player = (r) => ({
    no: r.no, name: r.name,
    ...(r.gk ? { gk: true } : {}),
    ...(r.captain ? { captain: true } : {}),
  });
  return {
    color: state.color || '',
    starting: sortByNo(starters(state)).filter((r) => r.name || r.no).map(player),
    substitutes: sortByNo(bench(state)).filter((r) => r.name || r.no).map(player),
  };
}
