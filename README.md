# 绿茵BIT · 校园足球赛事管理系统

> 校园足球赛从报名到完赛都在这一个系统里完成；核心是 **AI 识图把裁判报告读成结构化数据，人只负责复核**，榜单与统计自动生成。

**线上地址**：https://bitsoccer.cn （阿里云中国香港，Docker + Caddy 自动 HTTPS）
**代码仓库**：https://github.com/lyt727/BIT-soccer

## 功能一览

- **账号与角色**：手机号 + 姓名 + 密码登录注册；管理员 / 数据录入员 / 参赛球员三级角色（权限为包含关系），管理员可按手机号认证同学的角色
- **球队报名**：任意角色都能创建球队或加入球队，一人一队（互斥），可随时取消；每队必报球衣上衣、短裤、球袜三色，每名成员提交姓名、手机号、学生卡照片、队内角色与号码；每队仅一名主教练、一名队长，同队号码不重复
- **赛制三选一**：单循环联赛 / 小组赛 + 单回合淘汰赛 / 纯淘汰赛；抽签决定分组或对阵（只有审核通过的球队参与），也可以不抽签、直接手动排赛
- **赛程安排**：淘汰赛轮次可选 1/8 决赛、1/4 决赛、半决赛、三四名决赛、决赛或自定义轮次；必填项只有比赛阶段、轮次、主客队
- **AI 识图**：上传裁判报告（一次最多 3 张 A4 照片），一次识别双方首发与替补（号码 + 姓名）、球衣三色、比分、进球、换人、红黄牌、裁判组；识别结果与报名名单做白名单校验，识别不到就留空、失败即转人工，不写脏数据
- **名单点选**：首发与替补从该队报名名单点选，临场标注队长 © 与守门员 🧤；每队上场人数（3–11 人）由管理员按赛制设置
- **AI 战报**：已完赛的比赛按数据生成 200–300 字战报，可人工编辑、可复制，每场限重新生成一次；正文不区分主客场，一律写球队名称
- **数据统计**：分组（A/B/C/D）或联赛积分榜、射手榜、红牌记录、黄牌记录；工作统计按角色统计裁判组与工作人员的工作场次
- **停赛台账**：红牌数与总黄牌数自动累计，状态与停赛场次由管理员在下拉列表里选定，执行停赛时自动清零累计黄牌
- **导出到 Excel**：赛程安排、数据统计、工作统计均可导出 `.xls`，Excel / WPS 直接打开
- **多端**：手机浏览器优先（安卓 / iOS / 鸿蒙实测可用），桌面端同样可用

## 技术架构

| 层 | 方案 |
|---|---|
| 前端 | 移动端优先的响应式 Web（PWA），原生 JS 模块化，无构建依赖 |
| 后端 | Node.js 22，零运行时依赖（自带路由与静态服务） |
| 数据库 | SQLite 单文件（线上使用）/ PostgreSQL（代码已支持双驱动） |
| 文件 | 学生卡照片存本地 `data/uploads/`，按文件级权限校验 |
| AI | 阿里云百炼 OpenAI 兼容接口：`qwen-vl-max` 识图 + `qwen-plus` 生成战报，模型与 Key 全在 `.env` |
| 部署 | Docker Compose + Caddy（自动申请并续期 HTTPS 证书） |

## 快速开始（本地）

要求 Node.js ≥ 22.5，无需 `npm install`。

```bash
node server/src/index.js        # 默认 http://localhost:3000
```

首次启动自动写入演示数据（15 支球队、A/B/C/D 四组、21 场小组赛 + 淘汰赛，每队 15 人）。

**演示账号**（密码统一 `123456`，登录页点卡片可直接填入）

| 手机号 | 姓名 | 角色 |
|---|---|---|
| 13900000001 | lby | 管理员 |
| 13900000003 | ljz | 数据录入员 |
| 13800138001 | zht | 参赛球员 |
| 13800138002 | clm | 参赛球员 |

> ⚠️ 站点一旦公网可访问，公开的演示密码等于把管理员权限给了所有人。正式使用前请在「成员与角色管理」里停用或重置演示账号，并把自己的手机号认证为管理员：
> `docker compose exec web node scripts/reset-password.mjs 你的手机号 你的强密码 admin 你的姓名`

## 部署到阿里云

线上即按此部署：阿里云中国香港节点，2 vCPU / 2 GiB 内存 / 40 GiB 系统盘，Ubuntu 22.04。选香港是为了**免备案**；大陆节点延迟更低但要先完成 ICP 备案。

