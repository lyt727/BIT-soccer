// =============================================================
// 短信配置自检 / 真实发送测试
//
// 用法：
//   node scripts/test-sms.mjs                检查配置 + 演练请求（都不发短信、不走网络）
//   node scripts/test-sms.mjs 13800000000    真发一条到指定手机号
//   node scripts/test-sms.mjs --list         列出这把 AccessKey 账号下的签名与模板
//   服务器上：bash scripts/run.sh sms [手机号]
//
// 只发短信、不碰数据库，可以放心对线上跑。
// =============================================================
import crypto from 'node:crypto';
// config.js 会自己先加载仓库根目录的 .env，这里直接读到的就是真实配置
import { config } from '../server/src/config.js';
import {
  resolveSmsProvider, sendSmsCode, listAliyunSmsResources, describeAliyunIdentity,
} from '../server/src/services/sms.js';

const phone = String(process.argv[2] || '').trim();
const provider = resolveSmsProvider();

// --list：把这把 AccessKey 所在的账号里有哪些签名/模板列出来
if (phone === '--list') {
  if (provider !== 'aliyun') {
    console.log(`当前通道是 ${provider}，只有阿里云支持这个查询。`);
    process.exit(0);
  }
  console.log('正在查询这把 AccessKey 账号下的签名与模板……\n');
  // 先确认这把 Key 属于哪个账号、哪个身份
  try {
    const id = await describeAliyunIdentity();
    console.log('这把 AccessKey 的身份：');
    console.log(`  账号 UID（AccountId） = ${id.accountId}`);
    console.log(`  身份类型              = ${id.isRamUser ? 'RAM 子用户' : '主账号'}`);
    console.log(`  ARN                   = ${id.arn}`);
    console.log('  → 请到「能看到赠送模板的那个控制台账号」右上角看账号 UID，和上面这个比对；');
    console.log('    不一致就说明这把 Key 不是那个账号的。\n');
  } catch (err) {
    console.log(`（身份查询失败：${err.message}）\n`);
  }
  try {
    const res = await listAliyunSmsResources();
    console.log(`签名（共 ${res.signs.length} 个）：`);
    if (!res.signs.length) console.log('  （一个都没有）');
    for (const s of res.signs) console.log(`  · ${s.name}  ${s.status}${s.reason ? `  ${s.reason}` : ''}`);
    console.log(`\n模板（共 ${res.templates.length} 个）：`);
    if (!res.templates.length) console.log('  （一个都没有）');
    for (const t of res.templates) {
      console.log(`  · ${t.code}  ${t.name}  ${t.status}`);
      if (t.content) console.log(`      内容：${t.content}`);
    }
    console.log('');
    const wantSign = config.aliyunSms.signName;
    const wantTpl = config.aliyunSms.templateCode;
    const hasSign = res.signs.some((s) => s.name === wantSign);
    const hasTpl = res.templates.some((t) => t.code === wantTpl);
    console.log(`对照你配置的：签名「${wantSign}」${hasSign ? '✅ 在这个账号里' : '❌ 不在此账号'}`);
    console.log(`              模板「${wantTpl}」${hasTpl ? '✅ 在这个账号里' : '❌ 不在此账号'}`);
    if (!hasSign || !hasTpl) {
      console.log('\n两种可能，按顺序排除：');
      console.log('  1) 这把 Key 和控制台里看到赠送模板的账号不是同一个');
      console.log('     → 比对上面的「账号 UID」和控制台右上角显示的账号 ID，不一致就换 Key');
      console.log('  2) 账号是对的，但赠送签名/模板不通过这个查询接口返回');
      console.log('     → 此时以实际发送结果为准：能发出去就说明没问题');
      console.log('     先跑一条真实发送：node scripts/test-sms.mjs 你的手机号');
      process.exit(1);
    }
  } catch (err) {
    console.error(`查询失败：${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

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
  console.log(`  模板变量 TEMPLATE_VARS           ${config.aliyunSms.templateVars}`
    + `（对应模板内容里的 ${config.aliyunSms.templateVars.split(/[\s,，]+/).filter(Boolean).map((v) => '${' + v + '}').join(' ')}）`);
  console.log(`  接口地域 REGION_ID               ${regionId}（默认 cn-hangzhou，不用改）`);
  if (missing.length) {
    console.log(`\n缺少：${missing.join('、')}`);
    console.log('这两项要去阿里云短信控制台「申请」并等审核通过，不能自己随便填：');
    console.log('  签名：短信服务 → 国内消息 → 签名管理 → 添加签名');
    console.log('  模板：短信服务 → 国内消息 → 模板管理 → 添加模板（内容里要有 ${code}）');
    process.exit(1);
  }
  console.log('');
  console.log('提醒：TEMPLATE_VARS 必须和控制台里「模板内容」的变量完全一致，');
  console.log('      例如模板写「验证码为${code}，${min}分钟内有效」→ 这里就要填 code,min。');
  console.log('      缺一个或多少一个，阿里云都会报参数不合法。');
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
  console.log('\n配置看起来齐全。');
}
if (phone && !/^1\d{10}$/.test(phone)) {
  console.error(`\n手机号格式不对：${phone}`);
  process.exit(1);
}

// ---- 请求演练：把发出去的请求原样抓下来看一眼（不需要网络，也不会真发短信）----
console.log('\n【请求演练】看看实际会发给阿里云什么（不联网、不发短信）');
{
  const realFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, opts = {}) => {
    captured = { url: String(url), opts };
    return { ok: true, status: 200, json: async () => ({ Code: 'OK', RequestId: 'dry-run' }) };
  };
  try {
    await sendSmsCode(phone || '13800000000', '123456');
  } catch (err) {
    console.log(`  演练失败：${err.message}`);
  } finally {
    globalThis.fetch = realFetch;
  }
  if (!captured) {
    console.log('  没有抓到请求（当前通道可能不需要 HTTP 调用）');
  } else {
    const url = new URL(captured.url);
    // 参数放在 POST 的表单体里；万一退回 GET，就从查询串里读
    const q = new URLSearchParams(captured.opts?.body || url.search);
    const show = (k, mask = false) => {
      const v = q.get(k);
      if (v === null) return;
      console.log(`  ${k.padEnd(16)} = ${mask && v ? '（已隐藏）' : v}`);
    };
    console.log(`  接口            = ${url.origin}${url.pathname}`);
    console.log(`  请求方法        = ${captured.opts?.method || 'GET'}`);
    console.log(`  Content-Type    = ${captured.opts?.headers?.['Content-Type'] || '（无）'}`);
    show('Action');
    show('PhoneNumbers');
    show('PhoneNumber');
    show('SignName');
    show('TemplateCode');
    show('TemplateParam');
    show('AccessKeyId', true);
    show('Signature', true);
    console.log('');
    console.log('  核对要点：');
    console.log('   · TemplateCode 必须和控制台「模板管理」里显示的一模一样');
    console.log('     （赠送模板常见为 100001 或 SMS_xxxxxxx，照抄即可）');
    console.log(`   · SignName 必须与${'“'}这个模板配套、且已审核通过${'”'}的签名完全一致`);
    console.log('   · TemplateParam 里的变量名必须与「模板内容」里的变量完全一致（个数也要一致）：');
    console.log('     模板写 ${code} + ${min} → 这里就要同时有 code 和 min；');
    console.log('     模板只有 ${code} → 把 ALIYUN_SMS_TEMPLATE_VARS 改成 code 即可。');
  }
}

if (!phone) {
  console.log('\n想真发一条测试的话，加上手机号再跑一次：');
  console.log('  node scripts/test-sms.mjs 你的手机号');
  process.exit(0);
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
  // 按错误类型只列相关的原因，避免每次刷一大串无关提示
  const msg = String(err.message || '');
  const list = /SIGNATURE/i.test(msg)
    ? [
      '这个账号里没有你配置的那个签名。到控制台「签名管理」看当前账号下有哪些签名，',
      '把 ALIYUN_SMS_SIGN_NAME 改成其中「审核通过」的那个（要一字不差）。',
      '如果控制台显示的是「恒创联众」这类赠送签名，说明你控制台登录的可能是另一个阿里云账号，',
      '此时要用那个账号的 AccessKey（比对下面自动排查里的账号 UID）。',
    ]
    : /TEMPLATE_PARAMETER|参数/i.test(msg)
      ? [
        '模板参数与「模板内容」里的变量对不上。',
        '把 ALIYUN_SMS_TEMPLATE_VARS 改成与模板内容完全一致（例如模板只有 ${code} 就填 code）。',
      ]
      : /TEMPLATE/i.test(msg)
        ? [
          '这个账号里没有你配置的那个模板 CODE。',
          '到控制台「模板管理」看当前账号下有哪些模板，把 ALIYUN_SMS_TEMPLATE_CODE 换成其中一个。',
        ]
        : /AMOUNT|BALANCE|QUOTA|欠费|余额/i.test(msg)
          ? ['账号没买套餐包或余额不足 → 控制台充值 / 购买短信套餐包。']
          : /forbidden|not authorized|RAM/i.test(msg)
            ? [
              'AccessKey 没有短信权限：RAM 控制台 → 用户 → 给这个账号授予 AliyunDysmsFullAccess。',
            ]
            : [
              '手机号不在测试签名的白名单里，或当天发送次数超限；也可能是签名/模板未通过审核。',
            ];
  console.error('');
  console.error('针对这个错误：');
  for (const line of list) console.error(`  · ${line}`);
  if (provider === 'aliyun') {
    console.error('');
    console.error('【自动排查】这把 AccessKey 账号下的签名与模板：');
    try {
      const id = await describeAliyunIdentity();
      console.error(`  身份：账号 UID ${id.accountId} · ${id.isRamUser ? 'RAM 子用户' : '主账号'}`);
      const res = await listAliyunSmsResources();
      const list = (arr, fmt) => (arr.length ? arr.map(fmt).join('、') : '（一个都没有）');
      console.error(`  签名：${list(res.signs, (s) => `${s.name}(${s.status})`)}`);
      console.error(`  模板：${list(res.templates, (t) => `${t.code}(${t.status})`)}`);
      const hasSign = res.signs.some((s) => s.name === config.aliyunSms.signName);
      const hasTpl = res.templates.some((t) => t.code === config.aliyunSms.templateCode);
      console.error(`  你配置的签名「${config.aliyunSms.signName}」${hasSign ? '在' : '不在'}这个账号；`
        + `模板「${config.aliyunSms.templateCode}」${hasTpl ? '在' : '不在'}这个账号`);
      if (!hasSign || !hasTpl) {
        console.error('  → 这把 Key 所属账号里查不到你配置的签名/模板。请核对：');
        console.error(`     上面这个账号 UID（${id.accountId}）是不是「能看到赠送模板的那个账号」；`);
        console.error('     不一致 → 换用那个账号的 AccessKey；');
        console.error('     一致但仍查不到 → 说明赠送签名/模板不通过这个查询接口返回，');
        console.error('                      以实际发送结果为准（能发出去就说明没问题）。');
      }
    } catch (e2) {
      console.error(`  （查询失败：${e2.message}）`);
    }
  }
  process.exit(1);
}
