# 本地 Postgres 部署与验证

> 面向：将来要在这台机器或云服务器上建库的人。
> 目标：把 `supabase/migrations/` 的 12 个 SQL 在**真实 Postgres** 上跑通并验证。

---

## 1. 环境现状（本机已验证）

| 项 | 值 |
|---|---|
| PostgreSQL | **17.6**（EDB 官方安装包） |
| 安装目录 | `D:\PostgreSQL\17` |
| 数据目录 | `D:\PostgreSQL\pgdata` |
| 端口 | `5432`（仅监听 `127.0.0.1`） |
| 超级用户 | `postgres` / 密码 `pgdev1234`（仅本地开发用） |
| 业务库 | `gongke`（UTF8） |
| 应用角色 | `app_user`（**非超级用户**，受 RLS 约束） |

> ⚠ 安装时 UAC 提权的坑：`Start-Process -Verb RunAs` 与 `-RedirectStandardOutput`
> 属于不同参数集，不能同时使用，否则报 `AmbiguousParameterSet`。
> 提权安装后安装器可能卡住不收尾，此时用 `pg_ctl` 手动启动即可。

---

## 2. 迁移文件顺序（重要）

```
00000000000000_pre_selfhost_auth.sql   ← 自托管兼容层（必须最先）
20261026000100_extensions_and_helpers.sql
20261026000200_dictionary_tables.sql
20261026000300_profiles.sql
20261026000310_role_helpers.sql        ← 角色函数（依赖 profiles，故在其后）
20261026000400_photos.sql
20261026000500_interactions.sql
20261026000600_comments.sql
20261026000700_articles.sql
20261026000800_rankings.sql
20261026000900_reports.sql
20261026001000_rls.sql
```

### 为什么需要 `00000000000000_pre_selfhost_auth.sql`

原迁移按 **Supabase** 编写，依赖三个专有对象：

| Supabase 专有 | 出现次数 | 兼容层如何替代 |
|---|---|---|
| `auth.users` 表 | 5 | 建 `auth.users` 最小表（id/email/meta/password_hash） |
| `auth.uid()` 函数 | 24 | 从会话变量 `app.user_id` 读取，未设置返回 `null` |
| `service_role` 角色 | 1 | 建同名 `nologin` 角色占位 |

### 为什么 `00310` 要单独拆出来

`current_role_name()` 与 `is_editor_or_admin()` 引用 `public.profiles`。
PostgreSQL 对 `language sql` 函数会在 **CREATE 时**校验函数体里的表引用，
若放在 `0001`（`profiles` 尚未创建）会报：

```
错误: 关系 "public.profiles" 不存在
```

这个错误**只有真跑才会暴露**——静态 SQL 校验查不出来。

---

## 3. 一键重建数据库

```powershell
$env:PGPASSWORD='pgdev1234'
$psql = 'D:\PostgreSQL\17\bin\psql.exe'

# 重建库
& $psql -h 127.0.0.1 -U postgres -d postgres -c "drop database if exists gongke;"
& $psql -h 127.0.0.1 -U postgres -d postgres -c "create database gongke encoding 'UTF8';"

# 按序执行全部迁移
Get-ChildItem 'supabase\migrations' -Filter '*.sql' | Sort-Object Name | ForEach-Object {
  Write-Host "--- $($_.Name) ---"
  & $psql -h 127.0.0.1 -U postgres -d gongke -v ON_ERROR_STOP=1 --single-transaction -f $_.FullName
  if ($LASTEXITCODE -ne 0) { Write-Host "FAILED" -ForegroundColor Red; break }
}
```

**实测结果：12/12 全部执行成功。**

---

## 4. 验证

### 4.1 结构完整性

```powershell
& $psql -h 127.0.0.1 -U postgres -d gongke -f supabase\verify-schema.sql
```

实测输出：

| 项 | 结果 |
|---|---|
| 表 | 11 张（article_topics / articles / categories / comments / favorites / likes / photos / profiles / reports / weekly_rank_entries / weekly_rank_snapshots） |
| 触发器 | 22 个 |
| RLS 开启 | **11/11 张表全部 `t`** |
| RLS 策略 | 28 条 |
| 分类种子 | 8 行 |
| 主题种子 | 4 行 |
| 辅助函数 | `current_role_name()` 返回 `anonymous`（匿名时） |

### 4.2 RLS 是否真的生效（关键）

```powershell
& $psql -h 127.0.0.1 -U postgres -d gongke -f supabase\test-rls.sql
```

**为什么必须用非超级用户测**：`postgres` 是 superuser，**永远绕过 RLS**。
第一版测试没建 `app_user` 角色，所有「越权成功」都是假象。
正确做法是 `SET ROLE app_user` 后再测。

实测结果：

| 场景 | 预期 | 实际 |
|---|---|---|
| 匿名只看已发布 | 1 条 | ✅ 1 条 |
| Bob 看不到 Alice 草稿 | 只见 published | ✅ |
| Bob 替 Alice 点赞 | 拒绝 | ✅ `违背表"likes"的行级安全策略` |
| Bob 给自己点赞 | 成功 | ✅ 计数由触发器更新为 1 |
| Bob 自提 admin | 拒绝 | ✅ `违背表"profiles"的行级安全策略`，角色仍 `user` |
| Bob 删 Alice 作品 | 拒绝 | ✅ `DELETE 0` |
| 软删评论对他人不可见 | Alice 1 / Bob 0 | ✅ 1 / 0 |
| 新用户自动建 profile | 是 | ✅ `alice`/`bob` 自动生成 |

### 4.3 业务函数

```sql
select * from public.compute_weekly_ranking(now() - interval '7 days', now() + interval '1 day', 'v1');
select * from public.reconcile_photo_counts();   -- 无输出 = 计数一致
```

---

## 5. 应用层如何使用（自托管鉴权约定）

每个请求前，把当前用户 id 写入会话变量：

```sql
set local app.user_id = '22222222-2222-2222-2222-222222222222';
```

- 未设置或为空 → `auth.uid()` 返回 `null` → RLS 按「未登录」处理
- 必须用 `SET LOCAL` 且**在事务内**，否则语句结束即失效
- 超级用户（`postgres`）不受约束，**生产环境务必用 `app_user` 之类普通角色连接**

---

## 6. 日常运维

```powershell
$pgctl = 'D:\PostgreSQL\17\bin\pg_ctl.exe'
$data  = 'D:\PostgreSQL\pgdata'

& $pgctl -D $data status                    # 状态
& $pgctl -D $data -l "$data\server.log" start   # 启动
& $pgctl -D $data stop -m fast              # 停止
```

日志：`D:\PostgreSQL\pgdata\server.log`

---

## 7. 待办（上云前要补的）

| # | 事项 | 说明 |
|---|---|---|
| 1 | 正式鉴权服务 | 当前 `app.user_id` 是骨架，需 Node API 管密码/令牌 |
| 2 | 密码哈希 | 本机仅验证 schema，`auth.users.password_hash` 尚未接入 bcrypt/argon2 |
| 3 | 连接池 | 生产需 PgBouncer 或应用侧连接池 |
| 4 | 备份策略 | 定时 `pg_dump` |
| 5 | 监听地址 | 现为 `127.0.0.1`；上云后需按需放开并配防火墙 |
| 6 | 密码管理 | `pgdev1234` 仅本地；生产必须换强密码 |
