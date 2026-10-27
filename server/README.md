# 工科影展 · 后端 API

> Fastify 5 + PostgreSQL 17.6 · 第 1 步：只读接口

---

## 1. 架构

```
浏览器 (React)
     │  HTTP
     ▼
┌─────────────────┐
│  Fastify API    │  ← 鉴权、RLS 上下文注入、连接池
│  :3001          │
└────────┬────────┘
         │ pg 协议（角色 app_user，非超级用户）
         ▼
┌─────────────────┐
│  PostgreSQL 17  │  ← 11 张表、22 触发器、28 条 RLS 策略
│  :5432          │
└─────────────────┘

图片：磁盘 E:\lst-测试图片 → 由 API 以静态资源服务（/images/）
```

**为什么必须有这一层**：前端在浏览器里运行，直连 Postgres 等于把数据库密码发给所有访客。

---

## 2. 安全模型（最关键，改动前务必理解）

### 2.1 用普通角色连接，不用 postgres

```bash
PGUSER=app_user        # ✅ 正确
PGUSER=postgres        # ❌ 危险：superuser 完全绕过 RLS
```

实测过：以 `postgres` 身份运行时，替他人点赞、把自己提成 admin **全部成功**。
RLS 只对普通角色生效。

健康检查接口会直接暴露这一点：

```json
{ "ok": true, "db": { "role": "app_user", "isSuperuser": false } }
```

**如果 `isSuperuser` 是 `true`，说明配置错了，所有 RLS 都形同虚设。**

### 2.2 每个请求在同一事务内注入用户身份

```ts
await client.query('begin')
await client.query("select set_config('app.user_id', $1, true)", [userId])
// ...业务查询...
await client.query('commit')
```

- 第三个参数 `true` = 事务级设置（等价 `SET LOCAL`）
- **必须包在事务里**：事务外调用只报 warning 然后无效，`auth.uid()` 返回 null
- 事务结束自动失效，不会污染连接池里的下个请求

### 2.3 禁止裸 pool.query

所有查询必须走 `withRls()` 或 `withAnonymous()`。裸用 `pool.query` 会丢掉 RLS 上下文，等于所有数据公开。

---

## 3. 启动

### 一键启动

```powershell
powershell -File server/start.ps1
```

脚本会依次：检查/启动数据库 → 检查图片目录 → 启动 API。

### 手动启动

