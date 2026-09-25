import { config } from '../config.js';

// =============================================================
// AI 裁判报告识图
// 裁判报告一次包含：双方首发/替补（号码+姓名）、比赛服颜色、
// 比分、进球、换人、红黄牌、裁判组 → 全部结构化输出。
// 注意：日期/时间/场地/工作人员/特殊情况说明不在裁判报告范围内，提示词不要求识别；
// 解析层仍兼容这些字段（若某份报告写了就带过来，没写就留空）。
// demo 模式离线演示；vision 模式调用 OpenAI 兼容视觉大模型。
// =============================================================

const SYSTEM_PROMPT = `你是一名专业的足球赛事裁判报告识图引擎。
用户上传的是裁判报告/比赛记录照片（可能多张、含手写）。裁判报告一次包含全部比赛信息，
请完整识别，禁止只挑一部分。
请严格按以下 JSON Schema 输出，不要输出 Markdown 解释：

【逐项核对清单：报告上写过的都要抄，一栏都别漏】
一张完整的裁判报告通常有下面这些栏目，请逐栏看一遍再输出：
 1. 双方队名、比赛服颜色（上衣/短裤/球袜；写在一起就连起来抄）；
 2. 比分（全场；若报告另写了半场比分，抄进 warnings 说明）；
 3. 主队首发名单：每人号码 + 姓名；
 4. 主队替补名单：每人号码 + 姓名；
 5. 客队首发名单：每人号码 + 姓名；
 6. 客队替补名单：每人号码 + 姓名；
 7. 进球：时间、球员、号码、是否点球；几个球就几条，不合并、不省略；
 8. 换人：时间、下场球员、上场球员；换了几次就几条；
 9. 红黄牌：时间、球员、号码、牌型；几张牌就几条；
10. 裁判组：主裁判、第一助理裁判、第二助理裁判、第四官员。


{
  "match": {
    "teamA": "主队名（对照候选球队纠错）",
    "teamB": "客队名",
    "kitColorA": "主队比赛服颜色，如 红白",
    "kitColorB": "客队比赛服颜色",
    "lineups": {
      "A": {
        "starting": [{"no": "1", "name": "姓名"}],
        "substitutes": [{"no": "12", "name": "姓名"}]
      },
      "B": {
        "starting": [{"no": "1", "name": "姓名"}],
        "substitutes": [{"no": "12", "name": "姓名"}]
      }
    },
    "scoreA": 0,
    "scoreB": 0,
    "goals": [
      {"team": "A（主队）或 B（客队）", "no": "10", "player": "姓名", "time": "23'", "penalty": false}
    ],
    "substitutions": [
      {"team": "A（主队）或 B（客队）", "offNo": "7", "offPlayer": "下场", "onNo": "17", "onPlayer": "上场", "time": "46'"}
    ],
    "cards": [
      {"team": "A（主队）或 B（客队）", "no": "5", "player": "姓名", "type": "yellow|red", "time": "33'"}
    ],
    "referees": {
      "main": "主裁判姓名",
      "assistant1": "第一助理裁判姓名",
      "assistant2": "第二助理裁判姓名",
      "fourth": "第四官员姓名"
    }
  },
  "confidence": {
    "overall": 0, "score": 0, "lineups": 0, "kit": 0,
    "goals": 0, "substitutions": 0, "cards": 0, "referees": 0
  },
  "warnings": ["低置信度/缺失字段逐条说明"]
}

规则：
- 号码与姓名成对识别；看不清号码时 confidence.lineups 必须低于 0.7 并写入 warnings；
- 颜色按报告实际描述提取，如“红白”“蓝黑”，不要按常识推测；
- 换人：offPlayer/offNo 为下场、onPlayer/onNo 为上场；
- 红黄牌：type 只能是 "yellow" 或 "red"（看到“黄牌/警告”写 yellow，看到“红牌/罚下”写 red）；
- 进球、换人、红黄牌里的 team：主队一律填 "A"，客队一律填 "B"；
- 时间照抄报告上的写法（如 33'、45+2'），不要换算、不要四舍五入；
- confidence.overall 低于 0.4 视为识别失败。

【某条记录缺字段时：保留整条，不要整条丢掉】
一条记录里只有个别字段看不清时，仍然要输出这一条，把看不清的字段留空，
并在 warnings 里写清楚是哪一条的哪个字段看不清。例如：
- 换人只写了下场球员、上场球员看不清 → 照样输出这条换人，onPlayer/onNo 留空；
- 红黄牌只写了球员、时间看不清 → 照样输出这条牌，time 留空；
- 进球的球员名字潦草 → 照样输出这条进球，player 留空；
- 名单里某一行号码看不清 → 照样输出这个人，no 留空。
只有整条记录完全看不出是什么（时间、人、事一样都没有）时，才可以不输出这一条。

【最重要的一条：只抄录，不补全】
裁判报告可能因填写不全而缺少内容，这是正常的。你的职责是如实抄录，不是把表格补完整。
没看到的东西一律留空，严禁用任何方式推测：

1. 留空规范：文本字段（队名 / 颜色 / 裁判姓名等）留空字符串 ""；
   名单、进球、换人、红黄牌等列表留空数组 []。
2. 以下行为一律禁止：
   - 用常识凑数（例如“足球首发应该是 11 人”，据此把名单补到 11 个）；
   - 用候选球队名单猜姓名（例如看到姓氏就补一个看起来可能的全名）；
   - 用其他比赛或其他球队的数据顶替；
   - 用“某队员”“未知”“待定”这类占位词冒充真实内容；
   - 比分看不清楚时凭空给一个数字。
3. 报告上整块缺失的内容（例如没有首发名单栏、没有裁判签字），
   一律返回空值，并在 warnings 中写明“报告未见 XXX”。
4. 对某个字段没有把握时，宁可留空并调低该项置信度，也不要填一个“看起来合理”的值。
   漏填可以靠人工补上，编造会直接造成赛事数据错误——留空的代价远小于写错。

如果某项内容报告上确实有、但你没能读清楚，请在 warnings 中写明具体是哪一项。`;

