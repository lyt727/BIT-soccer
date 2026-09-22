import { api, session, hasPerm } from '../lib/api.js';
import { el, clear, toast, btn, empty, badge, openModal, reloadKeepingScroll } from '../lib/ui.js';

export async function renderStaff(container, event) {
  clear(container);
  const isAdmin = session.user?.role === 'admin';
  try {
    const rows = await api(`/events/${event.id}/staff`);
    container.append(el('div', { class: 'section-title' },
      '赛事工作人员',
      el('small', {}, '管理员自动拥有本赛事全部权限；数据录入员需按赛事指派')));
    if (isAdmin) {
      container.append(btn('＋ 添加数据录入员', {
        type: 'primary', cls: 'block', onClick: () => addOperatorFlow(event),
      }));
    }
    if (!rows.length) { container.append(empty('暂无工作人员', '👥')); return; }
    for (const row of rows) {
      const label = row.event_role === 'admin' ? '管理员' : '数据录入员';
      const cls = row.event_role === 'admin' ? 'admin' : 'data_operator';
      container.append(el('div', { class: 'list-item' },
        el('div', { class: 'main' },
          el('div', { class: 'row wrap' },
            el('b', {}, row.name),
            badge(label, cls)),
          el('div', { class: 'desc' },
            `手机号 ${row.phone}${row.emp_id ? ` · 工号 ${row.emp_id}` : ''}`)),
        isAdmin && row.id !== session.user?.id && row.event_role !== 'admin'
          ? btn('移除', {
            danger: true, cls: 'sm',
            onClick: async () => {
              try {
                await api(`/events/${event.id}/staff/${row.id}`, { method: 'DELETE' });
                toast('已移除', 'success');
                reloadKeepingScroll();
              } catch (err) { toast(err.message, 'error'); }
            },
          })
          : null));
    }
  } catch (err) {
    container.append(empty(err.message, '⚠️'));
  }
}

function addOperatorFlow(event) {
  const modal = openModal({
    title: '添加赛事数据录入员',
    body: el('div', {},
      el('p', { class: 'small muted' },
        '输入已存在的数据录入员手机号。指派后该成员可对本赛事录入比赛结果与使用 AI 识图。'),
      el('label', { class: 'field' },
        el('span', { class: 'required' }, '数据录入员手机号'),
        el('input', { id: 'staff-phone', type: 'tel', maxlength: 11, placeholder: '11 位手机号' })),
    ),
  });
  const submit = async () => {
    try {
      await api(`/events/${event.id}/staff`, {
        method: 'POST',
        body: { phone: modal.body.querySelector('#staff-phone').value.trim(), eventRole: 'data_operator' },
      });
      modal.close();
      toast('数据录入员已添加', 'success');
      reloadKeepingScroll();
    } catch (err) { toast(err.message, 'error'); }
  };
  modal.setFoot([
    btn('取消', { onClick: () => modal.close() }),
    btn('添加', { type: 'primary', onClick: submit }),
  ]);
}
