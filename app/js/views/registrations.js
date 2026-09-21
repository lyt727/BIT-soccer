import { api, session, hasPerm, apiBlob, fileToDataUrl } from '../lib/api.js';
import {
  el, clear, toast, btn, empty, confirmBox, statusBadge as uiStatusBadge, badge, openModal,
} from '../lib/ui.js';

function regStatusBadge(status) {
  const map = {
    pending: ['待审核', 'pending'],
    approved: ['已通过', 'approved'],
    rejected: ['已拒绝', 'rejected'],
  };
  const [text, type] = map[status] || [status, ''];
  return uiStatusBadge(text, type);
}

const ROLE_LABELS = {
  head_coach: '主教练', manager: '领队', captain: '队长', player: '参赛队员',
};
const needsJersey = (roles) => roles.includes('player') || roles.includes('captain');

export async function renderRegistrations(container, event) {
  clear(container);
  const isAdmin = session.user?.role === 'admin';
  const isPlayer = session.user?.role === 'player';
  const canSubmit = hasPerm(session.user, 'registration.submit')
    && ['pending', 'signup'].includes(event.status);
  let rows = [];
  let mine = [];
  try {
    rows = await api(`/events/${event.id}/registrations`);
    mine = await api('/registrations/mine');
  } catch (err) {
    container.append(empty(err.message, '⚠️'));
    return;
  }
  const myRow = mine.find((r) => r.eventId === event.id);
  const counts = el('div', { class: 'stat-grid', style: { marginBottom: '12px' } },
    stat('待审核', rows.filter((r) => r.status === 'pending').length),
    stat('已通过', rows.filter((r) => r.status === 'approved').length),
    stat('已拒绝', rows.filter((r) => r.status === 'rejected').length),
  );
  container.append(counts);

  if (isAdmin) {
    if (!rows.length) { container.append(empty('暂无球队报名', '📋')); return; }
    const myTeam = rows.find((r) => r.isMyTeam);
    for (const status of ['pending', 'approved', 'rejected']) {
      const list = rows.filter((r) => r.status === status);
      if (!list.length) continue;
      const title = { pending: '待审核', approved: '已通过（可抽签/排赛）', rejected: '已拒绝' }[status];
      container.append(el('div', { class: 'section-title' }, title, el('small', {}, `${list.length} 支`)));
      for (const reg of list) container.append(adminItem(reg, status === 'pending', event, myTeam));
    }
    if (canSubmit && !rows.some((r) => r.isMyTeam)) {
      container.append(el('button', {
        class: 'btn primary block', type: 'button', style: { marginTop: '12px' },
        onclick: () => openSubmitForm(event, () => location.reload()),
      }, '＋ 我也要报名（整队名单）'));
    }
    return;
  }

  const inSignup = event.status === 'signup';
  container.append(el('div', { class: 'section-title' },
    '已申请报名的球队',
    el('small', {}, '未审核通过的球队也会显示，报名结束后统一审核')));
  if (!rows.length) {
    container.append(empty(canSubmit ? '还没有球队报名，点击下方发起整队报名' : '暂无球队报名', '📋'));
  } else {
    const sorted = [...rows].sort((a, b) => (b.isMyTeam ? 1 : 0) - (a.isMyTeam ? 1 : 0));
    const myTeam = sorted.find((r) => r.isMyTeam);
    for (const reg of sorted) {
      container.append(playerTeamItem(reg, event, mine, canSubmit, myTeam));
    }
  }
  if (!inSignup) {
    container.append(el('div', { class: 'warning-box mt12' },
      '报名已结束，名单锁定。等待管理员统一审核。'));
  }
  if (canSubmit && !rows.some((r) => r.isMyTeam)) {
    container.append(el('button', {
      class: 'btn primary block', type: 'button', style: { marginTop: '10px' },
      onclick: () => openSubmitForm(event, () => location.reload()),
    }, '＋ 提交球队报名（整队名单）'));
  }
}