function similar(a, b) {
  const A = String(a).trim();
  const B = String(b).trim();
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (A.includes(B) || B.includes(A)) return 0.9;
  let hit = 0;
  for (const ch of B) if (A.includes(ch)) hit += 1;
  return hit / Math.max(A.length, B.length);
}

function matchTeam(raw, options) {
  if (!raw) return null;
  let best = null;
  let bestScore = 0.35;
  for (const opt of options) {
    const s = similar(raw, opt.name);
    if (s > bestScore) { bestScore = s; best = opt; }
  }
  return best;
}

function stripCodeFence(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return t;
}

function clampConfidence(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}

function parsePlayerEntry(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') {
    const name = String(raw.name || raw.player || '').trim();
    const no = String(raw.no ?? raw.number ?? '').trim();
    return name ? { no, name } : null;
  }
  const text = String(raw).trim();
  const m = /^(?:#?\s*)?(\d{1,3})[\s.、\-·]+(.+)$/.exec(text);
  if (m) return { no: m[1], name: m[2].trim() };
  return { no: '', name: text };
}

function parseLineupList(list) {
  if (!Array.isArray(list)) return [];
  return list.map(parsePlayerEntry).filter(Boolean);
}

function parseLineups(raw, teamAName, teamBName) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const a = r.A || r.teamA || {};
  const b = r.B || r.teamB || {};
  return {
    A: {
      color: String(r.kitColorA || r.colorA || '').trim(),
      starting: parseLineupList(a.starting),
      substitutes: parseLineupList(a.substitutes || a.bench),
    },
    B: {
      color: String(r.kitColorB || r.colorB || '').trim(),
      starting: parseLineupList(b.starting),
      substitutes: parseLineupList(b.substitutes || b.bench),
    },
  };
}

export async function recognizeMatch(images, context = {}) {
  if (!Array.isArray(images) || images.length === 0) {
    const err = new Error('请至少上传 1 张裁判报告图片');
    err.status = 400;
    throw err;
  }
  const teamOptions = context.teamOptions || [];
  const providerMode = config.aiProvider === 'demo'
    ? 'demo'
    : (config.aiVisionApiKey ? 'vision' : 'demo');
  const parsed = providerMode === 'vision'
    ? await callVisionModel(images, teamOptions)
    : await demoResult(teamOptions, context.scheduledPairs || []);
  const normalized = normalizeResult(parsed, teamOptions);
  normalized.meta = {
    provider: providerMode,
    engine: providerMode === 'vision' ? config.aiVisionModel : '内置演示识别（未配置视觉模型密钥）',
    recognizedAt: new Date().toISOString(),
  };
  return normalized;
}

