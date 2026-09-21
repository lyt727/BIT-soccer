import { api, session, hasPerm } from '../lib/api.js';
import { el, clear, toast, statusBadge, empty, card } from '../lib/ui.js';

export async function renderMine(container) {
  clear(container);
  const page = el('div', { class: 'page' });
  container.append(page);
  page.append(el('div', { class: 'section-title' }, '我的报名'));
  try {
    const mine = await api('/registrations/mine');
    if (!mine.length) {
      page.append(empty(
        hasPerm(session.user, 'registration.submit')
          ? '你还没有提交过球队报名，去「报名中」的赛事详情页发起报名吧'
          : '暂无报名记录',
        '📋'));
      return;
    }
    for (const r of mine) {
      page.append(card(
        el('div', { class: 'row between' },
          el('b', {}, r.teamName),
          statusBadge(r.status)),
        el('div', { class: 'desc muted mt8' },
          el('div', {}, `赛事：${r.eventName}`),
          el('div', {}, `提交时间：${new Date(r.applyTime).toLocaleString('zh-CN')}`)),
        r.rejectReason ? el('div', { class: 'warning-box mt12' }, `拒绝原因：${r.rejectReason}`) : null,
      ));
    }
  } catch (err) {
    page.append(empty(err.message, '⚠️'));
  }
}
