// 必须在读取任何配置之前先把仓库根目录的 .env 读进 process.env。
// 静态导入保证求值顺序：本行先于下面的 config 定义执行。
// （已存在的真实环境变量优先，不会被 .env 覆盖；容器里没有 .env 文件也不影响。）
import './env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  // 服务端口
  port: Number(process.env.PORT || 3000),

  // 数据库：sqlite（本地演示，零依赖）/ pg（云数据库 PostgreSQL）
  dbDriver: process.env.DB_DRIVER || 'sqlite',
  dbFile: process.env.DB_FILE || path.join(__dirname, '..', 'data', 'greensinbit.db'),
  pgConnection: process.env.DATABASE_URL || '',

  // JWT 密钥（生产环境必须通过环境变量注入并定期轮换）
  jwtSecret: process.env.JWT_SECRET || 'greensinbit-dev-secret-change-me',
  tokenTtlSeconds: 12 * 3600,

  // 上传目录
  uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads'),

  // 前端静态目录
  webRoot: process.env.WEB_ROOT || path.join(__dirname, '..', '..', 'app'),

  // ---------------------------------------------------------------
  // AI 识图配置（未配置密钥时自动使用「演示识别」模式）
  // 任意 OpenAI 兼容的视觉模型都可用，如：
  //   OpenAI gpt-4o / 阿里云百炼 qwen-vl-max / 智谱 GLM-4V / MiniMax
  // ---------------------------------------------------------------
  aiProvider: process.env.AI_PROVIDER || 'auto',      // auto | demo | vision
  // 默认指向阿里云百炼（OpenAI 兼容模式）；换厂商只需改环境变量
  aiVisionBaseUrl: process.env.AI_VISION_BASE_URL
    || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  aiVisionApiKey: process.env.AI_VISION_API_KEY || '',
  aiVisionModel: process.env.AI_VISION_MODEL || 'qwen-vl-max',
  aiMaxUploadBytes: Number(process.env.AI_MAX_UPLOAD_BYTES || 12 * 1024 * 1024),
  aiSimulateDelayMs: Number(process.env.AI_SIMULATE_DELAY_MS || 1600),

  // 短信验证码：demo（本地演示，验证码直接返回）/ tencent / aliyun / webhook
  smsMode: process.env.SMS_MODE || 'demo',
  smsProvider: process.env.SMS_PROVIDER || '',
  // 演示验证码：仅在非生产环境默认开启。生产环境必须通过真实短信通道下发，
  // 否则任何人拿到手机号即可登录任意账号。需要时用 ALLOW_DEMO_CODE=true 显式放开。
  allowDemoCode: process.env.ALLOW_DEMO_CODE
    ? process.env.ALLOW_DEMO_CODE === 'true'
    : process.env.NODE_ENV !== 'production',
  // 演示账号（以及历史无密码账号）的初始密码，可用 DEMO_PASSWORD 覆盖
  demoPassword: process.env.DEMO_PASSWORD || '123456',
  // 按手机号指定角色（短信上线后认证管理员用；写成 "手机号" 或 "手机号:姓名"，
  // 多个用逗号分隔）。只做「补建账号 + 提升角色」，绝不删人、不降级、不覆盖姓名密码。
  adminPhones: process.env.ADMIN_PHONES || '',
  dataOperatorPhones: process.env.DATA_OPERATOR_PHONES || '',
  smsCodeTtlSeconds: Number(process.env.SMS_CODE_TTL_SECONDS || 300),
  smsResendSeconds: Number(process.env.SMS_RESEND_SECONDS || 60),
  smsWebhookUrl: process.env.SMS_WEBHOOK_URL || '',
  smsWebhookToken: process.env.SMS_WEBHOOK_TOKEN || '',
  tencentSms: {
    secretId: process.env.TENCENT_SMS_SECRET_ID || '',
    secretKey: process.env.TENCENT_SMS_SECRET_KEY || '',
    appId: process.env.TENCENT_SMS_APP_ID || '',
    signName: process.env.TENCENT_SMS_SIGN_NAME || '',
    templateId: process.env.TENCENT_SMS_TEMPLATE_ID || '',
    region: process.env.TENCENT_SMS_REGION || 'ap-guangzhou',
  },
  aliyunSms: {
    accessKeyId: process.env.ALIYUN_SMS_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.ALIYUN_SMS_ACCESS_KEY_SECRET || '',
    signName: process.env.ALIYUN_SMS_SIGN_NAME || '',
    templateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE || '',
    // 模板内容里用到的变量，必须与阿里云控制台模板一字不差地对上。
    // 例：模板内容「验证码为${code}，${min}分钟内有效」→ 这里写 code,min
    // （阿里云赠送的「登录/注册模板」100001 就是 code + min 两个变量）
    templateVars: process.env.ALIYUN_SMS_TEMPLATE_VARS || 'code,min',
    regionId: process.env.ALIYUN_SMS_REGION_ID || 'cn-hangzhou',
  },

  corsOrigin: process.env.CORS_ORIGIN || '*',
};

export function nowIso() {
  return new Date().toISOString();
}

export function uid(prefix = '') {
  const rnd = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().replaceAll('-', '').slice(0, 16)
    : Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  return `${prefix}${rnd}`;
}
