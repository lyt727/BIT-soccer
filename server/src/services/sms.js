import crypto from 'node:crypto';
import { config } from '../config.js';

// =============================================================
// 真实短信通道（零 SDK 依赖）
//   腾讯云短信：TC3-HMAC-SHA256 签名，接口 sms.tencentcloudapi.com
//   阿里云短信：RPC HMAC-SHA1 签名，接口 dysmsapi.aliyuncs.com
//   webhook：把 { phone, code } POST 给自己的短信网关
// 未配置时由调用方回退到演示模式。
// =============================================================

export function resolveSmsProvider() {
  const raw = (config.smsProvider || config.smsMode || 'demo').toLowerCase();
  if (['tencent', 'aliyun', 'webhook'].includes(raw)) return raw;
  return 'demo';
}

export async function sendSmsCode(phone, code) {
  const provider = resolveSmsProvider();
  if (provider === 'tencent') return sendTencent(phone, code);
  if (provider === 'aliyun') return sendAliyun(phone, code);
  if (provider === 'webhook') return sendWebhook(phone, code);
  return { demo: true };
}

function smsError(message) {
  const err = new Error(message);
  err.status = 502;
  err.code = 'SMS_SEND_FAILED';
  return err;
}

// ---------------- 腾讯云短信 ----------------
function sha256Hex(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

async function sendTencent(phone, code) {
  const { secretId, secretKey, appId, signName, templateId, region } = config.tencentSms;
  if (!secretId || !secretKey || !appId || !signName || !templateId) {
    throw smsError('腾讯云短信配置不完整，请检查 TENCENT_SMS_* 环境变量');
  }
  const host = 'sms.tencentcloudapi.com';
  const service = 'sms';
  const action = 'SendSms';
  const payload = JSON.stringify({
    PhoneNumberSet: [`+86${phone}`],
    SmsSdkAppId: appId,
    SignName: signName,
    TemplateId: templateId,
    TemplateParamSet: [code, String(Math.max(1, Math.round(config.smsCodeTtlSeconds / 60)))],
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const credentialScope = `${date}/${service}/tc3_request`;
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256Hex(payload)}`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;
  const secretDate = crypto.createHmac('sha256', `TC3${secretKey}`).update(date).digest();
  const secretService = crypto.createHmac('sha256', secretDate).update(service).digest();
  const secretSigning = crypto.createHmac('sha256', secretService).update('tc3_request').digest();
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, `
    + `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const res = await fetch(`https://${host}`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json; charset=utf-8',
      'X-TC-Action': action,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': '2021-01-11',
      'X-TC-Region': region,
    },
    body: payload,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  const err = data?.Response?.Error;
  if (!res.ok || err) {
    throw smsError(`腾讯云短信发送失败：${err?.Message || res.status}`);
  }
  return { provider: 'tencent', requestId: data?.Response?.RequestId || '' };
}

// ---------------- 阿里云短信 ----------------
function aliEncode(str) {
  return encodeURIComponent(str)
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

// 把阿里云返回的错误码翻译成能照着做的提示（否则只看到一串英文，很难定位）
function aliyunHint(code, message) {
  const s = `${code || ''} ${message || ''}`;
  // 注意用 \bRAM\b：不加边界的话 "param" 里的 "ram" 会被误判成权限问题
  if (/forbidden|not authorized|unauthor|no permission|denied|\bRAM\b/i.test(s)) {
    return '（这个 AccessKey 没有短信权限：如果是 RAM 子账号，请到 RAM 控制台给它授予 AliyunDysmsFullAccess；'
      + '如果是主账号，请确认已在短信服务控制台完成开通）';
  }
  if (/SIGNATURE|签名/i.test(s)) {
    return '（签名不对：ALIYUN_SMS_SIGN_NAME 要与控制台「签名管理」里的名称完全一致）';
  }
  if (/TEMPLATE_PARAMETER|PARAMETER_ILLEGAL|参数/i.test(s)) {
    return '（模板参数不匹配：ALIYUN_SMS_TEMPLATE_VARS 要和「模板内容」里的变量一一对应，个数也要一致）';
  }
  if (/TEMPLATE/i.test(s)) {
    return '（模板不对：ALIYUN_SMS_TEMPLATE_CODE 要与控制台「模板管理」里显示的一致）';
  }
  if (/AMOUNT|BALANCE|QUOTA|arrears|欠费|余额/i.test(s)) {
    return '（欠费或没买套餐：到短信服务控制台购买套餐包或充值）';
  }
  if (/MOBILE|PHONE/i.test(s)) {
    return '（手机号有问题：格式不对，或该号码不在测试签名的白名单里）';
  }
  if (/LIMIT|FREQUENCY/i.test(s)) {
    return '（触发频率限制：同一号码当天发送次数超限，等一会儿或换号码测试）';
  }
  return '';
}

// 阿里云短信走的是 RPC 风格接口：所有 Action 共用一套签名。
// 注意必须用 POST：阿里云这边接口只接受 POST，用 GET 调查询类接口会返回
// UnsupportedHTTPMethod。参数放在表单体里，签名算法是 HMAC-SHA1，
// 待签字符串为 POST&%2F&<再次编码后的规范化参数串>。
async function aliyunRpc(action, actionParams = {}, {
  endpoint = 'https://dysmsapi.aliyuncs.com/',
  version = '2017-05-25',
  smsHint = true,
} = {}) {
  const { accessKeyId, accessKeySecret, regionId } = config.aliyunSms;
  if (!accessKeyId || !accessKeySecret) {
    throw smsError('阿里云短信配置不完整，请检查 ALIYUN_SMS_ACCESS_KEY_ID / ALIYUN_SMS_ACCESS_KEY_SECRET');
  }
  const params = {
    AccessKeyId: accessKeyId,
    Action: action,
    Format: 'JSON',
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: '1.0',
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: version,
    ...actionParams,
  };
  // 短信接口才带 RegionId（公共参数，SDK 默认都带）；配成空则不发送。STS 没有这个参数
  if (smsHint && regionId) params.RegionId = regionId;
  const query = Object.keys(params).sort()
    .map((k) => `${aliEncode(k)}=${aliEncode(params[k])}`).join('&');
  const stringToSign = `POST&%2F&${aliEncode(query)}`;
  const signature = crypto.createHmac('sha1', `${accessKeySecret}&`)
    .update(stringToSign).digest('base64');
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `Signature=${aliEncode(signature)}&${query}`,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.Code !== 'OK') {
    const head = action === 'SendSms' ? '阿里云短信发送失败' : `阿里云接口 ${action} 调用失败`;
    const err = smsError(`${head}（${data?.Code || res.status}）：`
      + `${data?.Message || ''}${smsHint ? aliyunHint(data?.Code, data?.Message) : ''}`
      + `${data?.RequestId ? `（RequestId: ${data.RequestId}，报给阿里云技术支持时用得上）` : ''}`);
    err.aliyun = data;
    throw err;
  }
  return data;
}

// 这把 AccessKey 到底是"哪个账号的谁"。用于核对：
// 控制台里能看到赠送模板的那个账号，和 API 用的这个 Key，是不是同一个账号。
// 用的是 STS 的 GetCallerIdentity —— 任何有效凭证都能调用，只读、不产生费用。
export async function describeAliyunIdentity() {
  const data = await aliyunRpc('GetCallerIdentity', {}, {
    endpoint: 'https://sts.aliyuncs.com/',
    version: '2015-04-01',
    smsHint: false,
  });
  const arn = String(data.Arn || '');
  return {
    accountId: String(data.AccountId || ''),
    userId: String(data.UserId || ''),
    arn,
    isRamUser: arn.includes(':user/'),
  };
}

// 查这把 AccessKey 所在的账号里到底有哪些签名和模板。
// 「该账号下找不到对应模板」这类问题，一看这个列表就清楚：
// 列表里没有你配置的那个 → 说明这把 Key 和控制台里那个账号不是同一个。
export async function listAliyunSmsResources() {
  const signData = await aliyunRpc('QuerySmsSignList', { PageIndex: 1, PageSize: 50 });
  const tplData = await aliyunRpc('QuerySmsTemplateList', { PageIndex: 1, PageSize: 50 });
  const statusText = (v) => ({ 0: '审核中', 1: '审核通过', 2: '审核失败' }[Number(v)] || `状态${v}`);
  return {
    signs: (signData.SmsSignList || []).map((s) => ({
      name: s.SignName, status: statusText(s.SignStatus), reason: s.Reason || '',
    })),
    templates: (tplData.SmsTemplateList || []).map((t) => ({
      code: t.TemplateCode, name: t.TemplateName, status: statusText(t.TemplateStatus),
      content: t.TemplateContent || '', reason: t.Reason || '',
    })),
  };
}

async function sendAliyun(phone, code) {
  const { signName, templateCode } = config.aliyunSms;
  if (!signName || !templateCode) {
    throw smsError('阿里云短信配置不完整，请检查 ALIYUN_SMS_SIGN_NAME / ALIYUN_SMS_TEMPLATE_CODE');
  }
  // 模板参数必须和模板内容里的变量一一对应，多一个少一个阿里云都会报参数不合法。
  // 变量清单由 ALIYUN_SMS_TEMPLATE_VARS 配置（默认 code,min，对应赠送的登录/注册模板）。
  const minutes = String(Math.max(1, Math.round(config.smsCodeTtlSeconds / 60)));
  const wanted = String(config.aliyunSms.templateVars || 'code,min')
    .split(/[\s,，;；]+/)
    .map((s) => s.trim().replace(/^\$\{?|\}$/g, ''))
    .filter(Boolean);
  const templateParam = {};
  for (const name of (wanted.length ? wanted : ['code'])) {
    if (name === 'code') templateParam.code = code;
    else if (['min', 'mins', 'minute', 'minutes'].includes(name)) templateParam[name] = minutes;
    // 其它未知变量无法提供值：交给阿里云在返回里报错，比悄悄发一条内容不对的短信好
  }
  // 手机号参数名按官方 2017-05-25 接口定义用 PhoneNumbers（复数）。
  // 默认不再自己加 PhoneNumber（单数）——参数表里没有它，保持和官方一致；
  // 若你手上的文档写的是单数，把 ALIYUN_SMS_PHONE_PARAM 改成 PhoneNumber 或 both 即可。
  const phoneParam = String(config.aliyunSms.phoneParam || 'PhoneNumbers').trim();
  const phoneFields = phoneParam === 'both'
    ? { PhoneNumbers: phone, PhoneNumber: phone }
    : phoneParam === 'PhoneNumber'
      ? { PhoneNumber: phone }
      : { PhoneNumbers: phone };
  return aliyunRpc('SendSms', {
    ...phoneFields,
    SignName: signName,
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify(templateParam),
  }).then((data) => ({ provider: 'aliyun', requestId: data?.RequestId || '' }));
}

// ---------------- 自建/第三方 webhook ----------------
async function sendWebhook(phone, code) {
  if (!config.smsWebhookUrl) {
    throw smsError('未配置 SMS_WEBHOOK_URL');
  }
  const res = await fetch(config.smsWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.smsWebhookToken ? { Authorization: `Bearer ${config.smsWebhookToken}` } : {}),
    },
    body: JSON.stringify({ phone, code, ttl: config.smsCodeTtlSeconds }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw smsError(`短信网关返回 ${res.status}`);
  return { provider: 'webhook' };
}