服务器无需预装 Node、数据库或 Docker，部署脚本会自动安装。

```bash
git clone https://github.com/lyt727/BIT-soccer.git /root/greensinbit && cd /root/greensinbit
bash scripts/deploy-server.sh       # 装 Docker、生成密钥、启动服务
```

再到控制台放行端口，否则外网访问不到：

| 产品 | 操作路径 |
|---|---|
| 轻量应用服务器 | 「防火墙」→ 添加规则 → TCP `80`、`443` |
| ECS | 「安全组」→ 入方向 → 手动添加 → TCP `80/80`、`443/443` |

**绑定域名与 HTTPS**（已购域名 bitsoccer.cn）：DNS 加一条 A 记录指向服务器公网 IP，然后让容器回到 3000 端口、交给 Caddy 处理证书：

```bash
sed -i 's/^PUBLIC_PORT=.*/PUBLIC_PORT=3000/' .env
sed -i 's/^DOMAIN=.*/DOMAIN=bitsoccer.cn/' .env
docker compose --profile https up -d --build
```

## 日常运维

```bash
cd /root/greensinbit

bash scripts/update-server.sh        # 更新：先备份 → 拉代码 → 重建 → 健康检查
docker compose logs -f               # 查看日志
docker compose ps                    # 查看运行状态
node scripts/backup-db.mjs           # 备份数据库（一致性快照）+ 学生卡照片
node scripts/security-check.mjs      # 体检：默认密码、验证码模式、备份、照片目录
bash scripts/run.sh report           # 容器内跑功能测试（migration/security/backup/roles/sms/report/lineup）
```

> 服务器不需要装 Node：维护脚本可以用 `bash scripts/run.sh <名字>` 在容器里执行。

运行时数据（`.env` 与 `data/` 已在 `.gitignore`，`git pull` 不会覆盖）：

| 路径 | 内容 |
|---|---|
| `data/greensinbit.db` | SQLite 数据库（赛事、报名、比赛、统计）|
| `data/uploads/` | 学生卡照片等上传文件 |

## 测试

```bash
node scripts/smoke-test.mjs          # 88 项接口冒烟（需服务已启动）
node scripts/test-formats.mjs        # 39 项，三种赛制完整流程
node scripts/test-report.mjs         # 30 项，AI 战报（含提示词清洗单测）
node scripts/test-lineup.mjs         # 25 项，名单 / 队长 / 守门员 / 人数上限
node scripts/test-match-editor.mjs   # 24 项，统一数据编辑界面
node scripts/test-role-sync.mjs      # 15 项，按手机号认证角色
node scripts/test-migration.mjs      # 11 项，升级不动老数据
node scripts/reset-demo.mjs          # 重置演示数据
```

测试脚本内置安全闸（`scripts/safety.mjs`）：禁止以线上域名为目标运行。

## 文档

| 文档 | 内容 |
|---|---|
| [PRD V3](docs/PRD-V3.md) | 当前版本：AI 识图识别裁判报告、AI 生成战报、名单点选录入，正式进入使用阶段 |
| [PRD V2](docs/PRD-V2.md) | 上一版：三种赛制、红黄牌与停赛台账、工作统计、导出 Excel |
| [PRD V1](docs/PRD-V1.md) | 首版：报名、赛程、数据统计与权限框架 |
| [权限设计说明](docs/权限设计说明.md) | 角色矩阵、两级授权、成员认证 |
| [AI 识图技术方案](docs/AI识图技术方案.md) | 识别流程、白名单校验、模型接入 |
| [云数据库方案](docs/云数据库方案.md) | PostgreSQL DDL、RLS、迁移步骤 |
| [API 接口文档](docs/API接口文档.md) | 接口清单与示例 |
| [多端与前端方案](docs/多端与前端方案.md) | 安卓 / iOS / 鸿蒙适配 |
| [上线部署与短信](docs/上线部署与短信.md) | 域名、HTTPS、短信服务配置 |

## 说明

- 密码用 scrypt 加盐散列存储，接口不回传散列；管理员重置密码会立即失效旧密码。
- 短信验证码通道（腾讯云 / 阿里云 / webhook）代码完整，配置密钥即可启用；演示验证码只在非生产环境回显。
- 未配置视觉模型 Key 时走演示识图；配置百炼 Key 后自动切换为真实识别（`qwen-vl-max`）与战报生成（`qwen-plus`）。
- 演示数据中的学生卡为占位记录，不含实体图片；真实报名上传的照片会正常保存与展示。
