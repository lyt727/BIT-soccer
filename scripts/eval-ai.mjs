#!/usr/bin/env node
// =============================================================
// 绿茵BIT · AI 识图 字段级准确率评测脚本
//
// 用途：对「已标注 ground-truth」的裁判报告图片集，调用真实视觉模型
//       （复用 server/src/services/aiRecognition.js 全链路），
//       计算字段级准确率 / 识别有效率 / 拒识率，产出可写入作品集的数字。
//
// 运行：
//   node scripts/eval-ai.mjs [评测清单.json]
//   默认读取 scripts/ai-eval/manifest.json（不存在则提示先 cp manifest.example.json manifest.json）
//
// 注意：
//   1. 必须先配置真实视觉模型（server/.env 填 AI_VISION_* 三件套），
//      否则 provider 会落到 demo 模式——跑出的"准确率"无意义，脚本会明显告警。
//   2. 清单示例见 scripts/ai-eval/manifest.example.json，标注规范见 scripts/ai-eval/README.md。
//   3. 评测文件图片未就绪时，该样例计为「样例失败（缺图）」，不计入字段分母。
// =============================================================
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---------- 简易 .env 加载（config.js 在 import 时读 env，故须先加载再动态 import） ----------
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const txt = readFileSync(path, 'utf8');
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvFile(resolve(__dirname, '../server/.env'));
loadEnvFile(resolve(ROOT, '.env'));

const { config } = await import('../server/src/config.js');
const { recognizeMatch } = await import('../server/src/services/aiRecognition.js');

// ---------- 工具 ----------
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const toDataUrl = (p) => {
  const buf = readFileSync(p);
  const mime = MIME[extname(p).toLowerCase()] || 'application/octet-stream';
  return { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, name: p.split(/[\\/]/).pop() };
};
const clean = (s) => String(s ?? '').trim();
const fuzzyEq = (a, b) => {
  const A = clean(a), B = clean(b);
  if (!A || !B) return false;
  if (A === B) return true;
  return A.includes(B) || B.includes(A);
};
const normSet = (arr) => new Set((arr || []).map((n) => clean(n)).filter(Boolean));
const setHit = (expectNames, gotArr) => {
  const got = normSet(gotArr.map((p) => p?.name));
  const exp = normSet(expectNames);
  let hit = 0;
  for (const n of exp) if (got.has(n)) hit += 1;
  return { hit, exp: exp.size };
};

// ---------- 字段比较 ----------
function compareCase(got, exp, teams) {
  const m = got?.match || {};
  const lineA = m?.lineups?.A || {};
  const lineB = m?.lineups?.B || {};
  const res = {};   // field -> {ok, hit?, exp?, note}
  const add = (k, ok, extra = {}) => { res[k] = { ok, ...extra }; };

  add('teamA', teams.some((t) => clean(t) === clean(exp.teamA)) && clean(m.registrationA?.name) === clean(exp.teamA)
    ? true : fuzzyEq(m.registrationA?.name, exp.teamA));
  add('teamB', fuzzyEq(m.registrationB?.name, exp.teamB));
  add('score', Number(m?.scoreA) === Number(exp.scoreA) && Number(m?.scoreB) === Number(exp.scoreB),
    { note: `${m?.scoreA}-${m?.scoreB}` });
  add('kit', fuzzyEq(m?.kitColorA, exp.kitColorA) && fuzzyEq(m?.kitColorB, exp.kitColorB),
    { note: `${m?.kitColorA || '?'} / ${m?.kitColorB || '?'}` });

  const sA = setHit(exp.startingA, lineA.starting);
  add('lineupA', sA.hit === sA.exp && sA.exp > 0, { hit: sA.hit, exp: sA.exp });
  const sB = setHit(exp.startingB, lineB.starting);
  add('lineupB', sB.hit === sB.exp && sB.exp > 0, { hit: sB.hit, exp: sB.exp });

  // 事件：进球 / 红黄牌 / 换人 —— 按「找到即中、多出为 extra」
  const goalsGot = (m?.goals || []).filter((g) => g.player);
  const goalsOk = (exp.goals || []).filter((g) =>
    goalsGot.some((p) => String(p.side).toUpperCase() === String(g.side).toUpperCase()
      && clean(p.player) === clean(g.player)));
  const goalsExtra = goalsGot.filter((p) =>
    !(exp.goals || []).some((g) => String(g.side).toUpperCase() === String(p.side).toUpperCase()
      && clean(p.player) === clean(g.player)));
  add('goals', goalsOk.length === (exp.goals || []).length && (exp.goals || []).length > 0,
    { hit: goalsOk.length, exp: (exp.goals || []).length, extra: goalsExtra.length });

  const cardsGot = (m?.cards || []).filter((c) => c.player);
  const cardsOk = (exp.cards || []).filter((c) =>
    cardsGot.some((p) => clean(p.player) === clean(c.player) && String(p.type) === String(c.type)));
  const cardsExtra = cardsGot.filter((p) =>
    !(exp.cards || []).some((c) => clean(c.player) === clean(p.player) && String(c.type) === String(p.type)));
  add('cards', cardsOk.length === (exp.cards || []).length && (exp.cards || []).length > 0,
    { hit: cardsOk.length, exp: (exp.cards || []).length, extra: cardsExtra.length });

  const subsGot = (m?.substitutions || []).filter((s) => s.offPlayer && s.onPlayer);
  const subsOk = (exp.substitutions || []).filter((s) =>
    subsGot.some((p) => clean(p.offPlayer) === clean(s.offPlayer) && clean(p.onPlayer) === clean(s.onPlayer)));
  add('subs', subsOk.length === (exp.substitutions || []).length && (exp.substitutions || []).length > 0,
    { hit: subsOk.length, exp: (exp.substitutions || []).length });

  const refGot = m?.referees || {};
  const refKeys = ['main', 'assistant1', 'assistant2', 'fourth'].filter((k) => clean(exp.referees?.[k]));
  const refHit = refKeys.filter((k) => fuzzyEq(refGot[k], exp.referees[k]));
  add('referees', refHit.length === refKeys.length && refKeys.length > 0, { hit: refHit.length, exp: refKeys.length });

  return res;
}

