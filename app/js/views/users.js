import { api, session, hasPerm } from '../lib/api.js';
import { el, clear, toast, badge, empty, btn, openModal, reloadKeepingScroll } from '../lib/ui.js';

const ROLE_BADGE = {
  admin: 'admin',
  data_operator: 'data_operator',
  player: 'player',
};

export async function renderUsers(container) {
  clear(container);
  const page = el('div', { class: 'page' });
  container.append(page);
  page.append(el('div', { class: 'section-title' },
    '成员与角色管理',
    el('small', {}, '管理员拥有全部能力；数据录入员需指派到赛事；球员报名后自动注册')));
  try {
    const users = await api('/admin/users');
    if (hasPerm(session.user, 'user.manage')) {
      page.append(btn('＋ 新建账号', {
        type: 'primary', cls: 'block',
        onClick: () => addUserModal(page, users),
      }));
    }
    const list = el('div', { class: 'mt12' });
    for (const u of users) list.append(userCard(u, page));
    page.append(list);
  } catch (err) {
    page.append(empty(err.message, '⚠️'));
  }
}

function userCard(u, page) {
  const isAdminRole = u.role === 'admin';
  const isSelf = u.id === session.user?.id;
  const canEdit = hasPerm(session.user, 'user.manage') && !isAdminRole;
  const actions = canEdit
    ? el('div', { class: 'row' },
      btn(u.status === 'active' ? '停用' : '启用', {
        cls: 'sm', type: 'outline',
        onClick: async () => {
          try {
            await api(`/admin/users/${u.id}`, {
              method: 'PATCH',
              body: { status: u.status === 'active' ? 'disabled' : 'active' },
            });
            toast('账号状态已更新', 'success');
            reloadKeepingScroll();
          } catch (err) { toast(err.message, 'error'); }
        },
      }),
      btn('改角色', {
        cls: 'sm', type: 'outline', onClick: () => changeRoleModal(u),
      }),
      btn('重置密码', {
        cls: 'sm', type: 'outline', onClick: () => resetPasswordModal(u),
      }))
    : null;
  return el('div', { class: 'list-item' },
    el('div', { class: 'main' },
      el('div', { class: 'row wrap' },
        el('span', { class: 'title' }, `${u.name}${isSelf ? '（我）' : ''}`),
        badge(u.roleLabel || u.role, ROLE_BADGE[u.role]),
        u.status !== 'active' ? badge('已停用', 'rejected') : null),
      el('div', { class: 'desc' },
        `手机号 ${u.phone}${u.emp_id ? ` · 工号 ${u.emp_id}` : ''}`)),
    actions);
}

function addUserModal() {
  const modal = openModal({
    title: '新建账号',
    body: el('div', {},
      field('姓名', 'name'),
      field('手机号（登录凭证）', 'phone'),
      selectField('角色', 'role', [
        ['admin', '管理员'],
        ['data_operator', '数据录入员'],
        ['player', '参赛球员'],
      ]),
      field('初始密码（留空自动生成）', 'password', false),
      field('工号（管理员选填）', 'empId', false),
    ),
  });
  const submit = async () => {
    const q = (id) => modal.body.querySelector(`#${id}`).value.trim();
    const name = q('name');
    const phone = q('phone');
    try {
      const data = await api('/admin/users', {
        method: 'POST',
        body: {
          name,
          phone,
          role: q('role'),
          password: q('password'),
          empId: q('empId'),
        },
      });
      modal.close();
      showCredentialModal(name, phone, data.password);
    } catch (err) { toast(err.message, 'error'); }
  };
  modal.setFoot([btn('取消', { onClick: () => modal.close() }),
    btn('创建账号', { type: 'primary', onClick: submit })]);
}

function showCredentialModal(name, phone, password) {
  const modal = openModal({
    title: '账号创建成功',
    body: el('div', {},
      el('p', { class: 'small muted' },
        '请把下面的登录信息告知本人。密码只显示这一次，请立即记录：'),
      el('div', {
        style: {
          margin: '12px 0', padding: '12px 14px',
          background: '#f4f6f5', borderRadius: '10px', lineHeight: '1.9',
        },
      },
      el('div', {}, `姓名：${name}`),
      el('div', {}, `手机号：${phone}`),
      el('div', { style: { fontWeight: '700' } }, `初始密码：${password}`))),
  });
  modal.setFoot([btn('知道了', {
    type: 'primary',
    onClick: () => { modal.close(); reloadKeepingScroll(); },
  })]);
}

function resetPasswordModal(u) {
  const pwdInput = el('input', {
    id: 'newPwd', type: 'text', placeholder: '留空则自动生成新密码',
  });
  const modal = openModal({
    title: `重置「${u.name}」的密码`,
    body: el('div', {},
      el('p', { class: 'small muted' },
        '重置后旧密码立即失效，请把新密码告知本人。'),
      el('label', { class: 'field' }, el('span', {}, '新密码'), pwdInput)),
  });
  const submit = async () => {
    const pwd = pwdInput.value.trim() || randomPassword();
    try {
      const data = await api(`/admin/users/${u.id}`, {
        method: 'PATCH',
        body: { password: pwd },
      });
      modal.close();
      showCredentialModal(u.name, u.phone, data.password || pwd);
    } catch (err) { toast(err.message, 'error'); }
  };
  modal.setFoot([btn('取消', { onClick: () => modal.close() }),
    btn('确认重置', { type: 'primary', onClick: submit })]);
}

function randomPassword(length = 8) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    for (const b of bytes) out += alphabet[b % alphabet.length];
    return out;
  }
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function changeRoleModal(u) {
  const modal = openModal({
    title: `修改「${u.name}」的角色`,
    body: selectField('角色', 'newRole', [
      ['admin', '管理员'],
      ['data_operator', '数据录入员'],
      ['player', '参赛球员'],
    ], u.role),
  });
  const submit = async () => {
    try {
      await api(`/admin/users/${u.id}`, {
        method: 'PATCH',
        body: { role: modal.body.querySelector('#newRole').value },
      });
      modal.close();
      toast('角色已更新', 'success');
      reloadKeepingScroll();
    } catch (err) { toast(err.message, 'error'); }
  };
  modal.setFoot([btn('取消', { onClick: () => modal.close() }),
    btn('保存', { type: 'primary', onClick: submit })]);
}

function field(label, id, required = true) {
  return el('label', { class: 'field' },
    el('span', { class: required ? 'required' : '' }, label),
    el('input', { id, type: 'text', required }));
}

function selectField(label, id, options, value = '') {
  return el('label', { class: 'field' },
    el('span', { class: 'required' }, label),
    el('select', { id },
      options.map(([v, l]) => el('option', { value: v, selected: v === value }, l))));
}
