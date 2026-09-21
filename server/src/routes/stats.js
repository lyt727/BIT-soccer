import { authUser, loadEvent } from '../helpers.js';
import { getDb } from '../db.js';
import { computeStandings, computeGroupStandings, computeScorers } from '../stats.js';
import { sendJson } from '../http.js';

export function registerStatsRoutes(router) {
  router.add('GET', '/api/events/:id/standings', async (req, res, params) => {
    await authUser(req);
    const db = getDb();
    await loadEvent(db, params.id);
    sendJson(res, 200, computeStandings(db, params.id));
  });

  router.add('GET', '/api/events/:id/standings-by-group', async (req, res, params) => {
    await authUser(req);
    const db = getDb();
    await loadEvent(db, params.id);
    sendJson(res, 200, computeGroupStandings(db, params.id));
  });

  router.add('GET', '/api/events/:id/scorers', async (req, res, params) => {
    await authUser(req);
    const db = getDb();
    await loadEvent(db, params.id);
    sendJson(res, 200, computeScorers(db, params.id));
  });

  router.add('GET', '/api/events/:id/staff-stats', async (req, res, params) => {
    await authUser(req);
    const db = getDb();
    await loadEvent(db, params.id);
    const matches = await db.all('SELECT * FROM matches WHERE event_id = ?', [params.id]);
    const REF_ROLES = [
      ['referee', '主裁判'],
      ['assistant1', '第一助理裁判'],
      ['assistant2', '第二助理裁判'],
      ['fourth_official', '第四官员'],
    ];
    const STAFF_ROLES = [
      ['match_supervisor', '比赛监督'],
      ['photographer', '拍照同学'],
      ['videographer', '录像同学'],
      ['commentator', '解说同学'],
      ['reporter', '战报同学'],
    ];
    const collect = (defs) => {
      const map = new Map();
      for (const m of matches) {
        for (const [col] of defs) {
          const name = String(m[col] || '').trim();
          if (!name) continue;
          if (!map.has(name)) map.set(name, 0);
          map.set(name, map.get(name) + 1);
        }
      }
      return map;
    };
    const rowsFor = (defs) => {
      const rows = [];
      for (const [col, label] of defs) {
        const map = collect([[col, label]]);
        const list = [...map.entries()]
          .map(([name, matchesCount]) => ({ name, matches: matchesCount }))
          .sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name, 'zh-Hans-CN'));
        for (const item of list) rows.push({ role: label, ...item });
      }
      return rows;
    };
    sendJson(res, 200, {
      referees: rowsFor(REF_ROLES),
      staff: rowsFor(STAFF_ROLES),
    });
  });
}
