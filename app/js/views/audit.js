import { api } from '../lib/api.js';
import { el, clear, empty, card } from '../lib/ui.js';

export async function renderAudit(container) {
  clear(container);
  const page = el('div', { class: 'page' });
  container.append(page);
  page.append(el('div', { class: 'section-title' },
    '操作日志',
    el('small', {}, '关键操作（创建/审核/抽签/录分/AI识别）全部留痕')));
  try {
    const logs = await api('/audit?limit=80');
    if (!logs.length) { page.append(empty('暂无日志', '🛡️')); return; }
    for (const log of logs) {
      const actionText = {
        'auth.login': '登录系统',
        'user.create': '创建账号',
        'user.update': '修改账号',
        'event.create': '创建赛事',
        'event.update': '编辑赛事',
        'event.status': '更新赛事状态',
        'event.delete': '删除赛事',
        'event.staff.add': '指派赛事工作人员',
        'event.staff.remove': '移除赛事工作人员',
        'registration.submit': '提交报名',
        'registration.approve': '通过报名',
        'registration.reject': '拒绝报名',
        'groups.draw': '执行抽签',
        'match.create': '新增比赛',
        'match.update': '修改比赛',
        'match.delete': '删除比赛',
        'match.result': '录入比赛结果',
        'ai.recognize': 'AI 识图',
      }[log.action] || log.action;
      page.append(card(
        el('div', { class: 'row between' },
          el('b', {}, actionText),
          el('span', { class: 'small muted' }, new Date(log.created_at).toLocaleString('zh-CN'))),
        el('div', { class: 'desc muted small mt8' },
          el('div', {}, `操作人：${log.phone || '系统'}`),
          el('div', {}, `对象：${log.entity || '-'}${log.entity_id ? ` / ${log.entity_id}` : ''}`),
          log.ip ? el('div', {}, `来源 IP：${log.ip}`) : null,
        )));
    }
  } catch (err) {
    page.append(empty(err.message, '⚠️'));
  }
}