```powershell
cd server
$env:PGUSER='app_user'
$env:PGPASSWORD='appdev1234'
$env:PGDATABASE='gongke'
$env:PORT='3001'
node node_modules/tsx/dist/cli.mjs src/index.ts
```

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PGHOST` | `127.0.0.1` | 数据库主机 |
| `PGPORT` | `5432` | 数据库端口 |
| `PGDATABASE` | `gongke` | 库名 |
| `PGUSER` | `app_user` | **必须是普通角色** |
| `PGPASSWORD` | — | 密码 |
| `PORT` | `3001` | API 端口 |
| `IMAGE_ROOT` | `E:\lst-测试图片` | 图片根目录 |

---

## 4. 接口清单（第 1 步）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查（含数据库角色） |
| GET | `/api/photos?sort=latest\|popular&categorySlug=&cursor=&limit=` | 作品列表（keyset 游标） |
| GET | `/api/photos/:id` | 作品详情 |
| GET | `/api/photos/:id/related` | 相关作品 |
| GET | `/api/categories` | 分类列表（8 个） |
| GET | `/api/categories/:slug` | 单个分类 |
| GET | `/api/articles` | 教程列表 |
| GET | `/api/articles/:slug` | 单篇文章 |
| GET | `/api/article-topics` | 教程主题（4 个） |
| GET | `/api/rankings/:isoWeek?kind=live\|final` | 周榜 |
| GET | `/api/rankings` | 有数据的周列表 |
| GET | `/images/*` | 图片静态资源 |

### 游标分页说明

`nextCursor` 是 base64url 编码的 JSON，内含完整排序键：

```json
{ "p": "2026-10-27T07:48:23.447Z", "i": "<uuid>" }         // latest
{ "s": 4, "p": "2026-10-27T...", "i": "<uuid>" }            // popular（多一个分数）
```

**踩过的坑**：`published_at` 从 pg 驱动拿到的是 `Date` 对象，
直接 `String(date)` 会得到 `"Tue Oct 27 2026 10:48:23 GMT+0800 (中国标准时间)"`，
PostgreSQL 无法解析，下一页直接 500。必须显式 `.toISOString()`。

---

## 5. 实测结果

### 接口连通

```
/api/health          200  role=app_user, isSuperuser=false
/api/categories      200  8 项
/api/article-topics  200  4 项
/api/articles        200  items=4,   total=4
/api/photos          200  items=20,  total=20
```

### 分页完整性

| 排序 | 页数 | 结果 |
|---|---|---|
| latest | 4 页（6+6+6+2） | 20 条，**无重复无遗漏** |
| popular | 4 页（5×4） | 20 条，分数降序正确 |

### 错误处理

| 场景 | 响应 |
|---|---|
| 不存在的作品 | `404 NOT_FOUND` |
| 非法 UUID | `400 VALIDATION` |
| RLS 拒绝 | `403 FORBIDDEN`（数据库 42501 翻译而来） |
| 唯一冲突 | `409 CONFLICT` |

### RLS 真实拦截（上一阶段验证）

| 场景 | 结果 |
|---|---|
| 匿名看草稿 | 看不到 |
| 替他人点赞 | 拒绝 |
| 自提 admin | 拒绝 |
| 删他人作品 | 无效 |

---

## 6. 目录结构

```
server/
├── src/
│   ├── index.ts              Fastify 主服务、错误处理、静态图片
│   ├── lib/
│   │   ├── db.ts             连接池 + RLS 上下文（核心）
│   │   ├── errors.ts         统一错误模型 + 数据库错误翻译
│   │   └── mappers.ts        数据库行 → 前端实体
│   ├── repositories/
│   │   ├── photos.ts         作品（keyset 分页）
│   │   ├── categories.ts     分类与主题
│   │   ├── articles.ts       教程
│   │   └── rankings.ts       周榜（实时 + 快照）
│   └── routes/index.ts       路由注册
├── package.json
├── tsconfig.json
└── start.ps1                 一键启动
```

---

## 7. 后续步骤

| 步骤 | 内容 | 状态 |
|---|---|---|
| **第 1 步** | 骨架 + 只读接口 | ✅ **已完成** |
| 第 2 步 | 鉴权 + 写入接口 | ⬜ 待做 |
| 第 3 步 | 图片上传 + 搜索 | ⬜ 待做 |

### 第 2 步要做的

- 注册 / 登录 / 登出
- 密码哈希（argon2id）
- JWT 签发与校验（替换当前 `userIdOf` 的占位实现）
- 手机验证码（表 `phone_verifications` 已就绪）
- 发布作品、点赞、收藏、评论（含 RLS 注入）

### 账号规则（已确认需求）

- 账号名**不限格式**（已放开到中英文，2–20 字符）
- 密码**不限格式**
- 绑定手机号（**不限格式**，4–20 位）
- 通过验证码找回密码
- 测试账号：`小何` / 密码 `1517862878` / 手机 `1517862878`

---

## 8. 数据库准备

```powershell
$env:PGPASSWORD='pgdev1234'
$psql='D:\PostgreSQL\17\bin\psql.exe'

# 按序执行迁移（12 + 2 个）
Get-ChildItem 'supabase\migrations' -Filter '*.sql' | Sort-Object Name | ForEach-Object {
  & $psql -h 127.0.0.1 -U postgres -d gongke -v ON_ERROR_STOP=1 --single-transaction -f $_.FullName
}

# 授权应用角色
& $psql -h 127.0.0.1 -U postgres -d gongke -f supabase\grant-app-role.sql

# 测试账号 + 演示数据
& $psql -h 127.0.0.1 -U postgres -d gongke -f supabase\seed-test-account.sql
& $psql -h 127.0.0.1 -U postgres -d gongke -f supabase\seed-demo.sql
```
