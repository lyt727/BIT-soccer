# 绿茵BIT · API 接口文档（摘要）

所有接口前缀 `/api`，除登录外均需请求头 `Authorization: Bearer <token>`。

## 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /auth/login-password | 手机号 + 密码登录（**默认登录方式**）|
| POST | /auth/register | 手机号 + 姓名 + 密码注册（自动成为参赛球员）|
| POST | /auth/send-code | 发送短信验证码（scene: login/register；需配置短信通道）|
| POST | /auth/login-code | 手机号 + 验证码登录（短信通道的备选登录方式）|
| GET | /auth/me | 当前用户与能力 |

说明：

- 密码 6–64 位，服务端用 scrypt 加盐散列存储（Cloudflare 版为 PBKDF2-SHA256 / 10 万轮），任何接口都不返回 `password_hash`。
- 账号不存在与密码错误返回同一句提示，避免暴露手机号是否已注册。
- 登录失败会写审计日志（`auth.login_failed`），含来源 IP。
- 演示验证码只在非生产环境（未设置 `NODE_ENV=production`）回显；生产环境需配置真实短信通道，否则 `/auth/send-code` 返回 `SMS_NOT_CONFIGURED`。

## 用户与权限

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | /admin/users | user.view |
| POST | /admin/users | user.manage —— 可传 `password` 设初始密码，不传则自动生成并在响应里返回 |
| PATCH | /admin/users/:id | user.manage —— 可改角色 / 停用启用 / 传 `password` 重置密码 |
| GET | /audit | user.view |

## 赛事

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | /events | 列表 / 创建 |
| GET/PATCH/DELETE | /events/:id | 详情 / 编辑 / 删除（删除仅超管）|
| PATCH | /events/:id/status | 管理员任意切换赛事状态 |
| GET/POST/DELETE | /events/:id/staff | 赛事工作人员 |

## 报名

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /events/:id/registrations | 整队报名：members[] 每人 phone + 学生卡照片 |
| GET | /events/:id/registrations | 管理员看全量，其他人只读公开字段 |
| GET | /registrations/mine | 我的报名 |
| POST | /registrations/:id/review | approve / reject |
| PATCH | /registrations/:id | 报名中编辑整队名单（开赛后 REG_LOCKED）|
| GET | /files/:id | 材料文件（文件级权限）|

## 分组 / 赛程 / 统计

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | /events/:id/groups, /events/:id/draw | 分组 / 抽签 |
| GET/POST | /events/:id/matches | 赛程 |
| PATCH/DELETE | /matches/:id | 编辑 / 删除 |
| POST | /matches/:id/result | 比赛结果（含换人/红黄牌/裁判组）|
| GET | /events/:id/standings | 积分榜（实时计算）|
| GET | /events/:id/scorers | 射手榜（实时计算）|

## AI 识图

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | /ai/status | 认证用户 |
| POST | /ai/recognize | ai.recognize（需赛事指派，入口在赛程安排）|

`/ai/recognize` 请求示例：

```json
{
  "eventId": "evt_demo1",
  "images": [
    { "name": "裁判报告.jpg", "dataUrl": "data:image/jpeg;base64,..." }
  ]
}
```

返回结构化 `match`（对阵、双方首发/替补名单（号码+姓名）、比赛服颜色、比分、goals、substitutions、cards、referees）、`confidence`、`warnings`、`suggestedMatchId`。前端复核后调 `/matches/:id/result` 落库。

### 比赛技术统计

- 创建/编辑比赛时可提交 `lineupA` / `lineupB`：`{ "starting": ["球员1", ...], "substitutes": ["替补1", ...] }`；
- 查询比赛列表时每个比赛返回 `lineups`（双方首发/替补）与 `timeline`（进球/红黄牌/换人按时间排序），前端据此渲染“技术统计”弹窗。

## 错误格式

```json
{ "error": "没有权限执行该操作", "code": "FORBIDDEN" }
```

常见：`400` 参数校验、`401` 未登录/过期、`403` 无权限/未被指派、`404` 不存在、`422` AI 置信度过低。
