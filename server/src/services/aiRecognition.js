import { config } from '../config.js';

// =============================================================
// AI 裁判报告识图
// 裁判报告一次包含：双方首发/替补（号码+姓名）、比赛服颜色、
// 比分、进球、换人、红黄牌、裁判名单 → 全部结构化输出。
// demo 模式离线演示；vision 模式调用 OpenAI 兼容视觉大模型。
// =============================================================

const SYSTEM_PROMPT = `你是一名专业的足球赛事裁判报告识图引擎。
用户上传的是裁判报告/比赛记录照片（可能多张、含手写）。裁判报告一次包含全部比赛信息，
请完整识别，禁止只挑一部分。
请严格按以下 JSON Schema 输出，不要输出 Markdown 解释：

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
      {"team": "A|B", "no": "10", "player": "姓名", "time": "23'", "penalty": false}
    ],
    "substitutions": [
      {"team": "球队名", "offNo": "7", "offPlayer": "下场", "onNo": "17", "onPlayer": "上场", "time": "46'"}
    ],
    "cards": [
      {"team": "球队名", "no": "5", "player": "姓名", "type": "yellow|red", "time": "33'"}
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
- 颜色按报告实际描述提取，如“红白”“蓝黑”；
- 换人必须成对：offPlayer/offNo 为下场、onPlayer/onNo 为上场；
- 禁止臆造，模糊字段给空值并调低对应置信度；
- confidence.overall 低于 0.4 视为识别失败。`;

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
    const err = new Error(`视觉模型调用失败（${res.status}）：${errText.slice(0, 300)}`);
    err.status = 502;
    err.code = 'AI_PROVIDER_ERROR';
    throw err;
  }
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content || '';
  try {
    return JSON.parse(stripCodeFence(raw));
  } catch {
    const err = new Error('视觉模型未返回合法结构化结果，请重试或改用人工录入');
    err.status = 502;
    err.code = 'AI_PARSE_ERROR';
    throw err;
  }
}

function normalizeResult(parsed, teamOptions) {
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
  const lineups = {
    A: {
      color: String(m.kitColorA || rawLineups.kitColorA || '').trim(),
      starting: parseLineupList(rawLineups.A?.starting),
      substitutes: parseLineupList(rawLineups.A?.substitutes),
    },
    B: {
      color: String(m.kitColorB || rawLineups.kitColorB || '').trim(),
      starting: parseLineupList(rawLineups.B?.starting),
      substitutes: parseLineupList(rawLineups.B?.substitutes),
    },
  };
  const goals = (Array.isArray(m.goals) ? m.goals : []).slice(0, 20).map((g) => ({
    side: String(g.team || '').toUpperCase() === 'B' ? 'B' : 'A',
    no: String(g.no ?? '').trim(),
    player: String(g.player || '').trim(),
    time: String(g.time || '').trim(),
    penalty: Boolean(g.penalty),
  })).filter((g) => g.player);
  const substitutions = (Array.isArray(m.substitutions) ? m.substitutions : [])
    .slice(0, 12).map((s) => ({
      team: resolveTeam(s.team),
      offNo: String(s.offNo ?? '').trim(),
      offPlayer: String(s.offPlayer || '').trim(),
      onNo: String(s.onNo ?? '').trim(),
      onPlayer: String(s.onPlayer || '').trim(),
      time: String(s.time || '').trim(),
    })).filter((s) => s.offPlayer && s.onPlayer);
  const cards = (Array.isArray(m.cards) ? m.cards : [])
    .slice(0, 20).map((c) => ({
      team: resolveTeam(c.team),
      no: String(c.no ?? '').trim(),
      player: String(c.player || '').trim(),
      type: String(c.type || '').toLowerCase().startsWith('red') ? 'red' : 'yellow',
      time: String(c.time || '').trim(),
    })).filter((c) => c.player);
  const conf = {
    overall: clampConfidence(parsed?.confidence?.overall ?? 0),
    score: clampConfidence(parsed?.confidence?.score ?? 0),
    lineups: clampConfidence(parsed?.confidence?.lineups ?? 0),
    kit: clampConfidence(parsed?.confidence?.kit ?? 0),
    goals: clampConfidence(parsed?.confidence?.goals ?? 0),
    substitutions: clampConfidence(parsed?.confidence?.substitutions ?? 0),
    cards: clampConfidence(parsed?.confidence?.cards ?? 0),
    referees: clampConfidence(parsed?.confidence?.referees ?? 0),
  };
  if (conf.overall < 0.4) {
    const err = new Error('识别失败：裁判报告整体置信度过低，请改用人工录入');
    err.status = 422;
    err.code = 'AI_LOW_CONFIDENCE';
    throw err;
  }
  return {
    match: {
      registrationA: a,
      registrationB: b,
      scoreA: Number.isFinite(Number(m.scoreA)) ? Number(m.scoreA) : 0,
      scoreB: Number.isFinite(Number(m.scoreB)) ? Number(m.scoreB) : 0,
      kitColorA: lineups.A.color,
      kitColorB: lineups.B.color,
      lineups,
      goals,
      substitutions,
      cards,
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
    warnings: Array.isArray(parsed?.warnings) ? parsed.warnings.map(String) : [],
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
