import fs from 'node:fs';
import path from 'node:path';
import { authUser, audit, clientIp, loadEvent } from '../helpers.js';
import { getDb } from '../db.js';
import { requireAction, assertEventScope } from '../rbac.js';
import { uid, config, nowIso } from '../config.js';
import { readJson, sendJson } from '../http.js';
import { badRequest, notFound, forbidden } from '../errors.js';
import { checkPhone } from '../services/verifyCode.js';

const FILE_KIND = 'campus_card';

function decodeDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  return { mime: m[1].toLowerCase(), buffer: Buffer.from(m[2], 'base64') };
}

function extForMime(mime) {
  if (mime.includes('png')) return '.png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
  return '.bin';
}

function checkImageMagic(buf, mime) {
  if (mime.includes('png')) return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50;
  if (mime.includes('jpeg')) return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
  return false;
}

const ROLE_KEYS = ['head_coach', 'manager', 'captain', 'player'];
const ROLE_TEXT = {
  head_coach: '主教练', manager: '领队', captain: '队长', player: '参赛队员',
};

function normalizeRoles(v) {
  let list = [];
  if (Array.isArray(v)) list = v;
  else if (typeof v === 'string') list = v.split(/[,，、]/);
  const roles = [...new Set(list.map((s) => String(s).trim()).filter((s) => ROLE_KEYS.includes(s)))];
  if (!roles.length) {
    const err = new Error('每位成员至少选择一个角色');
    err.status = 400;
    throw err;
  }
  return roles;
}

function normalizeJerseyNo(v, roles, name) {
  const no = String(v ?? '').trim();
  if (roles.includes('player') || roles.includes('captain')) {
    if (!/^\d{1,2}$/.test(no)) {
      const err = new Error(`参赛队员「${name}」必须提交 1-2 位球衣号码`);
      err.status = 400;
      throw err;
    }
    return no;
  }
  return no || '';
}

function assertUniqueRoles(members) {
  const count = (key) => members.filter((m) => (m.roles || []).includes(key)).length;
  if (count('head_coach') > 1) {
    const err = new Error('每支球队只能有一名主教练');
    err.status = 400;
    throw err;
  }
  if (count('captain') > 1) {
    const err = new Error('每支球队只能有一名队长');
    err.status = 400;
    throw err;
  }
}

async function assertTeamUniqueRolesWithMember(db, regId, roles) {
  const rows = await db.all(
    'SELECT roles FROM registration_members WHERE registration_id = ?',
    [regId],
  );
  const existing = rows.map((r) => {
    try { return JSON.parse(r.roles || '[]'); } catch { return []; }
  });
  const count = (key) => existing.filter((list) => list.includes(key)).length
    + (roles.includes(key) ? 1 : 0);
  if (count('head_coach') > 1) {
    const err = new Error('每支球队只能有一名主教练');
    err.status = 400;
    throw err;
  }
  if (count('captain') > 1) {
    const err = new Error('每支球队只能有一名队长');
    err.status = 400;
    throw err;
  }
}

async function membersOf(db, regId) {
  const rows = await db.all(
    'SELECT * FROM registration_members WHERE registration_id = ?',
    [regId],
  );
  const PRIORITY = { head_coach: 0, manager: 1, captain: 2, player: 2 };
  const parsed = rows.map((m) => {
    let roles = [];
    try { roles = JSON.parse(m.roles || '[]'); } catch { roles = []; }
    const primary = roles.length
      ? Math.min(...roles.map((r) => PRIORITY[r] ?? 9))
      : 9;
    const no = parseInt(String(m.jersey_no || '').replace(/\D/g, ''), 10);
    return { m, roles, primary, jerseyNum: Number.isFinite(no) ? no : 999999 };
  });
  parsed.sort((a, b) =>
    a.primary - b.primary ||
    a.jerseyNum - b.jerseyNum ||
    a.m.name.localeCompare(b.m.name, 'zh-Hans-CN'));
  const out = [];
  for (const { m, roles } of parsed) {
    const files = await db.all(
      "SELECT id, kind, original_name, mime, size, created_at FROM files WHERE owner_type='registration_member' AND owner_id = ?",
      [m.id],
    );
    out.push({
      id: m.id,
      name: m.name,
      phone: m.phone,
      isContact: Boolean(m.is_contact),
      roles,
      jerseyNo: m.jersey_no || '',
      files,
    });
  }
  return out;
}

