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

// 阿里云短信走的是 RPC 风格接口：所有 Action 共用一套签名（GET + HMAC-SHA1）
async function aliyunRpc(action, actionParams = {}) {
  const { accessKeyId, accessKeySecret, regionId } = config.aliyunSms;
  if (!accessKeyId || !accessKeySecret) {
    throw smsError('阿里云短信配置不完整，请检查 ALIYUN_SMS_ACCESS_KEY_ID / ALIYUN_SMS_ACCESS_KEY_SECRET');
  }
  const params = {
    AccessKeyId: accessKeyId,
    Action: action,
    Format: 'JSON',
    RegionId: regionId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: '1.0',
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25',
    ...actionParams,
  };
  const query = Object.keys(params).sort()
    .map((k) => `${aliEncode(k)}=${aliEncode(params[k])}`).join('&');
  const stringToSign = `GET&%2F&${aliEncode(query)}`;
  const signature = crypto.createHmac('sha1', `${accessKeySecret}&`)
    .update(stringToSign).digest('base64');
  const url = `https://dysmsapi.aliyuncs.com/?Signature=${aliEncode(signature)}&${query}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.Code !== 'OK') {
    const head = action === 'SendSms' ? '阿里云短信发送失败' : `阿里云接口 ${action} 调用失败`;
    const err = smsError(`${head}（${data?.Code || res.status}）：`
      + `${data?.Message || ''}${aliyunHint(data?.Code, data?.Message)}`);
    err.aliyun = data;
    throw err;
  }
  return data;
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
  return aliyunRpc('SendSms', {
    PhoneNumbers: phone,
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
