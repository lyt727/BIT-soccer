import { authUser } from '../helpers.js';
import { getDb } from '../db.js';
import { requireAction } from '../rbac.js';
import { sendJson } from '../http.js';

export function registerAuditRoutes(router) {
  router.add('GET', '/api/audit', async (req, res) => {
    const user = await authUser(req);
    requireAction(user, 'user.manage');
    const db = getDb();
    const url = new URL(req.url, 'http://x');
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
    const rows = await db.all(
      `SELECT phone, action, entity, entity_id, detail, ip, created_at
         FROM audit_log ORDER BY created_at DESC LIMIT ?`,
      [limit],
    );
    sendJson(res, 200, rows);
  });
}
