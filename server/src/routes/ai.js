import { authUser, audit, clientIp, loadEvent } from '../helpers.js';
import { getDb } from '../db.js';
import { requireAction, assertEventScope } from '../rbac.js';
import { readJson, sendJson } from '../http.js';
import { badRequest } from '../errors.js';
import { recognizeMatch, getProviderStatus } from '../services/aiRecognition.js';
import { config, nowIso } from '../config.js';
import { uid } from '../config.js';

function imageType(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|jpg));base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > config.aiMaxUploadBytes) return null;
  return { mime: m[1], buf };
}

export function registerAiRoutes(router) {
  router.add('GET', '/api/ai/status', async (req, res) => {
    await authUser(req);
    sendJson(res, 200, getProviderStatus());
  });

  router.add('POST', '/api/ai/recognize', async (req, res) => {
    const user = await authUser(req);
    requireAction(user, 'ai.recognize');
    const db = getDb();
    const body = await readJson(req);
    const eventId = String(body.eventId || '');
    if (!eventId) throw badRequest('请先选择赛事');
    const event = await loadEvent(db, eventId);
    await assertEventScope(db, user, 'ai.recognize', eventId);
    if (event.status === 'ended') throw badRequest('赛事已结束，结果已锁定');

    const images = Array.isArray(body.images) ? body.images : [];
    if (!images.length) throw badRequest('请至少选择 1 张比赛记录图片');
    const checked = [];
    for (const img of images.slice(0, 6)) {
      const info = imageType(img.dataUrl);
      if (!info) {
        throw badRequest('图片格式仅支持 JPG/PNG，且单张不超过 12MB');
      }
      checked.push({
        name: String(img.name || `照片${checked.length + 1}`),
        mime: info.mime,
        dataUrl: img.dataUrl,
      });
    }

    const teamOptions = await db.all(
      `SELECT id, team_name AS name FROM registrations
        WHERE event_id = ? AND status = 'approved' ORDER BY team_name`,
      [eventId],
    );
    const openMatches = await db.all(
      `SELECT id, team_a_id, team_b_id, match_date, start_time, venue
         FROM matches WHERE event_id = ? AND status = 'scheduled'
         ORDER BY match_date, start_time`,
      [eventId],
    );
    const preferMatchId = String(body.preferMatchId || '');
    if (preferMatchId) {
      const idx = openMatches.findIndex((m) => m.id === preferMatchId);
      if (idx > 0) {
        const [preferred] = openMatches.splice(idx, 1);
        openMatches.unshift(preferred);
      }
    }
    const result = await recognizeMatch(checked, {
      eventId,
      teamOptions,
      scheduledPairs: openMatches,
    });

    // 推荐可回填的未开赛比赛（对阵与识别结果一致时）
    const ra = result.match.registrationA?.id;
    const rb = result.match.registrationB?.id;
    const suggested = openMatches.find((m) =>
      (m.team_a_id === ra && m.team_b_id === rb) ||
      (m.team_a_id === rb && m.team_b_id === ra));

    await audit(db, user, 'ai.recognize', 'event', eventId,
      { images: checked.length, teamCount: teamOptions.length,
        provider: result.meta.provider }, clientIp(req));

    sendJson(res, 200, {
      recognitionId: uid('ai_'),
      eventId,
      ...result,
      suggestedMatchId: suggested?.id || null,
      suggestedMatches: openMatches,
      canApply: Boolean(suggested),
      now: nowIso(),
    });
  });
}