async function demoResult(teamOptions, scheduledPairs) {
  if (config.aiSimulateDelayMs > 0) {
    await new Promise((r) => setTimeout(r, config.aiSimulateDelayMs));
  }
  const pair = scheduledPairs[0];
  const a = pair ? teamOptions.find((t) => t.id === pair.team_a_id) : teamOptions[0];
  const b = pair ? teamOptions.find((t) => t.id === pair.team_b_id) : teamOptions[1];
  const aName = a ? a.name : '信息与电子学院一队';
  const bName = b ? b.name : '机械与车辆学院一队';
  const AStart = ['王强', '李昂', '周航', '陈宇', '赵一鸣', '孙凯', '吴迪', '郑浩', '冯旭', '高原', '张磊'];
  const ABench = ['高翔', '马俊', '曹阳', '韩磊', '杨柳'];
  const BStart = ['李明', '马超', '许飞', '王伟', '何健', '罗成', '董磊', '谢天', '林峰', '郭锐', '宋阳'];
  const BBench = ['郑鹏', '万奇', '邱晨', '冯楠', '蒋涛'];
  const numbered = (arr, from) => arr.map((name, i) => ({ no: String(from + i), name }));
  return {
    match: {
      teamA: aName,
      teamB: bName,
      kitColorA: '红白',
      kitColorB: '蓝黑',
      lineups: {
        A: { starting: numbered(AStart, 1), substitutes: numbered(ABench, 12) },
        B: { starting: numbered(BStart, 1), substitutes: numbered(BBench, 12) },
      },
      scoreA: 2,
      scoreB: 1,
      goals: [
        { team: 'A', no: '10', player: '王强', time: "23'", penalty: false },
        { team: 'A', no: '9', player: '李昂', time: "41'", penalty: false },
        { team: 'B', no: '9', player: '李明', time: "67'", penalty: true },
      ],
      substitutions: [
        { team: aName, offNo: '7', offPlayer: '吴迪', onNo: '12', onPlayer: '高翔', time: "46'" },
        { team: bName, offNo: '10', offPlayer: '马超', onNo: '13', onPlayer: '万奇', time: "55'" },
      ],
      cards: [
        { team: bName, no: '5', player: '王伟', type: 'yellow', time: "33'" },
      ],
      referees: {
        main: '赵明', assistant1: '钱进', assistant2: '孙立', fourth: '周舟',
      },
    },
    confidence: {
      overall: 0.97, score: 0.99, lineups: 0.96, kit: 0.95,
      goals: 0.96, substitutions: 0.95, cards: 0.97, referees: 0.98,
    },
    warnings: ['演示模式：请上传真实裁判报告并配置视觉模型密钥后启用真实识图。'],
  };
}

async function callVisionModel(images, teamOptions) {
  const candidateText = teamOptions.length
    ? `候选球队（用于纠正同音/简写）：${teamOptions.map((t) => t.name).join('、')}`
    : '';
  const content = [
    { type: 'text', text: `请识别以下裁判报告。${candidateText}\n必须包含双方名单（号码+姓名）、比赛服颜色与全部时间轴事件，信息可多图互补。` },
    ...images.map((img, i) => ({
      type: 'image_url',
      image_url: { url: img.dataUrl, detail: 'high' },
    })),
  ];
  const res = await fetch(`${config.aiVisionBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.aiVisionApiKey}`,
    },
    body: JSON.stringify({
      model: config.aiVisionModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content },
      ],
      temperature: 0,
      max_tokens: 2200,
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    // 抽取服务商返回里人能看懂的那句话，而不是把整段 JSON 抛给操作人
    let reason = errText.slice(0, 300);
    try {
      const parsed = JSON.parse(errText);
      reason = parsed?.error?.message || parsed?.message || reason;
    } catch { /* 非 JSON，保持原文 */ }
    const err = new Error(
      `视觉模型调用失败（${res.status}）：${reason}${providerHint(reason)}`,
    );
    err.status = 502;
    err.code = 'AI_PROVIDER_ERROR';
    err.expose = true; // 运维类信息，直接显示给操作人，避免只能翻日志排查
    throw err;
  }
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content || '';
  try {
    return JSON.parse(stripCodeFence(raw));
  } catch {
    const err = new Error('视觉模型未返回合法结构化结果，请重试或改用人工录入'
      + '（若使用的是 OCR 专用模型，它通常不按 JSON 输出，建议换用通用视觉模型，'
      + '或改用「OCR 认字 + 文本模型转结构」的两段式方案）');
    err.status = 502;
    err.code = 'AI_PARSE_ERROR';
    err.expose = true;
    throw err;
  }
}

