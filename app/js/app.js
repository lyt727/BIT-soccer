import { session, api, hasPerm } from './lib/api.js';
import { el, clear, toast, openModal, btn, restoreScrollIfNeeded } from './lib/ui.js';
import { renderHome } from './views/home.js';
import { renderLogin } from './views/login.js';
import { renderEvent } from './views/event-detail.js';
import { renderUsers } from './views/users.js';
import { renderAudit } from './views/audit.js';
import { renderMine } from './views/mine.js';

const view = document.getElementById('view');
const topbar = document.getElementById('topbar');
const bottomNav = document.getElementById('bottom-nav');

const ROUTES = [
  ['home', renderHome],
  ['login', renderLogin],
  ['event', renderEvent],
  ['users', renderUsers],
  ['audit', renderAudit],
  ['mine', renderMine],
];

export function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function parseHash() {
  const raw = (location.hash || '#/home').replace(/^#\/?/, '');
  const parts = raw.split('/').filter((x) => x !== '');
  return {
    name: parts[0] || 'home',
    params: parts.slice(1),
  };
}

export function renderTop({ title = '', showBack = false } = {}) {
  clear(topbar);
  const brand = el('div', { class: 'brand', onclick: () => go('#/home') },
    el('img', { src: '/icon.svg', alt: 'logo' }),
    title ? el('span', { class: 'top-title' }, title)
      : el('span', {}, '绿茵BIT'),
  );
  const right = [];
  if (session.user) {
    right.push(el('button', {
      class: 'user-chip', type: 'button', title: '我的账号',
      onclick: openProfile,
    },
    el('span', { class: 'avatar' }, (session.user.name || '我').slice(0, 1)),
    el('span', {}, session.user.roleLabel || session.user.role)));
  }
  const back = showBack
    ? el('button', { class: 'icon-btn', type: 'button', html: '‹', onclick: () => history.back() })
    : null;
  if (back) topbar.append(back);
  topbar.append(brand, ...right);
}

function renderBottom(activeKey = '') {
  clear(bottomNav);
  if (!session.user) { bottomNav.hidden = true; return; }
  bottomNav.hidden = false;
  const items = [
    ['home', '⚽', '赛事'],
  ];
  if (hasPerm(session.user, 'user.manage') || hasPerm(session.user, 'user.view')) {
    items.push(['users', '👥', '成员']);
  }
  if (hasPerm(session.user, 'user.manage')) items.push(['audit', '🛡️', '日志']);
  for (const [key, icon, label] of items) {
    bottomNav.append(el('button', {
      class: key === activeKey ? 'active' : '',
      type: 'button',
      onclick: () => go(`#/${key}`),
    }, el('b', {}, icon), label));
  }
}

export async function route() {
  session.restore();
  const { name, params } = parseHash();
  if (name !== 'login' && !session.token) {
    location.hash = '#/login';
    return;
  }
  if (session.token) {
    try {
      const data = await api('/auth/me');
      session.updateUser(data.user);
    } catch { /* api 已处理 401 */ }
  }

  clear(view);
  if (name === 'login') {
    renderTop({});
    bottomNav.hidden = true;
    await renderLogin(view);
    return;
  }

  const match = ROUTES.find(([n]) => n === name);
  if (!match) {
    location.hash = '#/home';
    return;
  }
  const render = match[1];
  renderTop({});
  renderBottom(name);
  await render(view, params);
  restoreScrollIfNeeded();
}

function openProfile() {
  const u = session.user;
  const box = openModal({
    title: '我的账号',
    body: el('div', {},
      el('div', { class: 'row', style: { gap: '12px', marginBottom: '10px' } },
        el('span', { class: 'avatar', style: {
          width: '44px', height: '44px', borderRadius: '50%', background: '#0b7a43', color: '#fff',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: '600',
        } }, (u.name || '我').slice(0, 1)),
        el('div', {},
          el('div', { style: { fontWeight: '600' } }, u.name),
          el('span', { class: 'badge', style: { marginTop: '2px' } }, u.roleLabel || u.role),
        )),
      el('dl', { class: 'kv' },
        el('dt', {}, '手机号'), el('dd', {}, u.phone),
        u.empId ? el('dt', {}, '工号') : null,
        u.empId ? el('dd', {}, u.empId) : null,
        u.studentId ? el('dt', {}, '学号') : null,
        u.studentId ? el('dd', {}, u.studentId) : null,
        el('dt', {}, '系统权限'),
        el('dd', {}, u.permissions?.length ? `已开通 ${u.permissions.length} 项能力` : '只读'),
      ),
    ),
  });
  const actions = [];
  if (hasPerm(u, 'user.manage') || hasPerm(u, 'user.view')) {
    actions.push(btn('成员管理', { type: 'outline', onClick: () => { box.close(); go('#/users'); } }));
  }
  if (hasPerm(u, 'user.manage')) {
    actions.push(btn('操作日志', { type: 'outline', onClick: () => { box.close(); go('#/audit'); } }));
  }
  actions.push(btn('退出登录', {
    type: 'primary', danger: true,
    onClick: () => {
      session.clear();
      box.close();
      toast('已退出登录');
      location.hash = '#/login';
    },
  }));
  box.setFoot(actions);
}

window.addEventListener('hashchange', route);
route().catch((err) => {
  toast(err?.message || '页面加载失败', 'error');
  console.error(err);
});