function playerTeamItem(reg, event, mine, canSubmit, myTeam) {
  const editable = event.status === 'signup';
  const actions = el('div', { class: 'row wrap' });
  if (reg.isMyTeam && editable) {
    if (reg.isContact) {
      const full = (mine || []).find((m) => m.id === reg.id);
      actions.append(btn('✎ 编辑整队名单', {
        cls: 'sm', type: 'outline',
        onClick: () => openSubmitForm(event, () => location.reload(), full || reg),
      }));
    }
    actions.append(btn('🪪 完善我的学生卡', {
      cls: 'sm', type: 'primary',
      onClick: () => selfCardModal(event, reg),
    }));
    actions.append(btn('取消报名', {
      danger: true, cls: 'sm',
      onClick: () => cancelRegistration(reg),
    }));
  } else if (!myTeam && editable) {
    actions.append(btn('加入球队', {
      type: 'primary', cls: 'sm',
      onClick: () => joinTeamModal(event, reg),
    }));
  } else if (myTeam && !reg.isMyTeam) {
    actions.append(badge('已在其他球队报名', 'rejected'));
  }
  const marks = el('div', { class: 'row wrap' },
    regStatusBadge(reg.status),
    badge(`${reg.memberCount || 0} 人已提交`, 'player'),
    reg.isMyTeam ? badge('我的球队', 'approved') : null);
  const coaches = (reg.members || []).filter((m) => (m.roles || []).includes('head_coach'));
  const managers = (reg.members || []).filter((m) => (m.roles || []).includes('manager'));
  const coachText = coaches.map((m) => m.name).join('、') || '未填写';
  const managerText = managers.map((m) => m.name).join('、') || '未填写';
  return el('div', { class: 'card' },
    el('div', { class: 'row between wrap' },
      el('div', {},
        el('b', {}, reg.teamName),
        el('div', { class: 'small muted mt8' },
          `申请时间：${new Date(reg.applyTime).toLocaleString('zh-CN')}`)),
      marks),
    el('div', { class: 'kv mt8' },
      el('dt', {}, '球衣三色'), el('dd', {}, `${reg.jerseyTop || '-'} / ${reg.jerseyShorts || '-'} / ${reg.jerseySocks || '-'}`),
      el('dt', {}, '主教练'), el('dd', {}, coachText),
      el('dt', {}, '领队'), el('dd', {}, managerText)),
    el('button', {
      class: 'btn outline block', type: 'button', style: { marginTop: '10px' },
      onclick: () => teamDetailModal(reg),
    }, '详细名单（号码 / 手机号 / 学生卡）'),
    actions);
}

function teamDetailModal(reg) {
  const members = (reg.members || []).map((m) => {
    const noLabel = m.jerseyNo
      || ((m.roles || []).includes('head_coach') ? '主'
        : (m.roles || []).includes('manager') ? '领' : '—');
    const chips = (m.files || []).map((f) => el('button', {
      class: 'file-chip', type: 'button', title: '点击查看学生卡',
      onclick: () => viewFile(f),
    }, '学生卡'));
    return el('div', { class: 'member-line' },
      el('span', { class: 'member-no' }, noLabel),
      el('div', { style: { flex: 1, minWidth: 0 } },
        el('div', { class: 'row wrap' },
          el('b', {}, m.name),
          (m.roles || []).map((r) => badge(ROLE_LABELS[r] || r, 'pending'))),
        el('div', { class: 'small muted' }, `手机号 ${m.phone}`)),
      el('div', { class: 'row' }, chips.length ? chips : badge('缺材料', 'rejected')));
  });
  openModal({
    title: `详细名单 · ${reg.teamName}`,
    body: el('div', {},
      el('div', { class: 'small muted', style: { marginBottom: '8px' } },
        `球衣三色：${reg.jerseyTop || '-'} / ${reg.jerseyShorts || '-'} / ${reg.jerseySocks || '-'}`),
      ...members),
    foot: [],
  });
}

