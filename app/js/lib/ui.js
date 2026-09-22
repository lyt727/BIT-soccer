export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      // 事件名大小写不敏感：onclick / onClick 都按 'click' 挂载
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (key in node) {
      try { node[key] = value; } catch { node.setAttribute(key, value); }
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// ---- 滚动位置保持 ----
// 编辑保存后常需要整体重渲染；直接 reload / 清空重画会把页面滚回顶部，
// 这里在刷新前记住位置，路由渲染完成后恢复，避免长列表里"跳回顶部"。
const SCROLL_KEY = 'gb_restore_scroll';

export function reloadKeepingScroll() {
  try {
    sessionStorage.setItem(SCROLL_KEY, String(Math.round(window.scrollY || 0)));
  } catch { /* 隐私模式下忽略 */ }
  location.reload();
}

export function restoreScrollIfNeeded() {
  let y = 0;
  try {
    y = Number(sessionStorage.getItem(SCROLL_KEY) || 0);
    if (y) sessionStorage.removeItem(SCROLL_KEY);
  } catch { y = 0; }
  if (y > 0) {
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
  }
}

// 同一页面内重建内容时用：记住位置 → 重建 → 恢复
export async function rebuildKeepingScroll(rebuild) {
  const y = window.scrollY || 0;
  await rebuild();
  requestAnimationFrame(() => window.scrollTo(0, y));
}

export function toast(message, type = 'info', ms = 2400) {
  const root = document.getElementById('toast-root');
  const t = el('div', { class: `toast ${type}`, role: 'status' }, message);
  root.append(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transition = 'opacity .3s';
    setTimeout(() => t.remove(), 320);
  }, ms);
}

export function openModal({ title, body, foot, full = false, dismissible = true }) {
  const root = document.getElementById('modal-root');
  const overlay = el('div', { class: 'overlay' });
  const modal = el('div', { class: `modal ${full ? 'full' : ''}` });
  const header = el('div', { class: 'modal-header' },
    el('div', {}, title || ''),
    el('button', {
      class: 'icon-btn', type: 'button', 'aria-label': '关闭', html: '&times;',
      onclick: () => close(),
    }),
  );
  const bodyEl = el('div', { class: 'modal-body' }, body);
  const footEl = el('div', { class: 'modal-foot' });
  modal.append(header, bodyEl, footEl);
  overlay.append(modal);
  if (dismissible) overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  root.append(overlay);

  function close() { overlay.remove(); }
  function setFoot(nodes) {
    clear(footEl);
    if (Array.isArray(nodes) && nodes.length) footEl.append(...nodes);
    else if (nodes) footEl.append(nodes);
    else footEl.remove();
  }
  if (foot) setFoot(foot);
  return { close, body: bodyEl, setFoot };
}

export function btn(text, { type = 'outline', danger = false, onClick, disabled = false, cls = '' } = {}) {
  return el('button', {
    class: `btn ${type} ${danger ? 'danger' : ''} ${cls}`.trim(),
    type: 'button',
    disabled,
    onclick: onClick,
  }, text);
}

export function confirmBox(message, { title = '确认操作', okText = '确认', danger = false } = {}) {
  return new Promise((resolve) => {
    const box = openModal({
      title,
      body: el('div', { style: { fontSize: '15px', lineHeight: '1.7' } }, message),
      foot: [
        btn('取消', { onClick: () => { box.close(); resolve(false); } }),
        btn(okText, { type: 'primary', danger, onClick: () => { box.close(); resolve(true); } }),
      ],
    });
  });
}

export function badge(text, type = '') {
  return el('span', { class: `badge ${type || ''}`.trim() }, text);
}

export function empty(text, icon = '📭') {
  return el('div', { class: 'empty' }, el('span', { class: 'big' }, icon), text);
}

export function statusBadge(status) {
  const map = {
    pending: ['待开始', 'pending'], signup: ['报名中', 'signup'],
    live: ['进行中', 'live'], ended: ['已结束', 'ended'],
    approved: ['已通过', 'approved'], rejected: ['已拒绝', 'rejected'],
    scheduled: ['未开赛', 'scheduled'], finished: ['已完赛', 'finished'],
    active: ['正常', 'approved'], disabled: ['已停用', 'rejected'],
  };
  const [text, type] = map[status] || [status, ''];
  return badge(text, type);
}

export function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtDate(date) {
  if (!date) return '';
  return String(date);
}

export function showLoading(container, text = '加载中…') {
  return clear(container).append(
    el('div', { class: 'empty' }, el('span', { class: 'spinner' }), text),
  );
}

export function statBox(label, value, key = '') {
  return el('div', { class: 'stat-box' },
    el('b', { dataset: { key } }, value),
    el('span', {}, label),
  );
}

export function card(...children) {
  return el('div', { class: 'card' }, ...children);
}

export function link(hash, ...children) {
  return el('a', { href: hash, class: 'plain-link' }, ...children);
}
