import { api, session, hasPerm } from '../lib/api.js';
import { el, clear, toast, badge, empty, btn, openModal } from '../lib/ui.js';

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
            location.reload();
          } catch (err) { toast(err.message, 'error'); }
        },
      }),
      btn('改角色', {
        cls: 'sm', type: 'outline', onClick: () => changeRoleModal(u),
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
      field('工号（管理员选填）', 'empId', false),
    ),
  });
  const submit = async () => {
    const q = (id) => modal.body.querySelector(`#${id}`).value.trim();
    try {
      await api('/admin/users', {
        method: 'POST',
        body: { name: q('name'), phone: q('phone'), role: q('role'), empId: q('empId') },
      });
      modal.close();
      toast('账号已创建', 'success');
      location.reload();
    } catch (err) { toast(err.message, 'error'); }
  };
  modal.setFoot([btn('取消', { onClick: () => modal.close() }),
    btn('创建账号', { type: 'primary', onClick: submit })]);
}

function changeRoleModal(u) {
  const modal = openModal({
    title: `修改「${u.name}」的角色`,
    body: selectField('角色', 'newRole', [
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
      location.reload();
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
