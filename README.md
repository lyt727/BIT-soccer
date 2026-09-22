# 绿茵BIT · 校园足球赛事管理系统

> 把校园足球赛从报名到完赛收进一个系统；核心是 **AI 识图把裁判报告读成结构化数据，人只负责复核**，榜单和统计自动生成。

**线上地址（阿里云服务器）**：http://47.243.204.184
**线上地址（Cloudflare 免费版）**：https://bitsoccer.pages.dev

## 功能一览

- 手机号 + 验证码登录注册；管理员 / 数据录入员 / 参赛球员三级权限（权限为包含关系）
- 球队报名：创建球队、加入球队、取消报名；球衣三色、队内角色、球衣号码、学生卡逐人上报
- 每队仅一名主教练、一名队长，同队号码不重复，名单按角色和号码排序
- 报名审核、抽签分组、小组赛 + 单回合淘汰赛（1/8 决赛到决赛）
- 每场比赛技术统计：双方首发/替补、比赛服颜色、进球/换人/红黄牌时间轴、四人裁判组、比赛工作人员
- AI 识图：上传裁判报告，一次识别比分、进球、换人、红黄牌、裁判组、首发替补与比赛服颜色，人工复核后落库
- 数据统计：A/B/C/D 分组积分榜、射手榜、淘汰赛赛果；人员统计：裁判组与比赛工作人员工作场次
- 赛程、积分榜、射手榜、淘汰赛赛果、人员统计均可导出 Excel

## 技术架构

| 层 | 方案 |
|---|---|
| 前端 | 移动端优先的响应式 Web（PWA），原生 JS 模块化，无构建依赖 |
| 后端 | Node.js 22（零运行时依赖）；另有 Cloudflare Pages Functions 版本，同一套 `/api/*` 接口 |
| 数据库 | SQLite（本地 / 自建服务器）/ PostgreSQL（云）/ Cloudflare D1（免费版） |
| 文件 | 本地磁盘 / Cloudflare KV（学生卡照片） |
| AI | OpenAI 兼容视觉模型（qwen-vl / gpt-4o 等），未配置密钥时走演示模式 |
| 部署 | Docker + Docker Compose，一键脚本，可选自动申请 HTTPS 证书 |

## 快速开始（本地）

环境要求：Node.js ≥ 22.5，无需 `npm install`。

```bash
cd server
node src/index.js
```

浏览器打开 `http://localhost:3000`。首次启动自动写入演示数据（15 支球队、A/B/C/D 四组、24 场比赛）。

**演示账号（假验证码，点“获取验证码”自动填入）**

| 手机号 | 角色 |
|---|---|
| 13900000001 | 管理员 |
| 13900000003 | 数据录入员 |
| 13800138001 / 13800138002 | 参赛球员 |

## 部署到云服务器

当前线上环境即按以下步骤部署：阿里云中国香港节点，2 vCPU / 2 GiB 内存 / 40 GiB 系统盘，Ubuntu 22.04。

选香港节点是因为**免备案**，买完当天即可上线；中国大陆节点访问延迟更低，但要先完成 ICP 备案（约 2–3 周）。香港节点对北京用户的往返延迟约 40–50 ms，日常使用无感知。

**服务器无需预装 Node、数据库或 Docker**：Docker 镜像自带 Node 22，Docker 由部署脚本自动安装。

```bash
# 1. 拉取代码（root 身份执行）
git clone https://github.com/lyt727/BIT-soccer.git /root/greensinbit
cd /root/greensinbit

# 2. 一键部署：装 Docker、生成密钥、启动服务、首次启动写入演示数据
bash scripts/deploy-server.sh

# 3. 让服务直接监听 80 端口，访问链接可省略端口号
sed -i 's/^PUBLIC_PORT=.*/PUBLIC_PORT=80/' .env
docker compose up -d

# 4. 验证
curl -s http://127.0.0.1/api/health     # 期望 {"ok":true,...}
```

**还需在云控制台放行端口**，否则外网访问不到：

| 产品 | 操作路径 |
|---|---|
| 轻量应用服务器 | 「防火墙」→ 添加规则 → TCP / `80` / `0.0.0.0/0` |
| ECS | 「安全组」→ 入方向 → 手动添加 → TCP / `80/80` / `0.0.0.0/0` |

完成后浏览器访问 `http://<公网 IP>` 即可，手机同样可访问。

### 日常运维

```bash
cd /root/greensinbit

git pull && docker compose up -d --build              # 更新到最新代码
docker compose logs -f                                # 查看日志
docker compose ps                                     # 查看运行状态
cp data/greensinbit.db /root/backup-$(date +%F).db    # 备份数据库
```

运行时数据位置：

| 路径 | 内容 |
|---|---|
| `data/greensinbit.db` | SQLite 数据库（赛事、报名、比赛、统计）|
| `data/uploads/` | 学生卡照片等上传文件（首次上传时自动创建）|

`.env` 与 `data/` 已在 `.gitignore` 中，`git pull` 不会覆盖它们；容器设置了 `restart: unless-stopped`，服务器重启后服务自动拉起。

### 绑定域名与 HTTPS

有域名后把 `PUBLIC_PORT` 改回 `3000`，并在 `.env` 中填写 `DOMAIN=你的域名`，用 https profile 启动即可，Caddy 会自动申请并续期证书：

```bash
docker compose --profile https up -d --build
```

### 其他部署方式

- **Cloudflare 免费版**：Pages Functions + D1 + KV，零成本、不依赖本地电脑，固定链接 `https://bitsoccer.pages.dev`
- **真实短信、云数据库与域名配置**：见 [上线部署与短信](docs/上线部署与短信.md)

## 测试

```bash
node scripts/smoke-test.mjs   # 37 项接口冒烟测试（需服务已启动）
node scripts/reset-demo.mjs   # 重置演示数据
```

## 文档

| 文档 | 内容 |
|---|---|
| 绿茵BIT · 产品需求文档（PRD）.md | 精简版 PRD V3.0 |
| [权限设计](docs/权限设计说明.md) | 角色矩阵、两级授权、演示账号 |
| [AI 识图技术方案](docs/AI识图技术方案.md) | 识别流程、置信度、Provider 接入 |
| [云数据库方案](docs/云数据库方案.md) | PostgreSQL DDL、RLS、上线步骤 |
| [API 文档](docs/API接口文档.md) | 接口清单与示例 |
| [多端方案](docs/多端与前端方案.md) | Android / iOS / 鸿蒙适配 |

## 说明

- 演示环境使用假验证码与演示识图；配置腾讯云 / 阿里云短信与视觉模型密钥后可切换为真实能力，业务代码无需改动。
- 演示数据中的学生卡为占位记录，不含实体图片；真实报名上传的照片会正常保存与展示。
