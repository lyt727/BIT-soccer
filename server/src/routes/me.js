import { authUser } from '../helpers.js';
import { getDb } from '../db.js';
import { buildMyProfile } from '../profile.js';
import { sendJson } from '../http.js';

export function registerMeRoutes(router) {
  // 「我的」个人主页聚合（本人所属球队 + 跨赛事个人数据）
  router.add('GET', '/api/me/profile', async (req, res) => {
    const user = await authUser(req);
    const db = getDb();
    const data = await buildMyProfile(db, user);
    sendJson(res, 200, data);
  });
}
