import { api, session, hasPerm } from '../lib/api.js';
import { el, clear, toast, btn, openModal, statusBadge, statBox, empty } from '../lib/ui.js';
import { renderTop } from '../app.js';
import { renderRegistrations } from './registrations.js';
import { renderGroups } from './groups.js';
import { renderSchedule } from './schedule.js';
import { renderLeaderboards, renderStaffStats } from './stats.js';
import { renderStaff } from './staff.js';

const STATUS_FLOW = ['pending', 'signup', 'live', 'ended'];
const STATUS_TEXT = { pending: '待开始', signup: '报名中', live: '进行中', ended: '已结束' };

export async function renderEvent(container, params) {
  clear(container);
  const eventId = params[0];
  if (!eventId) { location.hash = '#/home'; return; }
  let event;
  try {
    event = await api(`/events/${eventId}`);
  } catch (err) {
    container.append(empty(err.message, '⚠️'));
    return;
  }
  renderTop({ title: event.name, showBack: true });
  const page = el('div', { class: 'page' });
  container.append(page);

  const canChangeStatus = hasPerm(session.user, 'event.status.update')
    && (session.user.role === 'admin' || event.staffRole === 'admin');
  const statusWrap = el('div', {});
  const statusBtn = el('button', {
    class: `badge ${event.status} status-pill${canChangeStatus ? ' clickable' : ''}`,
    type: 'button',
    disabled: !canChangeStatus,
  }, STATUS_TEXT[event.status] || event.status);
  if (canChangeStatus) {
    statusBtn.append(el('span', { class: 'status-caret' }, '▾'));
    statusBtn.addEventListener('click', () => openStatusSwitch(event));
  }
  statusWrap.append(statusBtn);
  if (canChangeStatus) {
    statusWrap.append(btn('✎ 编辑赛事', {
      cls: 'sm', type: 'outline', style: { marginLeft: '6px' },
      onClick: () => openEventEdit(event),
    }));
  }
  const header = el('div', { class: 'card' },
    el('div', { class: 'row between wrap' },
      el('div', { style: { flex: '1', minWidth: '0' } },
        el('div', { style: { fontWeight: '700', fontSize: '18px' } }, event.name),
        el('div', { class: 'muted small mt8' },
          `赛季 ${event.season}${event.description ? ` · ${event.description}` : ''}`)),
      statusWrap),
    el('div', { class: 'stat-grid mt12' },
      statBox('已报名球队', event.approvedTeams || 0),
      statBox('待审核', event.pendingRegistrations || 0),
      statBox('比赛场次', `${event.finishedMatches || 0}/${event.totalMatches || 0}`),
      statBox('小组数', event.groupCount || 0)),
    el('div', { class: 'row mt12 wrap' },
      el('span', { class: 'small muted' }, '你的赛事身份：'),
      el('span', { class: 'badge' },
        event.staffRole ? {
          admin: '管理员',
          data_operator: '数据录入员',
        }[event.staffRole] || '工作人员'
          : session.user?.role === 'player' ? '参赛球员' : '只读用户')));
  page.append(header);

  // 赛制决定标签栏：league 单循环联赛 / group_knockout 小组赛+淘汰赛 / knockout 纯淘汰赛
  const format = event.format || 'group_knockout';
  const tabsDef = [['registrations', '球队报名']];
  if (format === 'league') tabsDef.push(['groups', '抽签编排']);
  else if (format === 'group_knockout') tabsDef.push(['groups', '抽签分组']);
  tabsDef.push(
    ['schedule', '赛程安排'],
    ['stats', '数据统计'],
    ['staffstats', '工作统计'],
  );
  if ((session.user?.role === 'admin' || event.staffRole)) {
    tabsDef.push(['staff', '工作人员']);
  }
  const tabKey = tabsDef.some(([k]) => k === params[1]) ? params[1] : tabsDef[0][0];
  const tabs = el('nav', { class: 'tabs' });
  for (const [key, label] of tabsDef) {
    tabs.append(el('button', {
      class: `tab ${key === tabKey ? 'active' : ''}`,
      type: 'button',
      onclick: () => { location.hash = `#/event/${event.id}/${key}`; },
    }, label));
  }
  page.append(tabs);
  const content = el('div', {});
  page.append(content);

  if (tabKey === 'registrations') await renderRegistrations(content, event);
  else if (tabKey === 'groups') await renderGroups(content, event);
  else if (tabKey === 'schedule') await renderSchedule(content, event);
  else if (tabKey === 'stats') {
    await renderLeaderboards(content, event);
  }
  else if (tabKey === 'staffstats') await renderStaffStats(content, event);
  else if (tabKey === 'staff') await renderStaff(content, event);
}

function openEventEdit(event) {
  const modal = openModal({
    title: '编辑赛事',
    body: el('div', {},
      el('label', { class: 'field' },
        el('span', { class: 'required' }, '赛事名称'),
        el('input', { id: 'evt-name', value: event.name })),
      el('label', { class: 'field' },
        el('span', {}, '赛事介绍'),
        el('textarea', { id: 'evt-desc', rows: 3 }, event.description || '')),
      el('label', { class: 'field' },
        el('span', {}, '赛制（已有赛程时不可修改）'),
        el('select', { id: 'evt-format' },
          el('option', {
            value: 'group_knockout',
            selected: (event.format || 'group_knockout') === 'group_knockout',
          }, '小组赛 + 淘汰赛'),
          el('option', { value: 'league', selected: event.format === 'league' }, '单循环联赛'),
          el('option', { value: 'knockout', selected: event.format === 'knockout' }, '纯淘汰赛'))),
    ),
  });
  const submit = async () => {
    try {
      await api(`/events/${event.id}`, {
        method: 'PATCH',
        body: {
          name: modal.body.querySelector('#evt-name').value.trim(),
          description: modal.body.querySelector('#evt-desc').value.trim(),
          format: modal.body.querySelector('#evt-format').value,
        },
      });
      modal.close();
      toast('赛事信息已更新', 'success');
      location.reload();
    } catch (err) { toast(err.message, 'error'); }
  };
  modal.setFoot([
    btn('取消', { onClick: () => modal.close() }),
    btn('保存', { type: 'primary', onClick: submit }),
  ]);
}

function openStatusSwitch(event) {
  const modal = openModal({
    title: '切换赛事状态',
    body: el('div', { class: 'grid cols-2' },
      STATUS_FLOW.map((s) => el('button', {
        class: `status-option ${s === event.status ? 'current' : ''}`,
        type: 'button',
        onclick: async () => {
          try {
            const data = await api(`/events/${event.id}/status`, {
              method: 'PATCH',
              body: { status: s },
            });
            modal.close();
            toast(`赛事状态已更新为「${data.statusText}」`, 'success');
            setTimeout(() => location.reload(), 300);
          } catch (err) { toast(err.message, 'error'); }
        },
      }, STATUS_TEXT[s]))),
  });
  modal.setFoot([btn('取消', { onClick: () => modal.close() })]);
}
