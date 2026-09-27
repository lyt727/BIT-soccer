// =============================================================
// AI 生成比赛战报
//
// 输入全部来自本系统已有的结构化数据（比分 / 进球 / 换人 / 红黄牌 /
// 双方名单 / 裁判组 / 赛事阶段），不依赖任何图片识别，所以：
//   · 便宜、快；
//   · 提示词里只有"给定事实"，模型没有机会编造场面描写。
// =============================================================
import { config } from '../config.js';

// 提示词：只有一条红线——只准用给的数据，不准补细节
const SYSTEM_PROMPT = `你是一名足球赛事的战报撰稿人。用户会给你一场比赛的结构化数据，
请据此写一段200–300字的中文战报。

硬性要求：
1. 只能使用下面给出的数据，不得添加任何数据里没有的信息；
2. 严禁编造场面描写与修饰（例如"精彩远射""球迷沸腾""带球突破"），
   也不要写天气、观众人数、补时、伤停这些数据里没有的内容；
3. 队名、场地、赛事名遵循数据里的写法即可；
4. **全文一律直接写球队名称，禁止出现"主队""客队"这两个词**；
   指的是哪支球队就写哪支球队的名字（例如"第 23 分钟 信息与电子学院一队 进球"）；
5. 数据缺失时如实回避：进球球员没登记就写"第 23 分钟 <球队名> 进球"，不要编名字；
6. 双方名单只供你核对人名，**不要罗列首发/替补名单**，也不要逐个念出场球员；
7. 篇幅200–300字，语句通顺，不要小标题、不要 Markdown、不要表情符号；
8. 严禁写需要其他比赛结果才能判断的结论，例如"首胜""提前出线""晋级""保级""锁定头名"
   —— 数据里没有这些信息，一律不写；结尾只需点明胜负或平局即可。

写作风格（在不违反上面硬性要求的前提下）：
1. 尽量用足球赛事的常用说法，让文字像一篇赛后稿，而不是把数据念一遍。
   例如：首开纪录、扩大领先优势、扳回一城、扳平比分、反超比分、梅开二度、
   锁定胜局、锦上添花、点球命中、十二码点、两黄变一红、被罚下场、易边再战、终场哨响。
2. 术语必须和数据对得上，宁可写得朴实也不能用错：
   · "梅开二度"要求同一名球员确实进了两球（进三球才叫"帽子戏法"）；
   · "扳平""反超"要看进球的时间先后，比分没被追平就不能写"扳平"；
   · 数据里看不出比赛是否读秒结束，就不要写"绝杀""读秒绝杀"；
   · 拿不准就用朴实的写法（如"再入一球""将比分改写为 2:0"）。
3. 句子之间用连接词自然衔接，例如"上半场…随后…易边再战…最终…"，
   不要每句都以"第 X 分钟"开头，也不要写成一条一条的数据罗列。
4. 可以按内容分成 2–3 段（如上半场、下半场、总结），但不要小标题、不要 Markdown。

只输出战报正文本身。`;

function lineupOf(raw) {
  try {
    const v = JSON.parse(raw || '{}');
    const players = (arr) => (Array.isArray(arr) ? arr : []).map((p) => (p.no ? `${p.no} 号 ${p.name}` : p.name));
    return { starting: players(v.starting), substitutes: players(v.substitutes) };
  } catch {
    return { starting: [], substitutes: [] };
  }
}

// 把这场比赛所有能用的信息收集起来（只用库里已有的，不猜）
export async function collectMatchFacts(db, match, event) {
  const nameOf = async (regId) => {
    const r = await db.get('SELECT team_name FROM registrations WHERE id = ?', [regId]);
    return r ? r.team_name : '未知球队';
  };
  const teamA = await nameOf(match.team_a_id);
  const teamB = await nameOf(match.team_b_id);
  const goals = await db.all(
    `SELECT side, player, player_no, goal_time, is_penalty FROM match_goals
      WHERE match_id = ? ORDER BY id`, [match.id],
  );
  const subs = await db.all(
    `SELECT team, off_player, on_player, off_no, on_no, sub_time FROM match_subs
      WHERE match_id = ? ORDER BY id`, [match.id],
  );
  const cards = await db.all(
    `SELECT team, player, player_no, card_type, card_time FROM match_cards
      WHERE match_id = ? ORDER BY id`, [match.id],
  );
  return {
    eventName: event?.name || '',
    eventFormat: event?.format || 'group_knockout',
    stage: match.stage === 'knockout'
      ? `淘汰赛${match.knockout_round ? `·${match.knockout_round}` : ''}`
      : (match.group_name ? `小组赛·${match.group_name} 组` : (match.round_name ? `联赛·${match.round_name}` : '')),
    date: match.match_date || '',
    venue: match.venue || '',
    teamA, teamB,
    scoreA: Number(match.score_a) || 0,
    scoreB: Number(match.score_b) || 0,
    goals: goals.map((g) => ({
      side: g.side === 'B' ? 'B' : 'A',
      team: g.side === 'B' ? teamB : teamA,
      no: g.player_no || '',
      player: g.player || '',
      time: g.goal_time || '',
      penalty: Boolean(g.is_penalty),
    })),
    substitutions: subs.map((s) => ({
      team: s.team || '',
      off: `${s.off_no ? `${s.off_no} 号 ` : ''}${s.off_player || ''}`.trim(),
      on: `${s.on_no ? `${s.on_no} 号 ` : ''}${s.on_player || ''}`.trim(),
      time: s.sub_time || '',
    })),
    cards: cards.map((c) => ({
      team: c.team || '',
      player: `${c.player_no ? `${c.player_no} 号 ` : ''}${c.player || ''}`.trim(),
      type: c.card_type === 'red' ? '红牌' : '黄牌',
      time: c.card_time || '',
    })),
    lineups: { A: lineupOf(match.lineup_a), B: lineupOf(match.lineup_b) },
    referees: [match.referee, match.assistant1, match.assistant2, match.fourth_official]
      .filter(Boolean),
  };
}

