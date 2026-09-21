# 绿茵BIT · API 接口文档（摘要）

所有接口前缀 `/api`，除登录外均需请求头 `Authorization: Bearer <token>`。

## 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /auth/send-code | 发送短信验证码（scene: login/register）|
| POST | /auth/login-code | 手机号 + 验证码登录 |
| POST | /auth/register | 手机号注册（自动成为参赛球员）|
| GET | /auth/me | 当前用户与能力 |

## 用户与权限

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | /admin/users | user.view |
| POST | /admin/users | user.manage |
| PATCH | /admin/users/:id | user.manage |
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