async function cancelRegistration(reg) {
  const ok = await confirmBox(
    `确定取消你在「${reg.teamName}」的报名吗？你的学生卡照片和报名信息将被移除。`,
    { title: '取消报名', okText: '确认取消', danger: true },
  );
  if (!ok) return;
  try {
    const data = await api(`/registrations/${reg.id}/me`, { method: 'DELETE' });
    toast(data.message, 'success');
    location.reload();
  } catch (err) { toast(err.message, 'error'); }
}

function joinTeamModal(event, reg) {
  const roles = ['player'];
  let dataUrl = null;
  let fileName = '';
  const nameInput = el('input', { type: 'text', value: session.user.name });
  const phoneInput = el('input', { type: 'tel', value: session.user.phone, readOnly: true });
  const roleBox = el('div', { class: 'row wrap' });
  const numberWrap = el('div', { class: 'field' });
  const numberInput = el('input', {
    type: 'number', min: 1, max: 99, inputmode: 'numeric', placeholder: '球衣号码',
  });
  numberWrap.append(el('span', {}, '球衣号码（参赛队员/队长必填）'), numberInput);
  for (const role of ['head_coach', 'manager', 'captain', 'player']) {
    const label = el('label', { class: 'role-check' },
      el('input', { type: 'checkbox', checked: roles.includes(role), value: role }),
      ROLE_LABELS[role]);
    label.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked && !roles.includes(role)) roles.push(role);
      else if (!e.target.checked) roles.splice(roles.indexOf(role), 1);
      numberWrap.style.display = needsJersey(roles) ? 'block' : 'none';
    });
    roleBox.append(label);
  }
  numberWrap.style.display = needsJersey(roles) ? 'block' : 'none';
  const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg', hidden: true });
  const fileZone = el('div', { class: 'dropzone' },
    el('div', {}, '＋ 上传本人学生卡照片'),
    el('div', { class: 'small' }, 'JPG/PNG'));
  fileZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const converted = await fileToDataUrl(file);
      dataUrl = converted.dataUrl;
      fileName = file.name;
      fileZone.innerHTML = '';
      fileZone.append(el('div', {}, `✅ ${file.name}`));
    } catch (err) { toast(err.message, 'error'); }
  });
  const modal = openModal({
    title: `加入球队 · ${reg.teamName}`,
    body: el('div', {},
      el('p', { class: 'small muted' },
        `球衣三色：${reg.jerseyTop || '-'} / ${reg.jerseyShorts || '-'} / ${reg.jerseySocks || '-'}`),
      el('label', { class: 'field' },
        el('span', { class: 'required' }, '姓名'), nameInput),
      el('label', { class: 'field' },
        el('span', {}, '手机号（登录账号）'), phoneInput),
      el('div', { class: 'field' },
        el('span', {}, '队内角色（可多选）'), roleBox),
      numberWrap,
      el('div', { class: 'field' },
        el('span', {}, '学生卡照片（本人）'), fileInput, fileZone),
    ),
  });
  modal.setFoot([
    btn('取消', { onClick: () => modal.close() }),
    btn('加入球队', {
      type: 'primary', onClick: async () => {
        try {
          if (!roles.length) { toast('请至少选择一个队内角色', 'error'); return; }
          if (!dataUrl) { toast('请上传本人学生卡照片', 'error'); return; }
          await api(`/registrations/${reg.id}/join`, {
            method: 'POST',
            body: {
              name: nameInput.value.trim(),
              roles,
              jerseyNo: numberInput.value.trim(),
              file: { originalName: fileName, dataUrl },
            },
          });
          modal.close();
          toast('已加入球队，等待统一审核', 'success');
          location.reload();
        } catch (err) { toast(err.message, 'error'); }
      },
    }),
  ]);
}