// ---------- 本地模板版（零成本、永不失败）----------
// 报告上的时间写法是 "23'" / "45+2'"，转成"第 23 分钟"读起来才顺
const minuteText = (t) => {
  const s = String(t || '').trim().replace(/['’′]\s*$/, '');
  return s ? `第 ${s} 分钟` : '';
};

export function renderTemplateReport(f) {
  const result = f.scoreA > f.scoreB ? `${f.teamA}取胜`
    : f.scoreA < f.scoreB ? `${f.teamB}取胜` : '双方战平';
  const parts = [`${f.teamA} ${f.scoreA}:${f.scoreB} ${f.teamB}，${result}。`];
  const goals = [...f.goals].sort((a, b) => (parseInt(a.time, 10) || 999) - (parseInt(b.time, 10) || 999));
  if (goals.length) {
    const text = goals.map((g) => [minuteText(g.time), `${g.no ? `${g.no} 号 ` : ''}`
      + `${g.player || '球员未登记'}`, `${g.penalty ? '点球' : ''}`, `（${g.team}）`]
      .filter(Boolean).join('')).join('；');
    parts.push(`进球：${text}。`);
  } else {
    parts.push('本场比赛双方均未取得进球。');
  }
  if (f.cards.length) {
    parts.push(`红黄牌：${f.cards.map((c) => [minuteText(c.time), c.team, c.player, c.type]
      .filter(Boolean).join('，')).join('；')}。`);
  }
  if (f.substitutions.length) {
    parts.push(`换人：${f.substitutions.map((s) => [minuteText(s.time), s.team,
      s.off ? `${s.off} 下场` : '', s.on ? `${s.on} 上场` : '']
      .filter(Boolean).join('，')).join('；')}。`);
  }
  return parts.join('');
}

function factsToText(f) {
  const lines = [
    `赛事：${f.eventName || '未填写'}${f.stage ? `（${f.stage}）` : ''}`,
    f.date || f.venue ? `时间地点：${[f.date, f.venue].filter(Boolean).join(' ')}` : '',
    // 不写"主队/客队"字样，避免模型直接抄进正文；直接给两个队名
    `对阵：${f.teamA} vs ${f.teamB}`,
    `比分：${f.teamA} ${f.scoreA} : ${f.scoreB} ${f.teamB}`,
    f.goals.length
      ? `进球：${f.goals.map((g) => `${g.time || '时间未登记'} ${g.no ? `${g.no} 号 ` : ''}`
        + `${g.player || '球员未登记'}${g.penalty ? '（点球）' : ''} ${g.team}`).join('；')}`
      : '进球：双方都没有进球',
    f.cards.length
      ? `红黄牌：${f.cards.map((c) => `${c.time || '时间未登记'} ${c.player} ${c.type}`).join('；')}`
      : '红黄牌：无',
    f.substitutions.length
      ? `换人：${f.substitutions.map((s) => `${s.time || '时间未登记'} ${s.team} ${s.off} 下 / ${s.on} 上`).join('；')}`
      : '换人：无',
    f.lineups.A.starting.length ? `${f.teamA}首发：${f.lineups.A.starting.join('、')}` : '',
    f.lineups.B.starting.length ? `${f.teamB}首发：${f.lineups.B.starting.join('、')}` : '',
    f.referees.length ? `裁判组：${f.referees.join('、')}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

// ---------- AI 版 ----------
// 兜底：万一模型还是写了"主队/客队"，机械替换成真实队名。
// 主队=teamA、客队=teamB 是我们在数据里定义死的，替换不会歧义。
function replaceSideWords(text, f) {
  return String(text || '')
    .replace(/主队/g, f.teamA)
    .replace(/客队/g, f.teamB);
}

async function callTextModel(f) {
  const res = await fetch(`${config.aiVisionBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.aiVisionApiKey}`,
    },
    body: JSON.stringify({
      model: config.aiTextModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `以下是这场比赛的数据，请据此写战报：\n${factsToText(f)}` },
      ],
      temperature: 0.3,
      max_tokens: 700,
    }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = data?.error?.message || data?.message || `HTTP ${res.status}`;
    throw new Error(`文本模型调用失败：${reason}`);
  }
  const text = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new Error('文本模型没有返回内容');
  return replaceSideWords(text, f);
}

export function aiTextEnabled() {
  if (config.aiProvider === 'demo') return false;
  return Boolean(config.aiVisionApiKey);
}

// 生成战报：能用 AI 就用 AI，否则退到本地模板；两种都失败时至少还有模板
export async function generateMatchReport(db, match, event) {
  const facts = await collectMatchFacts(db, match, event);
  if (aiTextEnabled()) {
    try {
      const text = await callTextModel(facts);
      return { text, source: 'ai', model: config.aiTextModel, facts };
    } catch (err) {
      return {
        text: renderTemplateReport(facts),
        source: 'template',
        fallbackReason: err.message,
        facts,
      };
    }
  }
  return { text: renderTemplateReport(facts), source: 'template', facts };
}