// 把常见的服务商报错翻译成可操作的提示
function providerHint(reason) {
  const s = String(reason || '');
  if (/model.*?(not exist|not found|does not exist)|ModelNotExist/i.test(s)) {
    return '（模型名不存在，请核对 AI_VISION_MODEL 与百炼控制台里的名称是否完全一致）';
  }
  if (/image (length and width|size)|image.*restriction/i.test(s)) {
    return '（图片尺寸不符合模型要求，请换成正常大小的照片）';
  }
  if (/api.?key|invalid.?key|authentication|Unauthorized/i.test(s)) {
    return '（API Key 无效或已过期，请检查 AI_VISION_API_KEY）';
  }
  if (/quota|balance|insufficient|arrears/i.test(s)) {
    return '（账户余额或额度不足，请到百炼控制台充值）';
  }
  return '';
}

// 报告上的日期/时间写法五花八门（2026年4月12日、2026/4/12、15点30分…），
// 统一成 <input type="date|time"> 能显示的格式；归一失败时把原文写进 warnings 交回人工，
// 不做静默丢弃。
function normalizeDate(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  const m = /(\d{4})\s*\D{1,3}\s*(\d{1,2})\s*\D{1,3}\s*(\d{1,2})/.exec(t);
  if (!m) return '';
  const [, y, mo, d] = m;
  const mm = Number(mo); const dd = Number(d);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';
  return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function normalizeTime(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  const m = /(\d{1,2})\s*[:：时点]\s*(\d{1,2})/.exec(t);
  if (!m) return '';
  const hh = Number(m[1]); const mi = Number(m[2]);
  if (hh > 23 || mi > 59) return '';
  return `${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

// 牌型：兼容 "red" / "red_card" / "红牌" / "黄牌" 等写法
function normalizeCardType(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  if (s.includes('red') || s.includes('红')) return 'red';
  if (s.includes('yellow') || s.includes('黄')) return 'yellow';
  return '';
}

export function normalizeResult(parsed, teamOptions) {
  const m = parsed?.match || {};
  const a = matchTeam(m.teamA, teamOptions);
  const b = matchTeam(m.teamB, teamOptions);
  if (!a || !b) {
    const err = new Error('识别失败：无法在候选球队中定位对阵双方，请改用人工录入');
    err.status = 422;
    err.code = 'AI_LOW_CONFIDENCE';
    throw err;
  }
  const resolveTeam = (raw) => {
    if (String(raw || '').trim() === 'A') return a.name;
    if (String(raw || '').trim() === 'B') return b.name;
    const matched = matchTeam(raw, [a, b]);
    return matched ? matched.name : String(raw || '').trim();
  };
  const rawLineups = m.lineups || {};
  // ---- 白名单校验：把识别出的球员对照该队报名名单 ----
  // 号码在同一队唯一，是最可靠的锚点；姓名只在完全一致时才认可，
  // 模糊匹配出的结果只作为提示，不自动替换，避免把两个相似姓名改错。
  const notes = [];
  // ---- 比赛信息（日期 / 时间 / 场地）与工作人员：报告上有就带过来，不有就留空 ----
  const rawDate = String(m.date || m.matchDate || '').trim();
  const rawTime = String(m.time || m.kickoff || '').trim();
  const date = normalizeDate(rawDate);
  const time = normalizeTime(rawTime);
  if (rawDate && !date) notes.push(`报告上的日期「${rawDate}」不是标准格式，未能自动填入日期框，请手动确认`);
  if (rawTime && !time) notes.push(`报告上的开球时间「${rawTime}」不是标准格式，未能自动填入时间框，请手动确认`);
  const venue = String(m.venue || m.place || '').trim().slice(0, 60);
  const specialNote = String(m.specialNote || m.special_note || '').trim().slice(0, 500);
  const rawStaff = (m.staff && typeof m.staff === 'object') ? m.staff : {};
  const staff = {
    supervisor: String(rawStaff.supervisor || '').trim(),
    photographer: String(rawStaff.photographer || '').trim(),
    videographer: String(rawStaff.videographer || '').trim(),
    commentator: String(rawStaff.commentator || '').trim(),
    reporter: String(rawStaff.reporter || '').trim(),
  };
  // a / b 是球队对象；resolveTeam 返回的是球队名，所以这里两者都接受
  const rosterOf = (key) => (teamOptions.find((t) => t.id === key || t.name === key) || {}).members || [];
  const digits = (v) => String(v ?? '').replace(/\D/g, '');
  const fixPlayer = (rawName, rawNo, roster) => {
    const name = String(rawName || '').trim();
    const no = digits(rawNo);
    if (!name || !roster || !roster.length) return { name, no };
    if (no) {
      const byNo = roster.filter((r) => digits(r.jerseyNo) === no);
      if (byNo.length === 1) {
        if (byNo[0].name !== name) {
          notes.push(`按 ${no} 号校正为报名名单中的「${byNo[0].name}」（原识别为「${name}」）`);
        }
        return { name: byNo[0].name, no };
      }
    }
    if (roster.some((r) => r.name === name)) return { name, no };
    let best = null;
    for (const r of roster) {
      const s = similar(name, r.name);
      if (!best || s > best.score) best = { name: r.name, score: s };
    }
    if (best && best.score >= 0.5) {
      notes.push(`「${name}」不在报名名单中，最接近的是「${best.name}」，请核实`);
    } else {
      notes.push(`「${name}」不在报名名单中，请核实`);
    }
    return { name, no };
  };
  const fixList = (list, roster) => list.map((p) => fixPlayer(p.name, p.no, roster));
  const lineups = {
    A: {
      color: String(m.kitColorA || rawLineups.kitColorA || '').trim(),
      starting: fixList(parseLineupList(rawLineups.A?.starting), rosterOf(a.id)),
      substitutes: fixList(parseLineupList(rawLineups.A?.substitutes), rosterOf(a.id)),
    },
    B: {
      color: String(m.kitColorB || rawLineups.kitColorB || '').trim(),
      starting: fixList(parseLineupList(rawLineups.B?.starting), rosterOf(b.id)),
      substitutes: fixList(parseLineupList(rawLineups.B?.substitutes), rosterOf(b.id)),
    },
  };
  // 进球：缺球员名也要保留（否则进球数会与比分对不上，等于把报告上的信息丢了）
  let goalsNoTeam = 0;
  let goalsNoPlayer = 0;
  const goals = (Array.isArray(m.goals) ? m.goals : []).slice(0, 20).map((g) => {
    // team 允许写 "A"/"B"，也允许写队名 —— 之前只认 A/B，写队名会被错记到主队
    const teamName = resolveTeam(g.team);
    if (!String(g.team || '').trim()) goalsNoTeam += 1;
    const side = teamName === b.name ? 'B' : 'A';
    const fixed = fixPlayer(g.player, g.no, rosterOf(side === 'B' ? b.id : a.id));
    if (!fixed.name) goalsNoPlayer += 1;
    return {
      side,
      no: fixed.no,
      player: fixed.name,
      time: String(g.time || '').trim(),
      penalty: Boolean(g.penalty),
    };
  }).filter((g) => g.player || g.no || g.time);
  if (goalsNoTeam) notes.push(`有 ${goalsNoTeam} 条进球没写是哪一队，已暂记在主队名下，请核对`);
  if (goalsNoPlayer) notes.push(`有 ${goalsNoPlayer} 条进球没能识别出球员姓名，已留空，请对照报告补齐`);
  // 按队分别比对进球条数与比分，对不上说明有进球漏抄或比分抄错，必须提示
  const goalCount = { A: 0, B: 0 };
  for (const g of goals) goalCount[g.side] += 1;
  const scoreOf = { A: Number(m.scoreA || 0), B: Number(m.scoreB || 0) };
  for (const side of ['A', 'B']) {
    if (goalCount[side] !== scoreOf[side]) {
      notes.push(`${side === 'A' ? '主队' : '客队'}识别到 ${goalCount[side]} 条进球记录，`
        + `比分是 ${scoreOf[side]}，两者对不上，请核对报告`);
    }
  }
  // 换人：只读到一半也保留（上场或下场缺一个就写进 warnings 提示补），不再整条丢掉
  let subsIncomplete = 0;
  const substitutions = (Array.isArray(m.substitutions) ? m.substitutions : [])
    .slice(0, 12).map((s) => {
      const teamName = resolveTeam(s.team);
      const roster = rosterOf(teamName);
      const off = fixPlayer(s.offPlayer, s.offNo, roster);
      const on = fixPlayer(s.onPlayer, s.onNo, roster);
      if (!off.name || !on.name) subsIncomplete += 1;
      return {
        team: teamName || a.name,
        offNo: off.no || null,
        offPlayer: off.name,
        onNo: on.no || null,
        onPlayer: on.name,
        time: String(s.time || '').trim(),
      };
    }).filter((s) => s.offPlayer || s.onPlayer || s.time);
  if (subsIncomplete) {
    notes.push(`有 ${subsIncomplete} 条换人只识别到一半（上场或下场缺一个），已保留记录，请对照报告补全后再保存`);
  }
  // 红黄牌：同样保留缺球员名/缺时间的记录；牌型兼容中英文写法
  let cardsNoType = 0;
  let cardsNoPlayer = 0;
  const cards = (Array.isArray(m.cards) ? m.cards : [])
    .slice(0, 20).map((c) => {
      const teamName = resolveTeam(c.team);
      const fixed = fixPlayer(c.player, c.no, rosterOf(teamName));
      const type = normalizeCardType(c.type);
      if (!type) cardsNoType += 1;
      if (!fixed.name) cardsNoPlayer += 1;
      return {
        team: teamName || a.name,
        no: fixed.no,
        player: fixed.name,
        type: type || 'yellow',
        time: String(c.time || '').trim(),
      };
    }).filter((c) => c.player || c.no || c.time);
  if (cardsNoType) notes.push(`有 ${cardsNoType} 张牌没能识别出牌型，已默认按黄牌，请核对`);
  if (cardsNoPlayer) notes.push(`有 ${cardsNoPlayer} 张牌没能识别出球员姓名，已留空，请对照报告补齐`);
  const conf = {
    overall: clampConfidence(parsed?.confidence?.overall ?? 0),
    score: clampConfidence(parsed?.confidence?.score ?? 0),
    lineups: clampConfidence(parsed?.confidence?.lineups ?? 0),
    kit: clampConfidence(parsed?.confidence?.kit ?? 0),
    goals: clampConfidence(parsed?.confidence?.goals ?? 0),
    substitutions: clampConfidence(parsed?.confidence?.substitutions ?? 0),
    cards: clampConfidence(parsed?.confidence?.cards ?? 0),
    referees: clampConfidence(parsed?.confidence?.referees ?? 0),
    info: clampConfidence(parsed?.confidence?.info ?? 0),
    staff: clampConfidence(parsed?.confidence?.staff ?? 0),
  };
  if (conf.overall < 0.4) {
    const err = new Error('识别失败：裁判报告整体置信度过低，请改用人工录入');
    err.status = 422;
    err.code = 'AI_LOW_CONFIDENCE';
    throw err;
  }
  return {
    match: {
      // 只回传球队标识，避免把整份名单带进接口响应
      registrationA: { id: a.id, name: a.name },
      registrationB: { id: b.id, name: b.name },
      scoreA: Number.isFinite(Number(m.scoreA)) ? Number(m.scoreA) : 0,
      scoreB: Number.isFinite(Number(m.scoreB)) ? Number(m.scoreB) : 0,
      date,
      time,
      venue,
      kitColorA: lineups.A.color,
      kitColorB: lineups.B.color,
      lineups,
      goals,
      substitutions,
      cards,
      staff,
      specialNote,
      referees: m.referees && typeof m.referees === 'object'
        ? {
          main: String(m.referees.main || '').trim(),
          assistant1: String(m.referees.assistant1 || '').trim(),
          assistant2: String(m.referees.assistant2 || '').trim(),
          fourth: String(m.referees.fourth || m.referees.fourth_official || '').trim(),
        }
        : { main: '', assistant1: '', assistant2: '', fourth: '' },
    },
    confidence: conf,
    warnings: [
      ...(Array.isArray(parsed?.warnings) ? parsed.warnings.map(String) : []),
      ...notes,
    ],
  };
}

export function getProviderStatus() {
  if (config.aiProvider === 'demo') {
    return { mode: 'demo', label: '演示识别（模拟）' };
  }
  if (config.aiVisionApiKey) {
    return { mode: 'vision', label: `视觉大模型：${config.aiVisionModel}` };
  }
  return { mode: 'demo', label: '演示识别（未配置密钥，自动降级）' };
}