function selfCardModal(event, reg) {
  const own = (reg.members || []).find((m) => m.phone === session.user.phone);
  const isPlayer = needsJersey(own?.roles || []);
  const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg', hidden: true });
  const fileZone = el('div', { class: 'dropzone' },
    el('div', {}, '＋ 选择本人学生卡照片'),
    el('div', { class: 'small' }, 'JPG/PNG'));
  let dataUrl = null;
  fileZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const converted = await fileToDataUrl(file);
      dataUrl = converted.dataUrl;
      fileZone.innerHTML = '';
      fileZone.append(el('div', {}, `✅ ${file.name}`));
    } catch (err) { toast(err.message, 'error'); }
  });
  const modal = openModal({
    title: `完善个人信息 · ${reg.teamName}`,
    body: el('div', {},
      el('p', { class: 'small muted' },
        '请上传本人姓名、手机号与学生卡照片；手机号以登录账号为准，仅替换你自己的信息。'),
      el('label', { class: 'field' },
        el('span', { class: 'required' }, '姓名'),
        el('input', { id: 'self-name', value: session.user.name })),
      el('label', { class: 'field' },
        el('span', {}, '手机号'),
        el('input', { id: 'self-phone', value: session.user.phone, readOnly: true })),
      isPlayer
        ? el('label', { class: 'field' },
          el('span', { class: 'required' }, '球衣号码'),
          el('input', { id: 'self-no', type: 'number', min: 1, max: 99, value: own?.jerseyNo || '' }))
        : null,
      fileInput,
      fileZone,
    ),
  });
  modal.setFoot([
    btn('取消', { onClick: () => modal.close() }),
    btn('提交我的学生卡', {
      type: 'primary', onClick: async () => {
        if (!dataUrl) { toast('请先选择学生卡照片', 'error'); return; }
        try {
          await api(`/registrations/${reg.id}/me`, {
            method: 'PATCH',
            body: {
              name: modal.body.querySelector('#self-name').value.trim(),
              jerseyNo: isPlayer ? modal.body.querySelector('#self-no').value.trim() : undefined,
              file: { dataUrl, originalName: `${session.user.name}-学生卡.jpg` },
            },
          });
          modal.close();
          toast('个人信息已更新', 'success');
          location.reload();
        } catch (err) { toast(err.message, 'error'); }
      },
    }),
  ]);
}

function stat(label, value) {
  return el('div', { class: 'stat-box' }, el('b', {}, value), el('span', {}, label));
}

async function viewFile(file) {
  try {
    const blob = await apiBlob(`/files/${file.id}`);
    if (blob.type.startsWith('image/')) {
      const url = URL.createObjectURL(blob);
      const modal = openModal({
        title: file.original_name,
        body: el('img', { src: url, style: { width: '100%', borderRadius: '10px' } }),
        foot: [],
      });
      modal.body.addEventListener('click', () => { URL.revokeObjectURL(url); modal.close(); });
    } else {
      toast('该材料不是图片');
    }
  } catch (err) {
    if (err.status === 404) toast('演示数据未包含实体文件');
    else toast(err.message, 'error');
  }
}

