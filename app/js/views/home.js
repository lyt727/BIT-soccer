import { api, session, hasPerm } from '../lib/api.js';
import { el, clear, toast, btn, openModal, confirmBox, statusBadge, empty, reloadKeepingScroll } from '../lib/ui.js';

const STATUS_TEXT = { pending: '待开始', signup: '报名中', live: '进行中', ended: '已结束' };

export async function renderHome(container) {
  clear(container);
  const page = el('div', { class: 'page' });
  container.append(page);
  try {
    const events = await api('/events');
    const live = events.find((e) => e.status === 'live');
    if (live) page.append(banner(live));
    page.append(listSection(events));
    if (hasPerm(session.user, 'event.create')) {
      page.append(el('button', {
        class: 'btn primary block', type: 'button', style: { marginTop: '14px' },
        onclick: () => addEventModal(page, events),
      }, '＋ 添加赛事'));
    }
  } catch (err) {
    page.append(empty(err.message, '⚠️'));
    toast(err.message, 'error');
  }
}

function banner(evt) {
  return el('div', { class: 'event-banner', style: { marginBottom: '16px' } },
    el('div', { class: 'row between' },
      el('span', { class: 'badge', style: { background: 'rgba(255,255,255,.22)', color: '#fff' } },
        `${evt.season} · 进行中`),
    ),
    el('div', { class: 'title' }, evt.name),
    el('div', { class: 'banner-stats' },
      statBox2('参赛球队', evt.approvedTeams || 0),
      statBox2('已完成/总场次', `${evt.finishedMatches || 0}/${evt.totalMatches || 0}`),
      statBox2('小组', `${evt.groupCount || 0} 个`),
    ),
    el('button', {
      class: 'btn', type: 'button', style: {
        alignSelf: 'flex-start', background: '#fff', color: '#075e32', marginTop: '4px',
      },
      onclick: () => { location.hash = `#/event/${evt.id}/schedule`; },
    }, '进入赛事详情 →'));
}

function statBox2(label, value) {
  return el('div', {}, el('b', {}, value), el('span', {}, label));
}

function listSection(events) {
  const sec = el('div', {});
  sec.append(el('div', { class: 'section-title' },
    '全部赛事', el('small', {}, `共 ${events.length} 届`)));
  if (!events.length) {
    sec.append(empty('暂无赛事，点击「添加赛事」创建', '🌱'));
    return sec;
  }
  for (const evt of events) sec.append(eventCard(evt));
  return sec;
}

function eventCard(evt) {
  const body = el('div', { class: 'event-card' },
    el('div', { class: 'head' },
      el('div', { class: 'name', onclick: () => open(evt) }, evt.name),
      statusBadge(evt.status)),
    el('div', { class: 'sub' },
      el('span', {}, `赛季 ${evt.season}`),
      el('span', {}, `${evt.approvedTeams || 0} 支球队`),
      el('span', {}, `${evt.finishedMatches || 0}/${evt.totalMatches || 0} 场已完赛`),
      el('span', {}, evt.staffRole ? '可管理' : '只读')),
    el('div', { class: 'row between mt8' },
      el('button', { class: 'btn sm outline', type: 'button', onclick: () => open(evt) },
        evt.status === 'live' ? '查看赛程与数据' : '查看详情'),
      hasPerm(session.user, 'event.delete') ? el('button', {
        class: 'delete-corner', type: 'button', title: '删除赛事', html: '🗑',
        onclick: (e) => { e.stopPropagation(); removeEvent(evt); },
      }) : null),
  );
  function open(e) {
    const tab = session.user?.role === 'admin' ? 'registrations' : 'schedule';
    location.hash = `#/event/${e.id}/${tab}`;
  }
  return body;
}

async function removeEvent(evt) {
  const ok = await confirmBox(
    `确定要删除赛事「${evt.name}」吗？将同时删除其全部报名、分组、赛程与统计结果，且不可恢复。`,
    { title: '删除赛事', okText: '确认删除', danger: true },
  );
  if (!ok) return;
  try {
    await api(`/events/${evt.id}`, { method: 'DELETE' });
    toast('赛事已删除', 'success');
    location.hash = '#/home';
    reloadKeepingScroll();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function addEventModal(page, events) {
  const modal = openModal({
    title: '添加赛事',
    body: el('div', {},
      field('赛事名称', { id: 'evt-name', required: true, placeholder: '如：2026年北理工校园足球联赛' }),
      field('赛季年份', { id: 'evt-season', required: true, inputmode: 'numeric', maxlength: 4, placeholder: '如：2026' }),
      el('label', { class: 'field' },
        el('span', { class: 'required' }, '赛制'),
        el('select', { id: 'evt-format' },
          el('option', { value: 'group_knockout', selected: true }, '小组赛 + 淘汰赛'),
          el('option', { value: 'league' }, '单循环联赛'),
          el('option', { value: 'knockout' }, '纯淘汰赛'))),
      field('赛事描述（选填）', { id: 'evt-desc', tag: 'textarea', placeholder: '赛制、参赛范围等说明' }),
    ),
  });
  const submit = async () => {
    const name = modal.body.querySelector('#evt-name').value.trim();
    const season = modal.body.querySelector('#evt-season').value.trim();
    const description = modal.body.querySelector('#evt-desc').value.trim();
    const format = modal.body.querySelector('#evt-format').value;
    try {
      const created = await api('/events', {
        method: 'POST',
        body: { name, season, description, format },
      });
      modal.close();
      toast('赛事创建成功', 'success');
      location.hash = `#/event/${created.id}/registrations`;
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  modal.setFoot([
    btnCancel(modal),
    btn('创建赛事', { type: 'primary', onClick: submit }),
  ]);
}

function field(label, opts) {
  const tag = opts.tag || 'input';
  const input = el(tag, { ...opts, required: opts.required ?? true });
  return el('label', { class: 'field' },
    el('span', { class: opts.required ? 'required' : '' }, label),
    input);
}

function btnCancel(modal) {
  return el('button', { class: 'btn outline', type: 'button', onclick: () => modal.close() }, '取消');
}

export { field, btnCancel };
