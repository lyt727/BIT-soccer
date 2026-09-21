# AI 识图评测集 · 标注与使用规范

配套脚本：[scripts/eval-ai.mjs](../eval-ai.mjs)。用于在投递前跑出**字段级准确率 / 识别有效率 / 拒识率**，产出可写进作品集的数字。

## 一、为什么做这套

当前 AI 为 demo 模式，没有真实评测数据（见 [docs/AI产品决策说明.md](../../docs/AI产品决策说明.md) §5）。接真实模型后，用一套**有标注答案的图片**做评测，才能把「AI 识别有效率 ≥80%」从 PRD 指标变成**实测数字**，也能找出 bad-case（手写/涂改/模糊）指导下一步用 OCR+LLM 混合方案。

## 二、三步跑起来

1. **接真实模型**：在 `server/.env` 配置
   ```bash
   AI_VISION_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
   AI_VISION_MODEL=qwen-vl-max
   AI_VISION_API_KEY=sk-你的key
   ```
   > 未配置时脚本会运行在 demo 模式并**明显告警**——此时数字不构成准确率论证，别拿去做作品集。
2. **建评测清单**：
   ```bash
   cp scripts/ai-eval/manifest.example.json scripts/ai-eval/manifest.json
   # 然后把样例图片放进 scripts/ai-eval/samples/，逐个把 image 路径指向真实文件，并按下方规范核对 expected
   ```
3. **跑**：
   ```bash
   node scripts/eval-ai.mjs                    # 读 manifest.json
   node scripts/eval-ai.mjs 自定义清单.json     # 或指定清单
   ```
   输出字段级准确率表格，并写入 `scripts/ai-eval/report-<时间>.json`。

## 三、图片与标注规范

- **数量**：起步 **20 张**，能到 50 张更好；太少数字没有说服力。
- **覆盖矩阵**（每类至少几张）：
  | 维度 | 需要覆盖 |
  |---|---|
  | 来源 | 打印表格 / 手写 / 打印+手写混填 |
  | 质量 | 清晰 / 轻度倾斜 / 反光 / 模糊 |
  | 内容 | 正常 / 缺漏项（某字段留空）/ 比分悬殊 / 有红牌与多次换人 |
- **ground truth 怎么标**：以「人类照着图能读出的唯一答案」为准，逐字段填 `expected`：
  - `startingA/B` 填首发姓名（顺序无所谓，脚本按集合比对）；
  - `goals/cards/substitutions` 只填图上**真实出现**的；球员姓名与图一致；
  - `referees` 只填图上有的字段，没有就删掉该键；
  - `teams` 数组 = 该场候选球队名单（让服务端按名单纠错，与实际调用一致）。
- **命名**：图片 `printed-01.jpg / handwritten-02.jpg …`，清单 `name` 写一句可读描述。

## 四、看结果时怎么解读

- **识别有效率** = 全字段正确样例 / 有效样例 —— 对表 PRD「≥80%」目标；
- **字段级准确率**：看哪个字段拖后腿（通常先挂的是手写名单姓名）；
- **拒识率**：模型主动「不敢认」的比例，是**可靠**而非失败——没有脏数据入库；
- **bad-case 归类**（建议整理进作品集一页）：把识别失败的图分成「手写难认 / 涂改 / 模糊 / 表格错位」等，能直接支撑你「下一步升级 OCR+LLM 混合」的路线图。

## 五、诚实使用提醒

- 数字必须来自 **真实模式（provider=vision）** 的实跑；demo 模式结果无效且截图会带「演示模式」水印。
- 报告 JSON 里记录了 provider 与模型，别在传播时删掉再当真实数据用——面试官会追问评测集构成，如实讲「20 张、覆盖……，字段级准确率……」即可。
