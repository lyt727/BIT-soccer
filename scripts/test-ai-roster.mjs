// 白名单校验单元测试：号码校正、姓名相似提示、名单外球员提示
import { normalizeResult } from '../server/src/services/aiRecognition.js';

let pass = 0; let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS  ${name}${extra ? `  ${extra}` : ''}`); }
  else { fail += 1; console.log(`FAIL  ${name}${extra ? `  ${extra}` : ''}`); }
};

const teams = [
  {
    id: 'reg_A',
    name: '机械与车辆学院一队',
    members: [
      { name: '陈晨', jerseyNo: '1' },
      { name: '李磊', jerseyNo: '7' },
      { name: '王强', jerseyNo: '10' },
    ],
  },
  {
    id: 'reg_B',
    name: '光电学院一队',
    members: [
      { name: '赵敏', jerseyNo: '2' },
      { name: '孙浩', jerseyNo: '9' },
    ],
  },
];

const parsed = {
  match: {
    teamA: '机械与车辆学院一队',
    teamB: '光电学院一队',
    kitColorA: '红白', kitColorB: '蓝白',
    lineups: {
      A: {
        starting: [
          { no: '1', name: '陈晨' },      // 完全一致
          { no: '7', name: '李雷' },      // 号码对、姓名错字 → 按号码校正
          { no: '', name: '王强' },       // 无号码、姓名一致
        ],
        substitutes: [],
      },
      B: { starting: [{ no: '2', name: '赵敏' }], substitutes: [] },
    },
    scoreA: 2, scoreB: 1,
    goals: [
      { team: 'A', no: '10', player: '王强', time: "23'" },
      { team: 'B', no: '9', player: '孙浩', time: "45'" },
    ],
    substitutions: [
      { team: '机械与车辆学院一队', offNo: '10', offPlayer: '王强', onNo: '7', onPlayer: '李雷', time: "60'" },
    ],
    cards: [
      { team: '光电学院一队', no: '2', player: '赵敏', type: 'yellow', time: "44'" },
      { team: '机械与车辆学院一队', no: '', player: '张伟', type: 'red', time: "78'" }, // 名单外
    ],
    referees: { main: '赵明' },
  },
  confidence: { overall: 0.9, score: 0.9, lineups: 0.9, kit: 0.9, goals: 0.9, substitutions: 0.9, cards: 0.9, referees: 0.9 },
  warnings: [],
};

const out = normalizeResult(parsed, teams);
const w = out.warnings.join(' | ');
const lineup = out.match.lineups.A.starting;

ok('号码匹配：7 号自动校正为名单里的姓名',
  lineup.find((p) => p.no === '7')?.name === '李磊',
  `实际=${lineup.find((p) => p.no === '7')?.name}`);
ok('姓名一致的不改动', lineup.find((p) => p.no === '1')?.name === '陈晨');
ok('号码为空但姓名一致时保留', lineup.filter((p) => !p.no).some((p) => p.name === '王强'));
ok('换人里的错字同样被号码校正',
  out.match.substitutions[0]?.onPlayer === '李磊',
  `实际=${out.match.substitutions[0]?.onPlayer}`);
ok('名单外的球员进入 warnings 提示核实',
  w.includes('张伟') && w.includes('不在报名名单'), w.slice(0, 80));
ok('校正动作留有可追溯的说明',
  w.includes('按 7 号校正'), w.slice(0, 120));
ok('名单内的红黄牌不受影响',
  out.match.cards.find((c) => c.player === '赵敏')?.type === 'yellow');
ok('识别出的队名仍能匹配到报名球队',
  out.match.registrationA?.id === 'reg_A' && out.match.registrationB?.id === 'reg_B');
ok('接口响应里不带整份报名名单',
  out.match.registrationA?.members === undefined);

// 相似姓名提示（名单里有"李磊"，识别成"李雷"且没有号码可依据）
const parsed2 = JSON.parse(JSON.stringify(parsed));
parsed2.match.lineups.A.starting = [{ no: '', name: '李雷' }];
const out2 = normalizeResult(parsed2, teams);
ok('姓名错字且无号码时，提示最接近的候选人',
  out2.warnings.join(' ').includes('最接近的是「李磊」'), out2.warnings.join(' ').slice(0, 80));
ok('模糊匹配不自动改姓名（避免改错）',
  out2.match.lineups.A.starting[0].name === '李雷');

console.log(`\n共 ${pass + fail} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
