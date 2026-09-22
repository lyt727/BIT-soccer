import { getDb, ensureDb } from './db.js';
import { seedIfEmpty } from './seed.js';
import { config } from './config.js';
import { ApiRouter, createApiServer, serveStatic } from './http.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerUserRoutes } from './routes/users.js';
import { registerEventRoutes } from './routes/events.js';
import { registerRegistrationRoutes } from './routes/registrations.js';
import { registerGroupRoutes } from './routes/groups.js';
import { registerMatchRoutes } from './routes/matches.js';
import { registerStatsRoutes } from './routes/stats.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerAuditRoutes } from './routes/audit.js';
import { sendJson } from './http.js';

async function main() {
  await ensureDb();
  const db = getDb();
  const isSqlite = config.dbDriver === 'sqlite';
  if (isSqlite && seedIfEmpty(db)) {
    console.log(`[seed] 已写入演示数据（手机号 + 密码登录，初始密码 ${config.demoPassword}）`);
  }

  const router = new ApiRouter();
  router.add('GET', '/api/health', (req, res) => {
    sendJson(res, 200, { ok: true, time: new Date().toISOString() });
  });
  registerAuthRoutes(router);
  registerUserRoutes(router);
  registerEventRoutes(router);
  registerRegistrationRoutes(router);
  registerGroupRoutes(router);
  registerMatchRoutes(router);
  registerStatsRoutes(router);
  registerAiRoutes(router);
  registerAuditRoutes(router);

  const server = createApiServer(router, serveStatic(config.webRoot));
  server.listen(config.port, '0.0.0.0', () => {
    console.log('================================================');
    console.log('  绿茵BIT · 北理工校园足球赛事管理系统');
    console.log(`  本地访问：  http://localhost:${config.port}`);
    console.log(`  手机同网：  http://<本机局域网IP>:${config.port}`);
    console.log('------------------------------------------------');
    console.log(`  演示账号（手机号 + 密码登录，初始密码 ${config.demoPassword}）`);
    console.log('    13900000001  lby（管理员）');
    console.log('    13900000003  ljz（数据录入员）');
    console.log('    13800138001  zht（参赛球员）');
    console.log('    13800138002  clm（参赛球员）');
    console.log('------------------------------------------------');
    console.log(`  AI 识图：${getProviderStatusPublic()}`);
    console.log('================================================');
  });
}

function getProviderStatusPublic() {
  if (config.aiProvider === 'vision' || (config.aiProvider !== 'demo' && config.aiVisionApiKey)) {
    return `真实视觉模型 ${config.aiVisionModel}（base: ${config.aiVisionBaseUrl}）`;
  }
  return '演示识别模式（未配置 API Key，可设置 AI_VISION_API_KEY 启用真实识图）';
}

main().catch((err) => {
  console.error('启动失败：', err);
  process.exit(1);
});
