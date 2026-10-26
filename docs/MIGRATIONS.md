# 数据库迁移说明（MIGRATIONS）

> 面向：将来在云服务器 / Supabase 上建库的人（很可能是三个月后的你自己）。
> 目标：把 `docs/DATA-MODEL.md` 的设计变成可执行的 SQL，并能一次重建。

---

## 1. 这是什么

`supabase/migrations/` 下是 **10 个按序执行的 SQL 文件**，把数据模型文档落成真实的 Postgres 库。

| 序号 | 文件 | 内容 |
|---|---|---|
| 0001 | `extensions_and_helpers.sql` | `citext` / `pg_trgm` 扩展、`updated_at` 触发器、角色判定函数 |
| 0002 | `dictionary_tables.sql` | `categories`(8) / `article_topics`(4) + 幂等种子 |
| 0003 | `profiles.sql` | 用户资料 + 新用户自动建档触发器 |
| 0004 | `photos.sql` | 作品 + 索引 + 标签规范化 + 发布时补 `published_at` |
| 0005 | `interactions.sql` | `likes` / `favorites` + **计数重算触发器** + 对账函数 |
| 0006 | `comments.sql` | 评论 + **禁止盖楼触发器** + 软删 + `comment_count` 重算 |
| 0007 | `articles.sql` | 教程文章 + `version` 自增 + 索引 |
| 0008 | `rankings.sql` | 榜单快照/条目 + `compute_weekly_ranking()` 计算函数 |
| 0009 | `reports.sql` | 举报（多态关联 + 防重复提交） |
| 0010 | `rls.sql` | **28 条行级安全策略**（全部表） |

累计：**11 张表、35 个索引、28 条 RLS 策略、16 个触发器、15 个函数**。

---

## 2. 三条设计原则（为什么这样写）

### 2.1 计数只读派生，由触发器重算

`photos.like_count / favorite_count / comment_count / view_count` **禁止应用层 +1/-1**。

原因很直接：并发点赞时 `+1` 会读到过期值，计数必然漂移。所以触发器在每次互动变动后
用 `count(*)` 重算权威值。

```sql
-- 0005 里的核心逻辑
update public.photos p
   set like_count = (select count(*) from public.likes where photo_id = target_photo)
 where p.id = target_photo;
```

配套提供了对账函数，随时可查是否漂移：

```sql
select * from public.reconcile_photo_counts();  -- 无输出 = 一致
```

### 2.2 业务规则尽量下沉到数据库

| 规则 | 实现位置 | 为什么不能只在前端 |
|---|---|---|
| 仅一级回复 | `enforce_single_level_reply` 触发器 | 直接调 API 可绕过前端校验 |
| 不能自提 role | `p_profiles_update` 策略 | 否则普通用户能把自己改成 admin |
| 只能改自己的作品 | `p_photos_update` 策略 | 前端改个 author_id 就能删别人照片 |
| 发布必须有时间 | `set_published_at` 触发器 | 应用层容易漏写 |
| 标签统一小写 | `normalize_photo_tags` 触发器 | 否则 `Landscape` 和 `landscape` 是两个标签 |
| 举报防刷 | `uq_reports_open_dedup` 唯一索引 | 应用层判重有竞态 |

### 2.3 榜单计算与前端逐字一致

`compute_weekly_ranking()` 的排序规则必须和 `src/domain/ranking.ts` 完全一样：

```
score DESC → favorite DESC → like DESC → published_at ASC → id ASC
自赞自藏不计（user_id <> photo.author_id）
窗口半开 [week_start, week_end)
```

**这是 D2 阶段「双跑比对」的前提**：同一周用两个适配器算，结果必须逐条相同。

> ⚠️ 教训：静态期 `data/mock/repositories/rankings.ts` 曾自己复制了一份周窗口计算，
> 与 `lib/time.ts` 的实现不一致（整整错一周），导致榜单分数全是 0。
> **同一规则只允许存在一份实现。**

---

## 3. 怎么执行

### 3.1 在 Supabase 托管版