// ---------- 主流程 ----------
const manifestPath = process.argv[2] || resolve(__dirname, 'ai-eval/manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const teams = (manifest.teams || []).map((t) => (typeof t === 'string' ? { name: t } : t));
const samples = manifest.samples || [];

if (!samples.length) { console.error('清单里没有 samples，请先按 scripts/ai-eval/manifest.example.json 填写。'); process.exit(1); }

const isVision = config.aiProvider !== 'demo' && config.aiVisionApiKey;
console.log('='.repeat(64));
console.log(`评测清单：${manifestPath}`);
console.log(`样例数：${samples.length}    模型模式：${isVision ? '真实视觉模型 ' + config.aiVisionModel : '⚠️ demo 演示模式（结果不构成准确率论证）'}`);
if (!isVision) {
  console.log('>> 请先在 server/.env 配置 AI_VISION_BASE_URL / AI_VISION_MODEL / AI_VISION_API_KEY 后重跑。');
}
console.log('='.repeat(64));

const fieldTotals = {}; // 仅计入「图存在且未拒识」的样例
const rows = [];
let casePass = 0, caseCount = 0, refusal = 0, missing = 0;

for (let i = 0; i < samples.length; i += 1) {
  const s = samples[i];
  const imgPath = resolve(__dirname, s.image);
  if (!existsSync(imgPath)) { missing += 1; rows.push({ no: i + 1, name: s.name || s.image, err: '缺图' }); continue; }
  try {
    const images = [toDataUrl(imgPath)];
    const got = await recognizeMatch(images, { teamOptions: teams });
    const exp = s.expected;
    const fields = compareCase(got, exp, teams);
    caseCount += 1;
    const allOk = Object.values(fields).every((f) => f.ok);
    if (allOk) casePass += 1;
    const line = [`#${i + 1}`, got.meta.provider === 'vision' ? '真实' : 'demo'];
    for (const [k, v] of Object.entries(fields)) {
      fieldTotals[k] = fieldTotals[k] || { ok: 0, exp: 0 };
      fieldTotals[k].ok += v.ok ? 1 : 0;
      fieldTotals[k].exp += 1;
      line.push(`${k}${v.ok ? '✓' : '✗'}${v.hit != null ? `(${v.hit}/${v.exp})` : ''}${v.extra ? `+${v.extra}` : ''}`);
    }
    rows.push({ no: i + 1, name: s.name || s.image, ok: allOk, detail: line.join('  ') });
  } catch (err) {
    caseCount += 1;
    refusal += 1;
    rows.push({ no: i + 1, name: s.name || s.image, err: `拒识/失败(${err.code || err.status || '?'})` });
  }
}

// 输出
for (const r of rows) {
  if (r.detail) console.log(' ' + r.detail);
  else console.log(` #${r.no} ${r.name}  → ${r.err}`);
}

console.log('\n' + '-'.repeat(64));
const pct = (n, d) => (d ? (100 * n / d).toFixed(0) + '%' : '—');
console.log(`识别有效率（全字段正确样例）：${casePass}/${caseCount} = ${pct(casePass, caseCount)}`);
for (const [k, v] of Object.entries(fieldTotals)) {
  console.log(`  字段 ${k.padEnd(8)} ${v.ok}/${v.exp}  ${pct(v.ok, v.exp)}`);
}
console.log(`拒识率：${refusal}/${caseCount} = ${pct(refusal, caseCount)}；缺图（未纳入统计）${missing} 张`);

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const reportPath = resolve(__dirname, `ai-eval/report-${ts}.json`);
const report = {
  generatedAt: new Date().toISOString(),
  provider: isVision ? 'vision' : 'demo',
  model: config.aiVisionModel,
  caseCount, casePass,
  accuracy: Object.fromEntries(Object.entries(fieldTotals).map(([k, v]) => [k, v.exp ? +(100 * v.ok / v.exp).toFixed(1) : null])),
  rows,
};
writeJson(reportPath, report);
console.log(`\n报告已写入 ${reportPath}`);

function writeJson(p, o) {
  writeFileSync(p, JSON.stringify(o, null, 2), 'utf8');
}