async function findPhoneConflict(db, eventId, phone, excludeRegId = null) {
  const sql = excludeRegId
    ? `SELECT r.team_name FROM registration_members m
        JOIN registrations r ON r.id = m.registration_id
       WHERE r.event_id = ? AND m.phone = ? AND r.id <> ? LIMIT 1`
    : `SELECT r.team_name FROM registration_members m
        JOIN registrations r ON r.id = m.registration_id
       WHERE r.event_id = ? AND m.phone = ? LIMIT 1`;
  return db.get(sql, excludeRegId ? [eventId, phone, excludeRegId] : [eventId, phone]);
}

export function registerRegistrationRoutes(router) {
  router.add('GET', '/api/events/:id/registrations', async (req, res, params) => {
    const user = await authUser(req);
    const db = getDb();
    const event = await loadEvent(db, params.id);
    const url = new URL(req.url, 'http://x');
    const status = url.searchParams.get('status') || '';
    const where = ['event_id = ?'];
    const args = [event.id];
    if (['pending', 'approved', 'rejected'].includes(status)) {
      where.push('status = ?');
      args.push(status);
    }
    const rows = await db.all(
      `SELECT * FROM registrations WHERE ${where.join(' AND ')} ORDER BY apply_time DESC`,
      args,
    );
    const isAdmin = user.role === 'admin';
    const out = [];
    for (const r of rows) {
      const base = {
        id: r.id,
        teamName: r.team_name,
        jerseyTop: r.jersey_top || '',
        jerseyShorts: r.jersey_shorts || '',
        jerseySocks: r.jersey_socks || '',
        status: r.status,
        applyTime: r.apply_time,
        memberCount: 0,
      };
      const members = await membersOf(db, r.id);
      base.memberCount = members.length;
      if (isAdmin) {
        const mine = members.find((m) => m.phone === user.phone);
        out.push({
          ...base,
          rejectReason: r.reject_reason,
          reviewedAt: r.reviewed_at,
          createdBy: r.created_by,
          members,
          isMyTeam: Boolean(mine),
          isContact: Boolean(mine?.isContact),
        });
      } else {
        // 非管理员：同样返回完整名单（需求要求所有球员可查看全部报名信息），
        // 但标记当前用户是否在本队，便于前端置顶与自助编辑。
        const mine = members.find((m) => m.phone === user.phone);
        out.push({
          ...base,
          isMyTeam: Boolean(mine),
          isContact: Boolean(mine?.isContact),
          members,
        });
      }
    }
    sendJson(res, 200, out);
  });

  router.add('GET', '/api/registrations/mine', async (req, res) => {
    const user = await authUser(req);
    const db = getDb();
    const rows = await db.all(
      `SELECT r.*, e.name AS event_name FROM registrations r
        JOIN events e ON e.id = r.event_id
       WHERE r.created_by = ? ORDER BY r.apply_time DESC`,
      [user.id],
    );
    const out = [];
    for (const r of rows) {
      out.push({
        id: r.id,
        eventId: r.event_id,
        eventName: r.event_name,
        teamName: r.team_name,
        jerseyTop: r.jersey_top || '',
        jerseyShorts: r.jersey_shorts || '',
        jerseySocks: r.jersey_socks || '',
        status: r.status,
        rejectReason: r.reject_reason,
        applyTime: r.apply_time,
        members: await membersOf(db, r.id),
      });
    }
    sendJson(res, 200, out);
  });

  // 整队报名：每个成员都需要姓名 + 手机号 + 学生卡照片
  router.add('POST', '/api/events/:id/registrations', async (req, res, params) => {
    const user = await authUser(req);
    requireAction(user, 'registration.submit');
    const db = getDb();
    const event = await loadEvent(db, params.id);
    if (event.status === 'ended') throw badRequest('赛事已结束，不再接受报名');
    if (event.status === 'live') {
      throw badRequest('报名已结束，球队名单已锁定，不可修改或新增', 'REG_LOCKED');
    }
    const body = await readJson(req);
    const teamName = String(body.teamName || '').trim();
    const jerseyTop = String(body.jerseyTop || '').trim();
    const jerseyShorts = String(body.jerseyShorts || '').trim();
    const jerseySocks = String(body.jerseySocks || '').trim();
    const members = Array.isArray(body.members) ? body.members : [];
    if (!teamName) throw badRequest('请填写球队名称');
    if (!jerseyTop || !jerseyShorts || !jerseySocks) {
      throw badRequest('球衣上衣、短裤、球袜三种颜色都必须填写');
    }
    if (members.length < 2) throw badRequest('请至少填写 2 名球队成员（含报名联系人）');
    const dup = await db.get(
      `SELECT 1 FROM registrations r
        WHERE r.event_id = ? AND r.team_name = ? AND r.status = 'approved'`,
      [event.id, teamName],
    );
    if (dup) throw badRequest('该球队已通过审核，请勿重复报名', 'DUPLICATE_TEAM');

    const contact = members[0];
    if (user.role !== 'admin' && String(contact.phone || '') !== user.phone) {
      throw badRequest('第一位成员必须是报名联系人本人（当前登录手机号）');
    }
    const cleaned = [];
    const phones = new Set();
    const playerNos = new Set();
    for (const m of members) {
      const name = String(m.name || '').trim();
      const phone = String(m.phone || '').trim();
      if (!name) throw badRequest('每位成员都需要填写姓名');
      if (!checkPhone(phone)) throw badRequest(`成员「${name || '未知'}」的手机号格式不正确`);
      if (phones.has(phone)) throw badRequest('同一球队内手机号不能重复，请检查成员名单');
      phones.add(phone);
      const conflict = await findPhoneConflict(db, event.id, phone);
      if (conflict) {
        throw badRequest(`手机号 ${phone} 已报名「${conflict.team_name}」，一人不能同时在两支球队报名`);
      }
      const roles = normalizeRoles(m.roles);
      const jerseyNo = normalizeJerseyNo(m.jerseyNo, roles, name);
      if (roles.includes('player')) {
        if (playerNos.has(jerseyNo)) {
          throw badRequest(`同一支球队两名队员的球衣号码「${jerseyNo}」不能重复`);
        }
        playerNos.add(jerseyNo);
      }
      const file = m.file || {};
      const decoded = decodeDataUrl(file.dataUrl);
      if (!decoded) throw badRequest(`请上传成员「${name}」的学生卡照片`);
      if (!checkImageMagic(decoded.buffer, decoded.mime)) {
        throw badRequest(`成员「${name}」的学生卡照片仅支持 JPG/PNG`);
      }
      cleaned.push({ name, phone, roles, jerseyNo, file: file, decoded });
    }
    assertUniqueRoles(cleaned);

    const regId = uid('reg_');
    const now = nowIso();
    await db.run(
      `INSERT INTO registrations
        (id, event_id, team_name, jersey_top, jersey_shorts, jersey_socks, status, apply_time, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [regId, event.id, teamName, jerseyTop, jerseyShorts, jerseySocks, now, user.id],
    );
    try {
      const dir = path.join(config.uploadDir, 'registrations');
      fs.mkdirSync(dir, { recursive: true });
      for (let i = 0; i < cleaned.length; i += 1) {
        const mem = cleaned[i];
        const mid = uid('mem_');
        await db.run(
          `INSERT INTO registration_members (id, registration_id, name, phone, roles, jersey_no, is_contact, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [mid, regId, mem.name, mem.phone, JSON.stringify(mem.roles), mem.jerseyNo, i === 0 ? 1 : 0, now],
        );
        const fileId = uid('file_');
        const rel = path.join('registrations', `${fileId}${extForMime(mem.decoded.mime)}`);
        const abs = path.join(config.uploadDir, rel);
        fs.writeFileSync(abs, mem.decoded.buffer);
        await db.run(
          `INSERT INTO files
            (id, owner_type, owner_id, kind, original_name, mime, path, size, uploaded_by, created_at)
           VALUES (?, 'registration_member', ?, 'campus_card', ?, ?, ?, ?, ?, ?)`,
          [fileId, mid, String(mem.file.originalName || `学生卡-${mem.name}.jpg`).slice(0, 120),
            mem.decoded.mime, abs, mem.decoded.buffer.length, user.id, now],
        );
      }
    } catch (e) {
      await db.run('DELETE FROM registrations WHERE id = ?', [regId]);
      throw e;
    }
    await audit(db, user, 'registration.submit', 'registration', regId,
      { eventId: event.id, teamName, memberCount: cleaned.length }, clientIp(req));
    sendJson(res, 201, {
      id: regId,
      message: '报名已提交，等待管理员审核；报名截止后名单将锁定',
      status: 'pending',
      memberCount: cleaned.length,
    });
  });

  router.add('POST', '/api/registrations/:id/review', async (req, res, params) => {
    const user = await authUser(req);
    requireAction(user, 'registration.review');
    const db = getDb();
    const reg = await db.get('SELECT * FROM registrations WHERE id = ?', [params.id]);
    if (!reg) throw notFound('报名记录不存在');
    if (reg.status !== 'pending') throw badRequest('该报名已处理，请刷新列表');
    await assertEventScope(db, user, 'registration.review', reg.event_id);
    const body = await readJson(req);
    const action = body.action;
    if (!['approve', 'reject'].includes(action)) throw badRequest('操作只能是通过或拒绝');
    if (action === 'approve') {
      const dup = await db.get(
        `SELECT 1 FROM registrations WHERE event_id = ? AND team_name = ? AND status = 'approved'`,
        [reg.event_id, reg.team_name],
      );
      if (dup) throw badRequest('已存在同名已通过球队，不能重复通过', 'DUPLICATE_TEAM');
    }
    const next = action === 'approve' ? 'approved' : 'rejected';
    const reason = action === 'reject' ? String(body.reason || '').trim() : null;
    await db.run(
      `UPDATE registrations SET status = ?, reject_reason = ?, reviewed_by = ?, reviewed_at = ?
        WHERE id = ?`,
      [next, reason, user.id, nowIso(), reg.id],
    );
    await audit(db, user, action === 'approve' ? 'registration.approve' : 'registration.reject',
      'registration', reg.id,
      { eventId: reg.event_id, teamName: reg.team_name, reason }, clientIp(req));
    sendJson(res, 200, {
      message: action === 'approve' ? '已通过，球队进入已报名名单' : '已拒绝该球队报名',
      status: next,
    });
  });

  // 队员本人完善/更新个人报名信息（学生卡照片），仅报名中有效
  router.add('PATCH', '/api/registrations/:id/me', async (req, res, params) => {
    const user = await authUser(req);
    requireAction(user, 'registration.submit');
    const db = getDb();
    const reg = await db.get('SELECT * FROM registrations WHERE id = ?', [params.id]);
    if (!reg) throw notFound('报名记录不存在');
    const event = await loadEvent(db, reg.event_id);
    if (event.status !== 'signup') {
      throw badRequest('当前不在报名期，个人信息已锁定', 'REG_LOCKED');
    }
    const member = await db.get(
      'SELECT * FROM registration_members WHERE registration_id = ? AND phone = ?',
      [reg.id, user.phone],
    );
    if (!member) throw forbidden('你不在该球队报名名单中，无法操作');
    const body = await readJson(req);
    const decoded = decodeDataUrl(body.file?.dataUrl);
    if (!decoded) throw badRequest('请上传本人学生卡照片');
    if (!checkImageMagic(decoded.buffer, decoded.mime)) {
      throw badRequest('学生卡照片仅支持 JPG/PNG');
    }
    const newName = String(body.name || '').trim() || member.name;
    if (newName.length < 2 || newName.length > 20) {
      throw badRequest('姓名需为 2-20 个字符');
    }
    let roles = [];
    try { roles = JSON.parse(member.roles || '[]'); } catch { roles = []; }
    const jerseyNo = normalizeJerseyNo(body.jerseyNo, roles, newName);
    if (newName !== member.name || jerseyNo !== (member.jersey_no || '')) {
      await db.run('UPDATE registration_members SET name = ?, jersey_no = ? WHERE id = ?',
        [newName, jerseyNo, member.id]);
    }
    const dir = path.join(config.uploadDir, 'registrations');
    fs.mkdirSync(dir, { recursive: true });
    const oldFiles = await db.all(
      "SELECT * FROM files WHERE owner_type='registration_member' AND owner_id = ?",
      [member.id],
    );
    for (const f of oldFiles) {
      if (f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path);
      await db.run('DELETE FROM files WHERE id = ?', [f.id]);
    }
    const fileId = uid('file_');
    const rel = path.join('registrations', `${fileId}${extForMime(decoded.mime)}`);
    const abs = path.join(config.uploadDir, rel);
    fs.writeFileSync(abs, decoded.buffer);
    await db.run(
      `INSERT INTO files
        (id, owner_type, owner_id, kind, original_name, mime, path, size, uploaded_by, created_at)
       VALUES (?, 'registration_member', ?, 'campus_card', ?, ?, ?, ?, ?, ?)`,
      [fileId, member.id, String(body.file?.originalName || `学生卡-${user.name}.jpg`).slice(0, 120),
        decoded.mime, abs, decoded.buffer.length, user.id, nowIso()],
    );
    await audit(db, user, 'registration.member_update', 'registration', reg.id,
      { teamName: reg.team_name }, clientIp(req));
    sendJson(res, 200, { message: '个人信息已更新', memberId: member.id });
  });

  // 加入一支已创建的球队（互斥：同一人同一赛事只能加入一支球队）
  router.add('POST', '/api/registrations/:id/join', async (req, res, params) => {
    const user = await authUser(req);
    requireAction(user, 'registration.submit');
    const db = getDb();
    const reg = await db.get('SELECT * FROM registrations WHERE id = ?', [params.id]);
    if (!reg) throw notFound('报名记录不存在');
    const event = await loadEvent(db, reg.event_id);
    if (event.status !== 'signup') {
      throw badRequest('当前不在报名期，无法加入球队', 'REG_LOCKED');
    }
    const conflict = await findPhoneConflict(db, event.id, user.phone);
    if (conflict) {
      throw badRequest(`你已报名「${conflict.team_name}」，一人不能同时在两支球队报名`);
    }
    const body = await readJson(req);
    const name = String(body.name || '').trim() || user.name;
    const roles = normalizeRoles(body.roles || ['player']);
    await assertTeamUniqueRolesWithMember(db, reg.id, roles);
    const jerseyNo = normalizeJerseyNo(body.jerseyNo, roles, name);
    const decoded = decodeDataUrl(body.file?.dataUrl);
    if (!decoded) throw badRequest('请上传本人学生卡照片');
    if (!checkImageMagic(decoded.buffer, decoded.mime)) {
      throw badRequest('学生卡照片仅支持 JPG/PNG');
    }
    const memberId = uid('mem_');
    const now = nowIso();
    await db.run(
      `INSERT INTO registration_members (id, registration_id, name, phone, roles, jersey_no, is_contact, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      [memberId, reg.id, name, user.phone, JSON.stringify(roles), jerseyNo, now],
    );
    const dir = path.join(config.uploadDir, 'registrations');
    fs.mkdirSync(dir, { recursive: true });
    const fileId = uid('file_');
    const rel = path.join('registrations', `${fileId}${extForMime(decoded.mime)}`);
    const abs = path.join(config.uploadDir, rel);
    fs.writeFileSync(abs, decoded.buffer);
    await db.run(
      `INSERT INTO files
        (id, owner_type, owner_id, kind, original_name, mime, path, size, uploaded_by, created_at)
       VALUES (?, 'registration_member', ?, 'campus_card', ?, ?, ?, ?, ?, ?)`,
      [fileId, memberId, String(body.file?.originalName || `学生卡-${name}.jpg`).slice(0, 120),
        decoded.mime, abs, decoded.buffer.length, user.id, now],
    );
    await audit(db, user, 'registration.join', 'registration', reg.id,
      { teamName: reg.team_name, roles, jerseyNo }, clientIp(req));
    sendJson(res, 201, { message: `已加入「${reg.team_name}」`, memberId });
  });

  // 取消报名：仅移除本人，若联系人退出且仍有队员则自动转移联系人
  router.add('DELETE', '/api/registrations/:id/me', async (req, res, params) => {
    const user = await authUser(req);
    requireAction(user, 'registration.submit');
    const db = getDb();
    const reg = await db.get('SELECT * FROM registrations WHERE id = ?', [params.id]);
    if (!reg) throw notFound('报名记录不存在');
    const event = await loadEvent(db, reg.event_id);
    if (event.status !== 'signup') {
      throw badRequest('当前不在报名期，无法取消报名', 'REG_LOCKED');
    }
    const member = await db.get(
      'SELECT * FROM registration_members WHERE registration_id = ? AND phone = ?',
      [reg.id, user.phone],
    );
    if (!member) throw notFound('你不在该球队名单中');
    const files = await db.all(
      "SELECT * FROM files WHERE owner_type='registration_member' AND owner_id = ?",
      [member.id],
    );
    for (const f of files) {
      if (f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path);
      await db.run('DELETE FROM files WHERE id = ?', [f.id]);
    }
    await db.run('DELETE FROM registration_members WHERE id = ?', [member.id]);
    const remaining = await db.all(
      'SELECT * FROM registration_members WHERE registration_id = ? ORDER BY created_at',
      [reg.id],
    );
    if (!remaining.length) {
      await db.run('DELETE FROM registrations WHERE id = ?', [reg.id]);
    } else if (member.is_contact && !remaining.some((m) => m.is_contact)) {
      await db.run(
        'UPDATE registration_members SET is_contact = 1 WHERE id = ?',
        [remaining[0].id],
      );
    }
    await audit(db, user, 'registration.cancel', 'registration', reg.id,
      { teamName: reg.team_name, removed: remaining.length ? false : true }, clientIp(req));
    sendJson(res, 200, {
      message: remaining.length ? '已取消你在该队的报名' : '已取消报名，球队已解散',
    });
  });

  // 报名中可编辑整队名单；赛事转为“进行中”后锁定
  router.add('PATCH', '/api/registrations/:id', async (req, res, params) => {
    const user = await authUser(req);
    requireAction(user, 'registration.submit');
    const db = getDb();
    const reg = await db.get('SELECT * FROM registrations WHERE id = ?', [params.id]);
    if (!reg) throw notFound('报名记录不存在');
    const event = await loadEvent(db, reg.event_id);
    if (event.status !== 'signup') {
      throw badRequest('当前不在报名期，名单已锁定，不可修改', 'REG_LOCKED');
    }
    if (user.role === 'player' && reg.created_by !== user.id) {
      throw forbidden('只能编辑由本人作为联系人提交的报名');
    }
    const body = await readJson(req);
    const teamName = String(body.teamName || '').trim();
    const jerseyTop = String(body.jerseyTop || '').trim();
    const jerseyShorts = String(body.jerseyShorts || '').trim();
    const jerseySocks = String(body.jerseySocks || '').trim();
    const members = Array.isArray(body.members) ? body.members : [];
    if (!teamName) throw badRequest('请填写球队名称');
    if (!jerseyTop || !jerseyShorts || !jerseySocks) {
      throw badRequest('球衣上衣、短裤、球袜三种颜色都必须填写');
    }
    if (members.length < 2) throw badRequest('请至少填写 2 名球队成员（含报名联系人）');
    const dup = await db.get(
      `SELECT 1 FROM registrations WHERE event_id = ? AND team_name = ? AND status='approved' AND id <> ?`,
      [event.id, teamName, reg.id],
    );
    if (dup) throw badRequest('已存在同名已通过球队', 'DUPLICATE_TEAM');
    const contact = members[0];
    if (user.role !== 'admin' && String(contact.phone || '') !== user.phone) {
      throw badRequest('第一位成员必须是报名联系人本人（当前登录手机号）');
    }
    const cleaned = [];
    const phones = new Set();
    const playerNos = new Set();
    for (const m of members) {
      const name = String(m.name || '').trim();
      const phone = String(m.phone || '').trim();
      if (!name) throw badRequest('每位成员都需要填写姓名');
      if (!checkPhone(phone)) throw badRequest(`成员「${name || '未知'}」的手机号格式不正确`);
      if (phones.has(phone)) throw badRequest('同一球队内手机号不能重复');
      phones.add(phone);
      const conflict = await findPhoneConflict(db, event.id, phone, reg.id);
      if (conflict) {
        throw badRequest(`手机号 ${phone} 已报名「${conflict.team_name}」，一人不能同时在两支球队报名`);
      }
      const roles = normalizeRoles(m.roles);
      const jerseyNo = normalizeJerseyNo(m.jerseyNo, roles, name);
      if (roles.includes('player')) {
        if (playerNos.has(jerseyNo)) {
          throw badRequest(`同一支球队两名队员的球衣号码「${jerseyNo}」不能重复`);
        }
        playerNos.add(jerseyNo);
      }
      const decoded = decodeDataUrl(m.file?.dataUrl);
      if (!decoded) throw badRequest(`请重新上传成员「${name}」的学生卡照片`);
      if (!checkImageMagic(decoded.buffer, decoded.mime)) {
        throw badRequest(`成员「${name}」的学生卡照片仅支持 JPG/PNG`);
      }
      cleaned.push({ name, phone, roles, jerseyNo, file: m.file, decoded });
    }
    assertUniqueRoles(cleaned);
    // 删除旧名单与其文件
    const oldMembers = await db.all(
      'SELECT id FROM registration_members WHERE registration_id = ?',
      [reg.id],
    );
    for (const old of oldMembers) {
      const files = await db.all(
        "SELECT * FROM files WHERE owner_type='registration_member' AND owner_id = ?",
        [old.id],
      );
      for (const f of files) {
        if (f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path);
        await db.run('DELETE FROM files WHERE id = ?', [f.id]);
      }
    }
    await db.run('DELETE FROM registration_members WHERE registration_id = ?', [reg.id]);
    const now = nowIso();
    const nextStatus = reg.status === 'rejected' ? 'pending' : reg.status;
    await db.run(
      `UPDATE registrations
          SET team_name = ?, jersey_top = ?, jersey_shorts = ?, jersey_socks = ?,
              status = ?, reject_reason = NULL, reviewed_by = NULL, reviewed_at = NULL
        WHERE id = ?`,
      [teamName, jerseyTop, jerseyShorts, jerseySocks, nextStatus, reg.id],
    );
    const dir = path.join(config.uploadDir, 'registrations');
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < cleaned.length; i += 1) {
      const mem = cleaned[i];
      const mid = uid('mem_');
      await db.run(
        `INSERT INTO registration_members (id, registration_id, name, phone, roles, jersey_no, is_contact, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [mid, reg.id, mem.name, mem.phone, JSON.stringify(mem.roles), mem.jerseyNo, i === 0 ? 1 : 0, now],
      );
      const fileId = uid('file_');
      const rel = path.join('registrations', `${fileId}${extForMime(mem.decoded.mime)}`);
      const abs = path.join(config.uploadDir, rel);
      fs.writeFileSync(abs, mem.decoded.buffer);
      await db.run(
        `INSERT INTO files
          (id, owner_type, owner_id, kind, original_name, mime, path, size, uploaded_by, created_at)
         VALUES (?, 'registration_member', ?, 'campus_card', ?, ?, ?, ?, ?, ?)`,
        [fileId, mid, String(mem.file.originalName || `学生卡-${mem.name}.jpg`).slice(0, 120),
          mem.decoded.mime, abs, mem.decoded.buffer.length, user.id, now],
      );
    }
    await audit(db, user, 'registration.update', 'registration', reg.id,
      { eventId: event.id, teamName, memberCount: cleaned.length }, clientIp(req));
    sendJson(res, 200, {
      message: nextStatus === 'pending' ? '名单已更新并重新提交审核' : '队员名单已更新',
      status: nextStatus,
      memberCount: cleaned.length,
    });
  });

  // 文件访问：管理员 / 文件上传者 / 名单内本人
  router.add('GET', '/api/files/:id', async (req, res, params) => {
    const user = await authUser(req);
    const db = getDb();
    const file = await db.get('SELECT * FROM files WHERE id = ?', [params.id]);
    if (!file) throw notFound('文件不存在');
    let allowed = user.role === 'admin' || file.uploaded_by === user.id;
    if (file.owner_type === 'registration_member') allowed = true;
    if (!allowed) throw forbidden('无权查看该文件');
    if (!file.path || !fs.existsSync(file.path)) {
      sendJson(res, 404, { error: '演示数据未包含实体文件', code: 'NO_FILE' });
      return;
    }
    const mime = file.mime || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': fs.statSync(file.path).size,
      'Cache-Control': 'private, max-age=600',
      'Access-Control-Allow-Origin': config.corsOrigin,
    });
    fs.createReadStream(file.path).pipe(res);
  });
}