1. 打开 Supabase 项目 → **SQL Editor**
2. 按 0001 → 0010 顺序，逐个文件粘贴执行
3. 或使用 CLI（推荐，可重复）：

```bash
supabase link --project-ref <your-ref>
supabase db push
```

### 3.2 在自建 Postgres（云服务器）

```bash
# 建库
createdb gongke

# 按序执行
for f in supabase/migrations/*.sql; do
  echo "==> $f"
  psql -d gongke -v ON_ERROR_STOP=1 -f "$f" || exit 1
done
```

`-v ON_ERROR_STOP=1` 很关键：默认 psql 遇错会继续跑，导致后面的错误被掩盖。

### 3.3 自托管 Supabase（Docker）

```bash
supabase start          # 起本地全套
supabase db reset       # 从 migrations 重建（幂等，可反复跑）
```

`db reset` 能一次重建是 D0 的验收标准之一。

---

## 4. 执行前自检

环境里若没有 Postgres，可以先跑结构校验：

```bash
python scripts/validate-migrations.py
```

检查项：括号配平、`$$` 成对、每表有主键、文件以分号结尾。

> 这只查**结构**。语义（外键可达性、RLS 逻辑、触发器行为）**必须在真实库上验证**。

---

## 5. 上线前必须验证的清单

按 ROADMAP D5 的 12 条越权用例，建完库后逐条测：

| # | 越权尝试 | 期望 |
|---|---|---|
| 1 | 未登录写入 photos | 被拒 |
| 2 | 用户 A 修改用户 B 的作品 | 被拒 |
| 3 | 用户 A 删除用户 B 的作品 | 被拒 |
| 4 | 普通用户把自己的 role 改成 admin | 被拒 |
| 5 | 替别人点赞（user_id 写别人） | 被拒 |
| 6 | 修改自己作品的 like_count | 被拒（计数由触发器维护） |
| 7 | 读取别人的草稿作品 | 被拒 |
| 8 | 未登录读取草稿 | 被拒 |
| 9 | 提交二级回复（parent 指向非顶层） | 被拒 |
| 10 | 同一举报重复提交 | 被唯一索引拦下 |
| 11 | 匿名读取他人举报 | 被拒 |
| 12 | 普通用户修改榜单快照 | 被拒 |

另外必查：

```sql
-- 计数一致性
select * from public.reconcile_photo_counts();

-- RLS 是否真的开启
select tablename, rowsecurity from pg_tables where schemaname = 'public';
```

---

## 6. 已知待补（后续阶段）

| 项 | 阶段 | 说明 |
|---|---|---|
| Storage 桶与策略 | D0 | 图片存 `photos/{authorId}/{photoId}/display.webp`，需配 RLS |
| `pg_cron` 周榜结算 | D4 | 定时调 `compute_weekly_ranking` 写入快照 |
| 全文检索索引 | D2 | `pg_trgm` 已启用，需加 GIN 索引与查询 |
| 旧数据导入脚本 | D3 | 从静态期导出的 JSON 灌入 |
| 举报审核后台 | 后续 | 表已就绪，缺 UI |
| `articles.related_photo_ids` 外键 | 后续 | 当前是 `text[]`，未做引用完整性 |

---

## 7. 与前端类型的一致性

DB 列用 `snake_case`，TS 用 `camelCase`，**转换只允许在 `mappers.ts` 里发生**。

字段必须与这两处逐字一致：

- `src/domain/types.ts`（TS 类型唯一事实源）
- `docs/DATA-MODEL.md` §3（字段表）

D0 的验收标准之一就是「domain 与 DB 字段差异为零」，建议写个脚本比对。

---

## 8. 变更规则

| 规则 | 说明 |
|---|---|
| 迁移文件只增不改 | 已执行的 `0001`~`0010` 永不修改；变更一律新增 `0011_xxx.sql` |
| 枚举值改动 | 必须同时改 `check` 约束、`domain/types.ts`、`DATA-MODEL.md` |
| 破坏性变更 | 先加新列 → 双写 → 回填 → 再删旧列，不要一步到位 |
| 每次改表 | 更新本文件与 `docs/DATA-MODEL.md` |
