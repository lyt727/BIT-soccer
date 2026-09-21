import { api, session } from '../lib/api.js';
import { el, clear, toast, btn, empty, confirmBox, openModal } from '../lib/ui.js';

export async function renderGroups(container, event) {
  clear(container);
  const canDraw = session.user?.role === 'admin';
  try {
    const data = await api(`/events/${event.id}/groups`);
    const groups = data.groups || [];
    const approved = await fetchApproved();
    container.append(el('div', { class: 'section-title' },
      '抽签分组',
      el('small', {}, groups.length ? `${groups.length} 个小组 · 已覆盖全部已通过球队` : '尚未抽签')));
    if (canDraw && ['signup', 'live'].includes(event.status) && approved >= 2) {
      container.append(btn(groups.length ? '⟳ 重新抽签' : '开始抽签', {
        type: 'primary', cls: 'block', onClick: () => drawFlow(event, approved, groups),
      }));
    }
    if (!groups.length) {
      container.append(empty(
        approved >= 2 ? '确认球队都已审核通过后，点击「开始抽签」自动均衡分组' : '已通过球队不足 2 支，暂不能抽签',
        '🎲'));
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
  } catch (err) {
    container.append(empty(err.message, '⚠️'));
    toast(err.message, 'error');
  }

  async function fetchApproved() {
    try {
      const regs = await api(`/events/${event.id}/registrations?status=approved`);
      return regs.length;
    } catch { return 0; }
  }
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
        })),
    ),
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
        location.reload();
      } catch (err) { toast(err.message, 'error'); }
    },
  });
  modal.setFoot([btn('取消', { onClick: () => modal.close() }), start]);
}