function adminItem(reg, pending, event, myTeam) {
  const members = (reg.members || []).map((m, idx) => {
    const contact = m.isContact ? badge('联系人', 'approved') : null;
    const chips = (m.files || []).map((f) => el('button', {
      class: 'file-chip', type: 'button', title: '点击预览学生卡',
      onclick: () => viewFile(f),
    }, '学生卡'));
    const noLabel = m.jerseyNo
      || ((m.roles || []).includes('head_coach') ? '主'
        : (m.roles || []).includes('manager') ? '领' : '—');
    return el('div', { class: 'member-line' },
      el('span', { class: 'member-no' }, noLabel),
      el('div', { style: { flex: 1, minWidth: 0 } },
        el('div', { class: 'row wrap' }, el('b', {}, m.name), contact,
          (m.roles || []).map((r) => badge(ROLE_LABELS[r] || r, 'pending'))),
        el('div', { class: 'small muted' }, `手机号 ${m.phone}`)),
      el('div', { class: 'row' }, chips.length ? chips : badge('缺材料', 'rejected')));
  });
  const actions = el('div', { class: 'row wrap' });
  if (pending) {
    actions.append(
      btn('通过', {
        type: 'primary', cls: 'sm', onClick: async () => {
          try {
            await api(`/registrations/${reg.id}/review`, {
              method: 'POST', body: { action: 'approve' },
            });
            toast('已通过，球队进入已报名名单', 'success');
            location.reload();
          } catch (err) { toast(err.message, 'error'); }
        },
      }),
      btn('拒绝', {
        danger: true, cls: 'sm', onClick: () => rejectFlow(reg),
      }),
    );
  }
  if (reg.isMyTeam && event.status === 'signup') {
    actions.append(btn('取消报名', {
      danger: true, cls: 'sm', onClick: () => cancelRegistration(reg),
    }));
  } else if (!myTeam && event.status === 'signup') {
    actions.append(btn('加入球队', {
      type: 'primary', cls: 'sm', onClick: () => joinTeamModal(event, reg),
    }));
  } else if (myTeam && !reg.isMyTeam) {
    actions.append(badge('已在其他球队报名', 'rejected'));
  }
  return el('div', { class: 'card' },
    el('div', { class: 'row between wrap' },
      el('div', {},
        el('div', { class: 'row wrap' }, el('b', {}, reg.teamName), regStatusBadge(reg.status),
          badge(`${reg.memberCount || 0} 人`, 'player'),
          reg.isMyTeam ? badge('我的球队', 'approved') : null,
          reg.jerseyTop ? badge(`球衣 ${reg.jerseyTop}/${reg.jerseyShorts}/${reg.jerseySocks}`, 'signup') : null),
        el('div', { class: 'small muted mt8' },
          `提交时间：${new Date(reg.applyTime).toLocaleString('zh-CN')}${reg.rejectReason ? ` · 原因：${reg.rejectReason}` : ''}`)),
      actions),
    el('div', { class: 'section-title', style: { margin: '12px 0 6px' } },
      `球员名单（${members.length} 人）`),
    ...members);
}

function rejectFlow(reg) {
  const modal = openModal({
    title: `拒绝「${reg.teamName}」`,
    body: el('div', {},
      el('p', { class: 'muted small' }, '拒绝后球队将从待审核列表移除，可填写原因供联系人查看。'),
      el('label', { class: 'field' },
        el('span', {}, '拒绝原因'),
        el('textarea', { id: 'reject-reason', placeholder: '如：部分学生卡不清晰，请重新上传' })),
    ),
  });
  modal.setFoot([
    btn('取消', { onClick: () => modal.close() }),
    btn('确认拒绝', {
      danger: true, type: 'primary', onClick: async () => {
        try {
          await api(`/registrations/${reg.id}/review`, {
            method: 'POST',
            body: { action: 'reject', reason: modal.body.querySelector('#reject-reason').value.trim() },
          });
          modal.close();
          toast('已拒绝该球队报名', 'success');
          location.reload();
        } catch (err) { toast(err.message, 'error'); }
      },
    }),
  ]);
}

