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

async function sendAliyun(phone, code) {
  const { accessKeyId, accessKeySecret, signName, templateCode, regionId } = config.aliyunSms;
  if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
    throw smsError('阿里云短信配置不完整，请检查 ALIYUN_SMS_* 环境变量');
  }
  const params = {
    AccessKeyId: accessKeyId,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: phone,
    RegionId: regionId,
    SignName: signName,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: '1.0',
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ code }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25',
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
    throw smsError(`阿里云短信发送失败：${data?.Message || res.status}`);
  }
  return { provider: 'aliyun', requestId: data?.RequestId || '' };
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
