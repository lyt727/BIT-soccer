// =============================================================
// 权限模型（V2：管理员 / 数据录入员 / 参赛球员）
//   管理员：原“超级管理员 + 赛事管理员”合并，拥有全部能力；
//   数据录入员：仅录分与 AI 识图；
//   参赛球员：提交球队报名、查看赛程与榜单。
// 赛事级写操作仍需 event_staff 指派，防止越权管理其他赛事。
// =============================================================

export const ROLES = {
  admin: '管理员',
  data_operator: '数据录入员',
  player: '参赛球员',
};

// 权限包含关系：参赛队员 ⊆ 数据录入员 ⊆ 管理员
// 数据录入员 = 参赛队员全部能力 + 录分/AI 识图；
// 管理员 = 数据录入员全部能力 + 全部管理能力。
const PLAYER_PERMISSIONS = ['registration.submit', 'stats.view', 'match.view'];
const DATA_OPERATOR_PERMISSIONS = [
  ...PLAYER_PERMISSIONS,
  'result.record',
  'ai.recognize',
];
const ADMIN_PERMISSIONS = [
  ...DATA_OPERATOR_PERMISSIONS,
  'user.manage', 'user.view',
  'event.create', 'event.delete', 'event.status.update', 'staff.manage',
  'registration.review', 'registration.view_materials',
  'draw.groups', 'match.manage',
  'suspension.manage',
];

const PERMISSIONS = {};
for (const action of PLAYER_PERMISSIONS) PERMISSIONS[action] = ['player', 'data_operator', 'admin'];
for (const action of ['result.record', 'ai.recognize']) {
  PERMISSIONS[action] = ['data_operator', 'admin'];
}
for (const action of ADMIN_PERMISSIONS) {
  if (!PERMISSIONS[action]) PERMISSIONS[action] = ['admin'];
}

export function roleLabel(role) {
  return ROLES[role] || role;
}

export function can(user, action) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.status !== 'active') return false;
  const allowed = PERMISSIONS[action] || [];
  return allowed.includes(user.role);
}

export function requireAction(user, action) {
  if (!can(user, action)) {
    const err = new Error('没有权限执行该操作');
    err.status = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }
}

const EVENT_SCOPED_ACTIONS = new Set([
  'registration.review',
  'draw.groups',
  'match.manage',
  'result.record',
  'ai.recognize',
]);

export async function assertEventScope(db, user, action, eventId) {
  if (!user) {
    const err = new Error('请先登录');
    err.status = 401;
    throw err;
  }
  if (user.role === 'admin') return;
  if (!EVENT_SCOPED_ACTIONS.has(action)) return;
  const row = await db.get(
    'SELECT 1 FROM event_staff WHERE event_id = ? AND user_id = ? LIMIT 1',
    [eventId, user.id],
  );
  if (!row) {
    const err = new Error('您未被指派管理该赛事，无法执行此操作');
    err.status = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }
}