function myItem(reg, event) {
  const members = (reg.members || []).map((m) =>
    el('div', { class: 'member-line' },
      el('div', { style: { flex: 1 } },
        el('b', {}, m.name), m.isContact ? badge('联系人', 'approved') : null,
        el('div', { class: 'small muted' }, `手机号 ${m.phone}`)),
      el('span', { class: 'small muted' }, m.files?.length ? '✓ 学生卡已上传' : '学生卡未上传')));
  return el('div', { class: 'card' },
    el('div', { class: 'row between' },
      el('b', {}, reg.teamName), regStatusBadge(reg.status)),
    el('div', { class: 'desc muted mt8' },
      `提交时间：${new Date(reg.applyTime).toLocaleString('zh-CN')}`),
    el('div', { class: 'section-title', style: { margin: '12px 0 6px' } }, `球员名单（${members.length} 人）`),
    ...members,
    reg.rejectReason ? el('div', { class: 'warning-box mt12' }, `拒绝原因：${reg.rejectReason}`) : null,
    event.status === 'signup'
      ? el('button', {
        class: 'btn primary block', type: 'button', style: { marginTop: '12px' },
        onclick: () => openSubmitForm(event, () => location.reload(), reg),
      }, '✎ 编辑队员名单')
      : null);
}

// ============ 整队报名表单 ============
function openSubmitForm(event, done, existing = null) {
  const isEdit = Boolean(existing);
  const state = {
    teamName: existing?.teamName || '',
    jerseyTop: existing?.jerseyTop || '',
    jerseyShorts: existing?.jerseyShorts || '',
    jerseySocks: existing?.jerseySocks || '',
    members: [],
  };
  const body = el('div', {});
  body.append(
    el('p', { class: 'small muted' },
      isEdit
        ? `正在编辑「${event.name}」报名名单。修改需重新上传全部成员的学生卡照片；报名截止后名单锁定。`
        : `提交至「${event.name}」。每名球员都要填写手机号并上传本人学生卡照片；报名截止后名单锁定。`),
    el('label', { class: 'field' },
      el('span', { class: 'required' }, '球队名称'),
      el('input', { id: 'roster-team', placeholder: '如：睿信书院联队', value: state.teamName })),
    el('div', { class: 'grid cols-2', style: { gap: '8px' } },
      el('label', { class: 'field' },
        el('span', { class: 'required' }, '球衣上衣颜色'),
        el('input', { id: 'roster-top', placeholder: '如：红白', value: state.jerseyTop })),
      el('label', { class: 'field' },
        el('span', { class: 'required' }, '短裤颜色'),
        el('input', { id: 'roster-shorts', placeholder: '如：黑色', value: state.jerseyShorts })),
      el('label', { class: 'field' },
        el('span', { class: 'required' }, '球袜颜色'),
        el('input', { id: 'roster-socks', placeholder: '如：白色', value: state.jerseySocks }))),
    el('div', { class: 'section-title' }, '球员名单（第一人为报名联系人）'));
  memberEditor(state, body, existing);
  const modal = openModal({ title: isEdit ? '编辑球队报名' : '提交球队报名', body });
  modal.setFoot([
    btn('取消', { onClick: () => modal.close() }),
    btn(isEdit ? '保存修改' : '提交报名', {
      type: 'primary', onClick: async () => {
        try {
          const payload = collectRoster(state, body);
          const data = isEdit
            ? await api(`/registrations/${existing.id}`, { method: 'PATCH', body: payload })
            : await api(`/events/${event.id}/registrations`, { method: 'POST', body: payload });
          modal.close();
          toast(isEdit ? '名单已更新，仍在报名期内可继续修改' : '报名已提交；报名截止后名单将锁定', 'success');
          done();
        } catch (err) { toast(err.message, 'error', 4200); }
      },
    }),
  ]);
}

function memberEditor(state, body, existing = null) {
  const box = el('div', { class: 'roster-box' });
  const addBtn = btn('＋ 添加球员', {
    cls: 'sm', type: 'outline', onClick: () => addMemberRow(state, box),
  });
  const list = existing?.members?.length
    ? existing.members
    : [{
      name: session.user?.name || '', phone: session.user?.phone || '',
      roles: ['manager'], jerseyNo: '', file: null,
    }];
  list.forEach((m, i) => {
    const data = {
      name: m.name || '',
      phone: m.phone || '',
      roles: Array.isArray(m.roles) && m.roles.length ? m.roles : ['player'],
      jerseyNo: m.jerseyNo || '',
      file: null,
    };
    state.members.push(data);
    addMemberRow(state, box, data, i === 0);
  });
  body.append(box, el('div', { class: 'mt8' }, addBtn));
  return box;
}

