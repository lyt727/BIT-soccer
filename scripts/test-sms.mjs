// =============================================================
// 短信配置自检 / 真实发送测试
//
// 用法：
//   node scripts/test-sms.mjs                只检查配置，不发短信
//   node scripts/test-sms.mjs 13800000000    真发一条到指定手机号
//   服务器上：bash scripts/run.sh sms [手机号]
//
// 只发短信、不碰数据库，可以放心对线上跑。
// =============================================================
import crypto from 'node:crypto';
import { config } from '../server/src/config.js';
import { resolveSmsProvider, sendSmsCode } from '../server/src/services/sms.js';

const phone = String(process.argv[2] || '').trim();
const provider = resolveSmsProvider();

console.log('短信配置自检');
console.log(`  通道（SMS_MODE / SMS_PROVIDER）  ${provider}`);
console.log(`  验证码有效期                     ${config.smsCodeTtlSeconds} 秒`);

const mask = (v) => (v ? `${String(v).slice(0, 4)}****` : '（未配置）');

if (provider === 'aliyun') {
  const { accessKeyId, accessKeySecret, signName, templateCode, regionId } = config.aliyunSms;
  const missing = [
    ['ALIYUN_SMS_ACCESS_KEY_ID', accessKeyId],
    ['ALIYUN_SMS_ACCESS_KEY_SECRET', accessKeySecret],
    ['ALIYUN_SMS_SIGN_NAME', signName],
    ['ALIYUN_SMS_TEMPLATE_CODE', templateCode],
  ].filter(([, v]) => !v).map(([k]) => k);
  console.log(`  AccessKeyId                      ${mask(accessKeyId)}`);
  console.log(`  AccessKeySecret                  ${accessKeySecret ? '已配置' : '（未配置）'}`);
  console.log(`  签名名称 SIGN_NAME               ${signName || '（未配置）'}`);
  console.log(`  模板 CODE                        ${templateCode || '（未配置）'}`);
  console.log(`  接口地域 REGION_ID               ${regionId}（默认 cn-hangzhou，不用改）`);
  if (missing.length) {
    console.log(`\n缺少：${missing.join('、')}`);
    console.log('这两项要去阿里云短信控制台「申请」并等审核通过，不能自己随便填：');
    console.log('  签名：短信服务 → 国内消息 → 签名管理 → 添加签名');
    console.log('  模板：短信服务 → 国内消息 → 模板管理 → 添加模板（内容里要有 ${code}）');
    process.exit(1);
  }
  console.log('');
  console.log('提醒：模板里的变量必须和代码一致 —— 本系统只传 ${code} 这一个变量，');
  console.log('      所以模板内容只能出现 ${code}，不要再加 ${minute} 之类，否则会发送失败。');
} else if (provider === 'tencent') {
  const { secretId, secretKey, appId, signName, templateId } = config.tencentSms;
  const missing = [
    ['TENCENT_SMS_SECRET_ID', secretId], ['TENCENT_SMS_SECRET_KEY', secretKey],
    ['TENCENT_SMS_APP_ID', appId], ['TENCENT_SMS_SIGN_NAME', signName],
    ['TENCENT_SMS_TEMPLATE_ID', templateId],
  ].filter(([, v]) => !v).map(([k]) => k);
  console.log(`  签名名称                         ${signName || '（未配置）'}`);
  console.log(`  模板 ID                          ${templateId || '（未配置）'}`);
  if (missing.length) {
    console.log(`\n缺少：${missing.join('、')}`);
    process.exit(1);
  }
} else if (provider === 'webhook') {
  console.log(`  Webhook 地址                     ${config.smsWebhookUrl || '（未配置）'}`);
  if (!config.smsWebhookUrl) process.exit(1);
} else {
  console.log('\n当前是演示模式（验证码直接回显在接口里，不会真的发短信）。');
  console.log('正式上线要把 .env 改成 SMS_MODE=aliyun 并填好那几项，然后重启。');
  console.log('注意：生产环境（NODE_ENV=production）默认关闭演示验证码，');
  console.log('      所以在签名和模板审核通过之前，不要急着把 SMS_MODE 切过去。');
  process.exit(0);
}

if (!phone) {
  console.log('\n配置看起来齐全。想真发一条测试的话，加上手机号再跑一次：');
  console.log('  node scripts/test-sms.mjs 你的手机号');
  process.exit(0);
}
if (!/^1\d{10}$/.test(phone)) {
  console.error(`\n手机号格式不对：${phone}`);
  process.exit(1);
}

const code = String(crypto.randomInt(100000, 1000000));
console.log(`\n正在通过 ${provider} 发送验证码到 ${phone.slice(0, 3)}****${phone.slice(-4)} ...`);
try {
  const res = await sendSmsCode(phone, code);
  console.log(`发送成功：${JSON.stringify(res)}`);
  console.log(`（验证码是 ${code}，仅用于本次测试，不会写进数据库）`);
  console.log('收到短信就说明签名、模板、密钥都对了，可以把 SMS_MODE 切到生产使用了。');
} catch (err) {
  console.error(`发送失败：${err.message}`);
  console.error('');
  console.error('常见原因：');
  console.error('  · 签名或模板还在审核中 / 未通过 → 控制台「签名管理」「模板管理」看状态');
  console.error('  · 模板变量与代码不一致（本系统只传 ${code}）');
  console.error('  · 没买短信套餐包或账户余额不足 → 控制台充值 / 购买套餐');
  console.error('  · AccessKey 没有短信权限，或用了子账号但没授权');
  console.error('  · 手机号当天发送次数超限');
  process.exit(1);
}