function addMemberRow(state, box, preset = null, isContact = false) {
  if (!preset) {
    preset = { name: '', phone: '', roles: ['player'], jerseyNo: '', file: null };
    state.members.push(preset);
  }
  const data = preset;
  const nameInput = el('input', { type: 'text', placeholder: '姓名', value: data.name });
  const phoneInput = el('input', {
    type: 'tel', maxlength: 11, inputmode: 'numeric', placeholder: '11 位手机号', value: data.phone,
  });
  const roleBox = el('div', { class: 'row wrap' });
  const roleChecks = {};
  const numberWrap = el('div', { class: 'field' });
  const numberInput = el('input', {
    type: 'number', min: 1, max: 99, inputmode: 'numeric',
    placeholder: '球衣号码', value: data.jerseyNo || '',
  });
  numberWrap.append(el('span', {}, '球衣号码（参赛队员/队长必填）'), numberInput);
  for (const role of ['head_coach', 'manager', 'captain', 'player']) {
    const boxEl = el('label', { class: 'role-check' },
      el('input', { type: 'checkbox', checked: data.roles.includes(role), value: role }),
      ROLE_LABELS[role]);
    boxEl.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) data.roles.push(role);
      else data.roles = data.roles.filter((r) => r !== role);
      numberWrap.style.display = needsJersey(data.roles) ? 'block' : 'none';
    });
    roleBox.append(boxEl);
  }
  numberWrap.style.display = needsJersey(data.roles) ? 'block' : 'none';
  numberInput.addEventListener('input', () => { data.jerseyNo = numberInput.value; });
  const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg', hidden: true });
  const fileLabel = el('span', { class: 'roster-file' }, data.file ? '✅ 已上传' : '＋ 学生卡照片');
  fileLabel.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const converted = await fileToDataUrl(file);
      data.file = converted;
      fileLabel.textContent = '✅ 已上传';
    } catch (err) { toast(err.message, 'error'); }
  });
  const removeBtn = state.members.length > 1
    ? el('button', { class: 'icon-btn', type: 'button', html: '✕', title: '移除' })
    : null;
  if (removeBtn) {
    removeBtn.onclick = () => {
      state.members = state.members.filter((m) => m !== data);
      row.remove();
    };
  }
  const row = el('div', { class: 'member-row' });
  row.append(
    el('div', { class: 'member-head' },
      el('b', {}, isContact ? '报名联系人（本人）' : `球员 ${state.members.length}`),
      removeBtn),
    el('label', { class: 'field' },
      el('span', {}, '姓名'), nameInput),
    el('label', { class: 'field' },
      el('span', {}, '手机号'), phoneInput),
    el('div', { class: 'field' },
      el('span', {}, '队内角色（可多选）'), roleBox),
    numberWrap,
    el('label', { class: 'field' },
      el('span', {}, '学生卡照片（本人）'), fileLabel, fileInput),
  );
  box.append(row);
  return data;
}

function collectRoster(state, body) {
  const teamName = body.querySelector('#roster-team').value.trim();
  const jerseyTop = body.querySelector('#roster-top').value.trim();
  const jerseyShorts = body.querySelector('#roster-shorts').value.trim();
  const jerseySocks = body.querySelector('#roster-socks').value.trim();
  const members = state.members.map((m) => ({
    name: m.name.trim(),
    phone: m.phone.trim(),
    roles: m.roles,
    jerseyNo: m.jerseyNo || '',
    file: m.file ? { originalName: m.file.name, dataUrl: m.file.dataUrl } : null,
  }));
  return { teamName, jerseyTop, jerseyShorts, jerseySocks, members };
}
