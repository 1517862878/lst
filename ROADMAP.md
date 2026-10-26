# 工科影展 · 开发计划表（ROADMAP）

| 项 | 内容 |
| --- | --- |
| 项目 | 工科影展（Gongke Photo Fair）——面向公众的摄影作品分享社区 |
| 文档版本 | v1.1 |
| 定稿日期 | 2026-10-26 |
| 当前状态 | 规划评审中；仓库尚无任何代码、脚手架与依赖 |
| 适用周期 | 第一期（纯静态前端）→ 第二期（动态站点） |
| 交付边界 | 本文件只含设计决策与计划，不含业务代码 |
| 维护规则 | 每个阶段验收后，回填「实际工时」与「偏差原因」，版本号 +0.1 |

**一句话战略**：第一期把「数据长什么样」和「怎么取数据」钉死，用本地实现跑通全部产品体验；第二期只替换数据层实现，**页面、组件、路由、类型零重写**。

---

## 0. 阅读约定

### 0.1 三条铁律

| 编号 | 铁律 | 违反后果 |
| --- | --- | --- |
| L-1 | **类型先行**：先写 `src/domain/types.ts`，再写仓储接口，最后才写 UI | 字段边写边改，第二期必然重写数据层 |
| L-2 | **组件不碰实现**：`pages/`、`features/` 只能 import `hooks/` 与 `domain/`，禁止 import `data/mock` 或 `data/supabase` | 换后端时全站改 import，迁移成本爆炸 |
| L-3 | **静态期不存在"临时字段"**：mock 数据的每个字段都必须是未来 Postgres 表里真实存在的列 | mock 模型与 schema 漂移，迁移时补字段、改表单、改组件 |

### 0.2 术语

| 术语 | 含义 |
| --- | --- |
| 作品 / Photo | 一次发布的影像条目，含图、地点、心得、分类、授权 |
| 互动 / Interaction | 点赞、收藏、评论三类行为的统称 |
| 快照 / Snapshot | 某一周排行榜的不可变结算结果（含公式版本号） |
| 适配器 / Adapter | 数据层的一种实现：静态期 `mock`，动态期 `supabase` |
| 契约测试 / Contract Test | 同一份用例同时跑在两套适配器上，保证行为一致 |
| DTO | 适配器与上层之间的数据传输对象，字段名与 domain 类型一致 |

### 0.3 静态期明确不做（Out of Scope）

真实服务端鉴权、真实文件上传、关注流、私信、站内通知、内容自动审核、付费/打赏、多语言、移动端 App、SSR/服务端渲染、评论盖楼（只做一级回复）。

---

## 1. 技术选型

### 1.1 选型原则

1. **换引擎不换车**：所有选择都要回答"第二期会不会导致重写"。
2. **单人可维护**：不引入需要专职运维的组件（K8s、自建 DB、消息队列一律不上）。
3. **可静态托管**：第一期产物必须是纯静态文件，能放 GitHub Pages。
4. **生态成熟**：文档、类型、社区案例充足，出问题能搜到答案。

### 1.2 静态期技术选型

| 层 | 选择 | 版本策略 | 为什么选它 | 第二期迁移影响 |
| --- | --- | --- | --- | --- |
| 语言 | TypeScript | 5.x，`strict: true` + `noUncheckedIndexedAccess` | 类型即 schema，是"零重写"的地基 | 无 |
| 构建 | Vite | 7.x | 秒级 HMR，产物为纯静态；不绑定任何部署商 | 无（仍是 SPA 构建器） |
| 框架 | React | 19.x | 生态最大、招聘/求助成本最低；并发特性利于图片墙 | 无 |
| 路由 | react-router | 7.x（data router） | 路由即数据边界，天然按路由做 code splitting | 无 |
| 样式 | Tailwind CSS | 4.x | 原子类 + 设计令牌，避免 CSS 命名腐化 | 无 |
| 组件基元 | Radix Primitives（按需） | 最新稳定 | 无样式、可访问性到位（弹层/菜单/Tabs 的键盘与 ARIA 已解决） | 无 |
| 服务端状态 | TanStack Query | 5.x | 缓存/失效/重试语义与真实后端一致，**迁移时 hooks 不改** | 无（关键收益） |
| 客户端状态 | Zustand | 5.x | 只装会话、UI 偏好；不把服务端数据塞进全局 store | 无 |
| 表单与校验 | react-hook-form + zod | 最新稳定 | zod schema 与类型同源，未来可直接映射 DB check 约束 | 无 |
| 本地持久化 | IndexedDB（`idb`，约 1KB）+ localStorage | — | IDB 存实体与图片 Blob（配额大），localStorage 只存会话/偏好/缓存键 | 数据导出后清空，键名保留 |
| Markdown（学习板块） | `marked` + `DOMPurify` | 最新稳定 | 文章先用 Markdown 文件，接口与未来的 DB 文章一致 | 文章移入 DB，渲染层不变 |
| 图标 | lucide-react | 最新稳定 | 体积小、风格统一、可 tree-shake | 无 |
| 测试 | Vitest + Testing Library + Playwright | 最新稳定 | 单测跑 domain/adapter，E2E 跑三条主链路 | 契约测试直接复用 |
| 规范 | ESLint 9（flat）+ Prettier | 最新稳定 | 统一风格，CI 拦截 | 无 |
| 部署 | GitHub Pages（Actions） | — | 零成本、与开源仓库同源 | 动态期换 Cloudflare Pages（SPA 重写更省事） |

**不引入**：UI 组件库（MUI/AntD，样式绑架重）、Redux（过重）、CSS-in-JS（运行时开销）、任何图表库（榜单用 CSS 进度条即可）。

### 1.3 动态期技术选型

| 层 | 选择 | 为什么选它 | 相对静态期的改动 |
| --- | --- | --- | --- |
| BaaS | **Supabase**（Postgres 15 + Auth + Storage + Realtime + Edge Functions + pg_cron） | 关系型 schema 与本地模型一一对应；RLS 可在数据库层做鉴权；SQL 能直接写周榜聚合；开源自托管可退路 | 只新增 `data/supabase/*` 适配器 |
| 数据库 | Postgres（Supabase 托管） | 聚合、窗口函数、`ON CONFLICT` 幂等、`pg_trgm` 中文检索 | 迁移 SQL 由 domain 类型反推 |
| 鉴权 | Supabase Auth（邮箱 + GitHub OAuth） | 免自建密码体系；JWT 可被 RLS 直接消费 | 替换 `AuthAdapter`，`RequireAuth` 不变 |
| 存储 | Supabase Storage（+ 图片变换） | 与 RLS 同一套权限；可生成缩略图 | 替换 `StorageAdapter`，键规则不变 |
| 实时 | Supabase Realtime（Postgres Changes） | 榜单/评论增量推送，无需自建 WS | 新增 `useRealtimeRanking` |
| 定时任务 | pg_cron + Edge Function | 周榜结算与每日快照，不依赖外部 cron 服务 | 新增 |
| 托管 | Cloudflare Pages | SPA 回退、边缘缓存、免费额度友好 | 改部署 workflow |
| 邮件 | Resend（事务邮件） | 注册验证/投诉回执 | 新增 |
| 监控 | Sentry（错误）+ Plausible（隐私友好统计） | 单人开发必须能"看见"线上错误 | 新增 |
| 类型同步 | `supabase gen types typescript` | DB 类型自动生成，避免手写漂移 | 仅用在 `mappers.ts` |

### 1.4 关键取舍（为什么不是别的）

| 备选 | 否决理由 |
| --- | --- |
| Next.js / SSR | 静态期收益≈0，却引入服务端运行时、部署形态与数据获取范式（RSC）变更；第二期若上 Supabase，SSR 仍需重做数据流。SEO 需求可用少数营销页预渲染解决 |
| Firebase | 文档模型 schema 弱，周榜的聚合/排序/快照在 NoSQL 上要写大量客户端代码；RLS 等价能力弱；迁移成本高 |
| Appwrite / 自建 Postgres + Node | 单人开发要自己管备份、升级、TLS、监控；与"每周 12 小时"的投入假设冲突 |
| 直接写死 JSON 页面 | 无法支撑互动与榜单，第二期等于重做 |
| 第一期就上 Supabase | 与"只交付静态前端"的硬约束冲突，且会把产品验证拖进 schema 反复改动 |

### 1.5 核心架构决策：数据访问层抽象

```
┌──────────────────────────────────────────────────────────┐
│ pages/  features/          ← 只认 hooks 与 domain 类型     │
├──────────────────────────────────────────────────────────┤
│ hooks/ (TanStack Query)    ← 缓存、失效、乐观更新、错误态    │
├──────────────────────────────────────────────────────────┤
│ services/                  ← 业务规则：权限、榜单公式、校验   │
├──────────────────────────────────────────────────────────┤
│ data/contracts/            ← 仓储接口 + DTO（唯一真相）      │
├───────────────────────────┬──────────────────────────────┤
│ data/mock/  (静态期)       │ data/supabase/  (动态期)       │
│ IndexedDB + localStorage  │ Postgres + Auth + Storage     │
└───────────────────────────┴──────────────────────────────┘
                     ↑ 由 data/index.ts 按环境变量选择
```

**接口契约**（文档内定义，落地时进入 `src/data/contracts/`）：

```ts
// 分页统一用游标，永不使用 page/offset —— 两期共用同一协议
type Page<T> = { items: T[]; nextCursor: string | null };
type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };

interface PhotoRepository {
  list(q: PhotoQuery): Promise<Page<PhotoSummary>>;          // 作品墙 / 分类
  get(id: string): Promise<Photo | null>;                   // 详情
  create(input: PhotoDraft): Promise<Result<Photo>>;        // 发布
  update(id: string, patch: Partial<PhotoDraft>): Promise<Result<Photo>>;
  remove(id: string): Promise<Result<void>>;
}
interface InteractionRepository {
  toggleLike(photoId: string): Promise<Result<LikeState>>;
  toggleFavorite(photoId: string): Promise<Result<FavoriteState>>;
  listComments(photoId: string, cursor?: string): Promise<Page<Comment>>;
  addComment(photoId: string, body: string, parentId?: string): Promise<Result<Comment>>;
}
interface RankingRepository {
  getWeekly(isoWeek: string, kind: 'live' | 'final'): Promise<WeeklyRanking>;
}
interface AuthAdapter {
  signIn(email: string, password: string): Promise<Result<Session>>;
  signUp(input: SignUpInput): Promise<Result<Session>>;
  signOut(): Promise<void>;
  getSession(): Promise<Session | null>;
  onChange(cb: (s: Session | null) => void): () => void;
}
interface StorageAdapter {
  put(file: Blob, meta: { ownerId: string; kind: 'photo' | 'avatar' }): Promise<StorageRef>;
  url(ref: StorageRef, variant: 'thumb' | 'display'): string;
  remove(ref: StorageRef): Promise<void>;
}
```

**决策清单**：

| 编号 | 决策 | 理由 | 代价 |
| --- | --- | --- | --- |
| D-01 | 数据层用「仓储接口 + 双适配器」，环境变量 `VITE_DATA_SOURCE=mock\|supabase` 切换 | 唯一能同时满足"纯静态"与"零重写"的结构 | 多写一层接口与映射（约 15% 前期成本） |
| D-02 | 分页统一游标协议，客户端不解析游标只回传 | offset 在数据增长后会重复/漏项；两期语义必须一致 | 无法直接跳页（产品上不需要） |
| D-03 | ID 全部用 UUID v4，**客户端生成**（`crypto.randomUUID()`） | 离线创建不冲突；迁移到 `uuid` 列零改造 | URL 较长，需展示短码 |
| D-04 | 时间一律 ISO-8601 UTC 字符串，禁用本地时区字符串 | 周榜跨时区计算的前提 | 展示层需统一格式化 |
| D-05 | 计数（赞/藏/评论）是**只读派生字段**，前端永不自己 `+1` 持久化 | 静态期由 mock 计算，动态期由触发器计算，前端逻辑不变 | 需要乐观更新 + 回滚 |
| D-06 | DB 用 snake_case，TS 用 camelCase，映射只在 `mappers.ts` | 隔离 schema 变更；避免把 SQL 风格带进组件 | 每个实体一个映射函数 |
| D-07 | domain 类型手写并定稿，**不从 DB 反向生成** | 生成的类型会把 DB 细节（如可空性抖动）污染到 UI | DB 变更需人工同步 domain（有校验测试兜底） |
| D-08 | 校验用 zod schema 与类型同源（`z.infer`） | 一份规则同时服务表单、mock、未来 DB check | 无 |
| D-09 | 图片以 `StorageRef{ key }` 表示，URL 由适配器按需生成 | 静态期是 IndexedDB key，动态期是 Storage path，UI 只认 key | 需注意对象 URL 释放 |
| D-10 | 搜索/榜单/列表的**查询参数对象**在两期完全一致 | 契约测试可复用，页面不用改 | 静态期要做参数到内存过滤的翻译 |
| D-11 | 保留 `schemaVersion` 与数据导出/导入（JSON） | 静态期用户数据是唯一副本，也是迁移到 Supabase 的来源 | 需要写迁移脚本（一次性） |
| D-12 | 不做 SSR；SEO 依赖静态 `title/description` + 少数预渲染页 + `sitemap.xml` | 站点主体是登录后互动，SEO 权重低 | 详情页分享卡片靠 OG 静态兜底（V2 可上边缘函数） |

### 1.6 类型先行策略

| 步骤 | 产物 | 门禁 |
| --- | --- | --- |
| 1 | `domain/types.ts`：全部实体与枚举 | 评审通过才允许写 UI |
| 2 | `domain/schemas.ts`：zod schema（与类型同源） | 类型与 schema 的单测（样例数据往返校验） |
| 3 | `data/contracts/`：仓储接口 + DTO | 接口方法签名冻结，改动需记入变更日志 |
| 4 | `data/mock/`：seed 数据 + 内存/IDB 实现 | 契约测试全绿 |
| 5 | `data/supabase/`（第二期） | 同一份契约测试在测试库上全绿 |

命名映射规则：`snake_case` ↔ `camelCase` 自动转换，唯独以下例外需手写：`cover_key` → `coverKey`、`iso_week` → `isoWeek`、`created_at` → `createdAt`。枚举值两端完全一致（全小写 + 下划线），避免第二期做值转换。

---

## 2. 路由与页面清单

优先级：**P0** 首发必须有；**P1** 首发应有；**P2** 可延后。

| 路由 | 页面 | 权限 | 主要数据依赖 | 关键交互 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| `/` | 首页 | 公开 | 精选作品、本周榜 Top5、最新教程 | 首屏大图轮播、榜单入口 | P0 |
| `/gallery` | 作品墙 | 公开 | `list({sort})` 游标分页 | 瀑布流/网格切换、无限滚动 | P0 |
| `/works/:id` | 作品详情 | 公开 | `get(id)`、评论列表、作者信息 | 点赞/收藏、评论、复制链接、举报入口 | P0 |
| `/categories` | 分类总览 | 公开 | 分类表 + 每类作品数 | 分类卡片跳转 | P0 |
| `/categories/:slug` | 分类作品墙 | 公开 | `list({categorySlug})` | 排序切换、返回 | P0 |
| `/search` | 搜索结果 | 公开 | `search({text, categorySlug, sort})` | 关键词高亮、筛选、空态建议 | P0 |
| `/rankings/weekly` | 周榜（当期） | 公开 | `getWeekly(currentWeek,'live')` | 名次变化箭头、上榜作品卡、刷新时间提示 | P0 |
| `/rankings/weekly/:isoWeek` | 历史周榜 | 公开 | `getWeekly(week,'final')` | 周选择器、与上周对比 | P1 |
| `/learn` | 学习板块首页 | 公开 | 主题树 + 最新/热门文章 | 主题卡、系列入口 | P0 |
| `/learn/topics/:topic` | 主题文章列表 | 公开 | `listArticles({topic})` | 难度/器材筛选 | P1 |
| `/learn/:slug` | 教程文章 | 公开 | 文章 Markdown + 关联作品 | 目录锚点、练习清单、相关作品 | P0 |
| `/login` | 登录 | 游客 | `signIn` | 演示账号一键填入、错误提示 | P0 |
| `/register` | 注册 | 游客 | `signUp` | 用户名可用性校验、协议勾选（必选） | P0 |
| `/u/:username` | 个人主页 | 公开 | 作品/收藏/喜欢三个 Tab | Tab 切换、关注按钮（P2） | P0 |
| `/settings/profile` | 资料设置 | 登录 | 当前用户 | 头像、昵称、简介、授权偏好 | P1 |
| `/publish` | 发布作品 | 登录 | `create` + `storage.put` | 拖拽上传、EXIF 读取、地点、分类、授权选择 | P0 |
| `/me` | 我的（快捷入口） | 登录 | 我的作品/收藏/草稿 | 草稿续填 | P1 |
| `/about` | 关于本站 | 公开 | 静态内容 | — | P1 |
| `/terms` | 用户协议 | 公开 | 静态内容 | — | P0 |
| `/privacy` | 隐私政策 | 公开 | 静态内容 | — | P0 |
| `/copyright` | 版权声明 | 公开 | 静态内容 | 许可徽标说明 | P0 |
| `/dmca` | 侵权投诉 | 公开 | 静态内容 + 邮件/Issue 模板 | 复制模板、邮件链接 | P0 |
| `/licenses` | 开源许可 | 公开 | 构建期生成的依赖清单 | 搜索依赖 | P1 |
| `/community` | 社区规范 | 公开 | 静态内容 | — | P1 |
| `*` | 404 | 公开 | — | 返回首页/搜索 | P0 |

**全局约束**：

| 项 | 规则 |
| --- | --- |
| URL 即状态 | 搜索词、分类、排序、页码全部进 query string，可分享、可回退 |
| 路由级分包 | 每个一级路由一个 `lazy()` chunk；`/publish`、`/search` 懒加载 |
| 受保护路由 | `<RequireAuth>` 包裹，未登录跳 `/login?next=<原路径>`，登录后原地返回 |
| 面包屑 | 详情/文章页必有，供 SEO 与导航 |
| 空态 | 每个列表页必须有空态（含下一步动作），禁止白屏 |
| 错误态 | 每页一个 ErrorBoundary 边界 + 重试按钮 |

---

## 3. 推荐目录结构

```
工科影展/
├─ .github/
│  ├─ workflows/ci.yml、deploy.yml
│  ├─ ISSUE_TEMPLATE/dmca.yml、bug.yml、feature.yml
│  └─ PULL_REQUEST_TEMPLATE.md
├─ docs/                      # 本计划、架构图、迁移手册
│  ├─ ROADMAP.md（本文件）
│  ├─ DATA-MODEL.md           # 第 4 节单独维护
│  └─ MIGRATION.md            # 静态→动态操作手册（第二期填写）
├─ public/                    # favicon、og 图、robots.txt、sitemap.xml
├─ src/
│  ├─ app/                    # main.tsx、router.tsx、providers、ErrorBoundary
│  ├─ pages/                  # 一个路由一个文件（只做编排，不写业务）
│  ├─ features/
│  │  ├─ photos/              # 列表、瀑布流、卡片、详情画廊
│  │  ├─ publish/             # 上传器、EXIF、表单
│  │  ├─ interactions/        # 赞/藏/评组件与 hooks
│  │  ├─ rankings/            # 榜单表、名次变化、周选择器
│  │  ├─ search/              # 搜索框、筛选器、结果高亮
│  │  ├─ learn/               # 文章渲染、目录、练习清单
│  │  ├─ auth/                # 表单、守卫、会话 hook
│  │  └─ profile/             # 个人主页与设置
│  ├─ components/
│  │  ├─ ui/                  # 无业务基元：Button/Dialog/Tabs/Toast/Skeleton
│  │  └─ layout/              # Header、Footer、Shell、Container
│  ├─ domain/                 # 类型 + 纯函数，零依赖，100% 可测
│  │  ├─ types.ts
│  │  ├─ schemas.ts           # zod
│  │  ├─ ranking.ts           # 评分公式、并列、周边界
│  │  ├─ categories.ts        # 分类种子常量
│  │  └─ permissions.ts       # canEdit/canDelete/canModerate
│  ├─ data/
│  │  ├─ contracts/           # 仓储接口 + DTO + AppError
│  │  ├─ mock/                # 静态期实现
│  │  │  ├─ repositories/
│  │  │  ├─ db.ts             # IndexedDB 封装（表结构、事务、版本迁移）
│  │  │  ├─ seed.ts           # 演示数据（10 用户 / 80 作品 / 300 互动）
│  │  │  └─ auth.ts           # 伪造会话
│  │  ├─ supabase/            # 第二期实现（含 mappers.ts、生成的 DB 类型）
│  │  └─ index.ts             # createRepositories(env) 工厂
│  ├─ hooks/                  # usePhotos、useWeeklyRanking、useSession…
│  ├─ lib/                    # 时间、图片压缩、EXIF、分词、格式化、游标编解码
│  ├─ content/learn/          # Markdown 文章 + front-matter
│  └─ styles/                 # 设计令牌、Tailwind 入口
├─ tests/
│  ├─ unit/                   # domain 与 lib
│  ├─ contract/               # 同一份用例跑 mock 与 supabase
│  └─ e2e/                    # Playwright 三条主链路
├─ .editorconfig .gitignore .nvmrc eslint.config.js prettier.config.js
├─ index.html tsconfig.json vite.config.ts vitest.config.ts playwright.config.ts
├─ LICENSE README.md CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md
├─ CREDITS.md THIRD_PARTY_NOTICES.md CHANGELOG.md
```

**依赖方向（用 eslint `no-restricted-imports` 强约束）**：

```
pages → features → components/ui
pages → hooks → services → data/contracts
data/mock, data/supabase → data/contracts（单向，互不引用）
domain → 无（禁止 import React、禁止 import data）
```

---

## 4. 数据模型设计

### 4.1 建模约定

| 项 | 约定 |
| --- | --- |
| 主键 | `uuid`（v4，客户端生成）；分类/主题用 `slug text` 作主键（可读、URL 稳定） |
| 时间 | 存 UTC ISO-8601；DB 用 `timestamptz`；展示按 `Asia/Shanghai` |
| 软删除 | `status` 枚举 + `deletedAt`；物理删除仅限用户主动注销 |
| 计数 | `likeCount / favoriteCount / commentCount` 冗余在作品行，**只读派生** |
| 枚举 | 全小写+下划线，TS 与 DB 完全一致 |
| 文本长度 | 在 zod schema 与 DB `check` 约束中写同一个数字 |
| 富文本 | 一期只允许纯文本 + 换行；Markdown 仅用于教程文章（服务端/构建期渲染并净化） |

### 4.2 实体字段

**profiles（用户资料；鉴权身份由 Auth 托管，`id` 与之 1:1）**

| 字段 | TS 类型 | DB 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| id | string | uuid | PK | 与 auth 用户同 ID |
| username | string | citext | UNIQUE，3–20，`^[a-z0-9_-]+$` | 个人主页路径 |
| displayName | string | text | 1–30 | 展示名 |
| avatarKey | string \| null | text | 可空 | Storage 键 |
| bio | string | text | 0–160 | 简介 |
| role | `'user'\|'editor'\|'admin'` | text | default `'user'` | 权限位 |
| links | `{label,url}[]` | jsonb | ≤3 | 主页链接 |
| createdAt / updatedAt | string | timestamptz | NOT NULL | — |
| deletedAt | string \| null | timestamptz | 可空 | 注销时间 |

**photos（作品）**

| 字段 | TS 类型 | DB 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| id | string | uuid | PK | 客户端生成 |
| authorId | string | uuid | FK profiles，NOT NULL | — |
| title | string | text | 1–60 | — |
| description | string | text | 0–2000 | 拍摄心得（对应"QQ 空间动态"的正文） |
| categorySlug | string | text | FK categories，NOT NULL | 单选主分类 |
| tags | string[] | text[] | ≤5，小写 | GIN 索引 |
| locationName | string | text | 0–80 | 拍摄地点（文本） |
| locationLat / locationLng | number \| null | numeric(9,6) | 可空 | 精确坐标，默认不采集 |
| locationPrecision | `'exact'\|'district'\|'city'\|'hidden'` | text | default `'city'` | 隐私档位，控制展示精度 |
| shotAt | string \| null | timestamptz | 可空 | 拍摄时间 |
| exif | `Record<string,unknown>` \| null | jsonb | 白名单字段 | 机身/镜头/光圈/快门/ISO |
| imageKey | string | text | NOT NULL | 原图键 |
| thumbKey | string | text | NOT NULL | 缩略图键 |
| width / height | number | int | >0 | 用于占位防 CLS |
| blurhash | string \| null | text | 可空 | 模糊占位 |
| license | `'all_rights_reserved'\|'cc_by'\|'cc_by_nc'\|'cc_by_nc_nd'\|'cc0'` | text | default `'all_rights_reserved'` | 作品授权，详情页展示徽标 |
| credit | string \| null | text | 可空 | 非本人拍摄时的来源署名 |
| status | `'draft'\|'published'\|'hidden'\|'removed'` | text | default `'draft'` | 可见性 |
| likeCount / favoriteCount / commentCount / viewCount | number | int | default 0 | 派生，只读 |
| publishedAt | string \| null | timestamptz | 可空 | 发布时刻，排序/榜单用 |
| createdAt / updatedAt | string | timestamptz | NOT NULL | — |
| deletedAt | string \| null | timestamptz | 可空 | 软删 |

**categories（分类，定稿 8 个）**

| 字段 | TS 类型 | DB 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| slug | string | text | PK | 稳定标识，改名不变 |
| name | string | text | UNIQUE，1–12 | 展示名（可改） |
| description | string | text | 0–100 | 判定标准摘要 |
| sortOrder | number | int | 唯一 | 排列顺序 |
| coverPhotoId | string \| null | uuid | 可空 | 分类封面 |
| isActive | boolean | bool | default true | 下架分类不删数据 |

**likes / favorites（互动，两表结构相同）**

| 字段 | TS 类型 | DB 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| userId | string | uuid | PK 组成，FK profiles | — |
| photoId | string | uuid | PK 组成，FK photos | — |
| createdAt | string | timestamptz | NOT NULL | **周榜按此落窗** |

> 主键 `(userId, photoId)` 保证"取消再点赞只算一次"，两期行为一致。取消 = 删除行。

**comments（评论，仅一级回复）**

| 字段 | TS 类型 | DB 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| id | string | uuid | PK | — |
| photoId | string | uuid | FK photos | — |
| authorId | string | uuid | FK profiles | — |
| parentId | string \| null | uuid | FK comments，可空 | 仅允许指向顶层评论 |
| body | string | text | 1–500 | 纯文本 |
| status | `'visible'\|'hidden'\|'removed'` | text | default `'visible'` | 审核态 |
| createdAt / updatedAt | string | timestamptz | NOT NULL | — |
| deletedAt | string \| null | timestamptz | 可空 | 软删，保留占位"该评论已删除" |

**weekly_rank_snapshots（榜单快照）**

| 字段 | TS 类型 | DB 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| id | string | uuid | PK | — |
| isoWeek | string | text | `UNIQUE(isoWeek, kind, formulaVersion)` | 如 `2026-W44` |
| kind | `'daily'\|'final'` | text | — | daily 用于名次变化箭头，final 为终榜 |
| timezone | string | text | default `'Asia/Shanghai'` | 结算时区，写进快照保证可复现 |
| weekStartUtc / weekEndUtc | string | timestamptz | NOT NULL | 半开区间 `[start, end)` |
| capturedAt | string | timestamptz | NOT NULL | 生成时刻 |
| formulaVersion | string | text | default `'v1'` | 权重升级即换版本 |
| entryCount | number | int | ≥0 | 榜内条数 |
| status | `'ready'` | text | — | 不可变，重算生成新行 |

**weekly_rank_entries（榜单条目）**

| 字段 | TS 类型 | DB 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| snapshotId | string | uuid | PK 组成，FK snapshots | — |
| rank | number | int | PK 组成，≥1 | 全序唯一 |
| photoId | string | uuid | FK photos | — |
| likeCount / favoriteCount | number | int | ≥0 | 该周窗口内计数 |
| score | number | numeric(10,2) | ≥0 | 公式结果，落库保留 2 位 |
| tieBreakKey | string | text | NOT NULL | `f:012\|l:030\|2026-10-01T..\|uuid` 便于审计 |

**article_topics / articles（学习板块）**

| 表 | 字段 | 类型 | 约束 |
| --- | --- | --- | --- |
| article_topics | slug | text | PK |
| | name / description / sortOrder | text/text/int | — |
| articles | id | uuid | PK |
| | slug | text | UNIQUE，URL 用 |
| | topicSlug | text | FK article_topics |
| | title / summary | text | 1–80 / 0–140 |
| | bodyMd | text | Markdown 原文 |
| | coverKey | text \| null | Storage 键 |
| | authorId | string | FK profiles |
| | difficulty | `'beginner'\|'intermediate'\|'advanced'` | — |
| | readingMinutes | number | ≥1，由字数估算 |
| | tags | string[] | ≤6 |
| | relatedPhotoIds | string[] | ≤6，站内作品联动 |
| | status | `'draft'\|'published'` | — |
| | publishedAt / updatedAt | timestamptz | — |
| | version | number | 每次实质更新 +1，页面显示更新日期 |

**reports（举报，P1.5 上线，模型先定）**

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| id | uuid | PK |
| targetType | `'photo'\|'comment'\|'profile'` | — |
| targetId | uuid | — |
| reason | `'copyright'\|'explicit'\|'spam'\|'abuse'\|'other'` | — |
| detail | text | 0–500 |
| reporterId | uuid \| null | 允许匿名 |
| status | `'open'\|'reviewing'\|'upheld'\|'rejected'` | default `'open'` |
| createdAt / resolvedAt | timestamptz | — |

### 4.3 关系图

```
profiles 1 ──< photos >── 1 categories
photos   1 ──< likes      >── 1 profiles      PK(userId, photoId)
photos   1 ──< favorites  >── 1 profiles      PK(userId, photoId)
photos   1 ──< comments   >── 1 profiles      comments 自引用 parentId
photos   1 ──< weekly_rank_entries >── 1 weekly_rank_snapshots
article_topics 1 ──< articles >── 1 profiles
photos 1 ──< reports（多态，无外键，靠 targetType 区分）
```

### 4.4 静态期持久化布局

| 存储 | 键 / 表 | 内容 | 体积预算 |
| --- | --- | --- | --- |
| localStorage | `gy:session` | `{ userId, expiresAt }` | < 1KB |
| localStorage | `gy:prefs` | 主题、视图模式（网格/瀑布流） | < 1KB |
| localStorage | `gy:rank:v1:{isoWeek}:{kind}` | 榜单缓存 + `computedAt` | < 100KB |
| IndexedDB `gy-db` | `profiles / photos / categories / likes / favorites / comments / rankSnapshots / rankEntries / articles / topics` | 实体表（与 DB 同名） | 200 作品约 1.5MB |
| IndexedDB `gy-assets` | `images`：`{ key, blob, width, height, createdAt }` | 原图 + 缩略图 Blob | 配额内（请求 `navigator.storage.persist()`） |
| IndexedDB `gy-db` | `_meta`：`{ schemaVersion, dataVersion, seededAt }` | 版本与迁移标记 | — |

> 实体一律进 IndexedDB（不走 localStorage 的 5MB 天花板）；localStorage 只放会话、偏好、小缓存。`dataVersion` 每次写入自增，供搜索索引与榜单缓存失效判断。

### 4.5 类型映射对照（TS ↔ Postgres）

| TS | Postgres | 注意 |
| --- | --- | --- |
| `string`（ISO） | `timestamptz` | 出库转 ISO 字符串，禁止 Date 对象穿透到组件 |
| `string \| null` | `text` NULL | 不用空串代替 null |
| `number`（坐标） | `numeric(9,6)` | 出库 `parseFloat`，保留 6 位 |
| `string[]` | `text[]` | 顺序无意义，比较时排序后比 |
| `Record<string,unknown>` | `jsonb` | 只存白名单键，前端读前校验 |
| 联合字面量 | `text` + `check` 约束 | 约束值与 TS 枚举逐字相同 |
| `{label,url}[]` | `jsonb` | 长度上限在 zod 与 check 双写 |

---

## 5. 静态期 Mock 方案与上线前必须替换的风险点

### 5.1 鉴权怎么模拟

| 项 | 做法 |
| --- | --- |
| 演示账号 | 预置 3 个（`alice`/`bob`/`editor`），密码统一 `demo1234`，登录页提供"一键填入"按钮 |
| 会话 | 登录后写 `gy:session`，附明显伪令牌前缀 `mock.`，`expiresAt = now + 7d` |
| 会话读取 | `useSession()` 启动时读一次，40 分钟无操作后过期提示重新登录 |
| 路由守卫 | `<RequireAuth>` 读会话，未登录跳登录并带 `?next=` |
| 身份切换 | 页脚"演示模式"面板可一键切换用户，便于自测多用户互动 |
| 密码 | **不做加密假装安全**：明确声明为演示。若坚持做哈希，用 Web Crypto PBKDF2 仅作演示，且文档标注"不构成任何安全保证" |
| 权限 | `domain/permissions.ts` 里 `canEdit(user, photo)` 等纯函数，静态期与动态期共用同一套判断，第二期在 RLS 里再实现一遍（双保险） |

### 5.2 上传怎么模拟

1. 选文件 → 校验类型（**仅 JPG/JPEG**）与大小（≤20MB）。
2. 读 EXIF（`ArrayBuffer` 解析白名单字段），**默认剔除 GPS 与设备序列号**。
3. Canvas 压缩：长边 ≤ 2400px 生成 `display`（WebP q0.82），长边 ≤ 640px 生成 `thumb`（WebP q0.75）。
4. 计算 `blurhash`（16×16 缩略后取均值色块即可，不必上库）。
5. `storage.put()` 写 IndexedDB `gy-assets`，键规则 **与 Storage 路径完全一致**：
   `photos/{authorId}/{photoId}/display.webp`、`.../thumb.webp`。
6. 表单提交写 `photos` 行（`status='draft'` → 点击发布改 `published`，同时写 `publishedAt`）。
7. 展示用 `URL.createObjectURL(blob)`，组件卸载 `revokeObjectURL`；列表页用缩略图键，详情页才取原图。

### 5.3 互动怎么模拟

| 行为 | 静态期实现 | 与动态期的一致性要求 |
| --- | --- | --- |
| 点赞 | `likes` 表 upsert/delete，重算 `photos.likeCount` | 计数永远由数据派生，不在组件里加减 |
| 收藏 | 同上 | 同上 |
| 评论 | 追加行 + 重算 `commentCount` | 分页同为游标，倒序同规则 |
| 乐观更新 | TanStack Query `onMutate` 本地改缓存，失败回滚 | 动态期不用改 hook |
| 跨标签页同步 | `BroadcastChannel('gy')` 广播 `interaction:changed` | 动态期由 Realtime 取代，事件名保持不变 |
| 自己给自己点赞 | 允许点击但**不计入榜单**（`authorId === userId` 时 score 权重 0） | 动态期在结算 SQL 里同样排除 |

### 5.4 榜单"实时"怎么模拟

- 纯函数 `computeWeeklyRanking({ photos, likes, favorites }, isoWeek, tz)`，输入输出都是纯数据，可在 Worker 里跑。
- 互动写入 → 发 `interaction:changed` → 失效当期榜缓存 → 榜单页 3 秒内可见变化（`BroadcastChannel` 覆盖其他标签页）。
- 页面可见性回到前台（`visibilitychange`）时若缓存超 60 秒则重算，作为"轮询"的廉价替代。
- 已结束周的 `final` 榜结果确定性恒定（同输入同输出），可直接缓存到 `localStorage`。

### 5.5 上线前必须替换的安全风险点

| # | 风险点 | 静态期现状 | 后果 | 上线前必须做的替换 | 根治阶段 |
| --- | --- | --- | --- | --- | --- |
| R-01 | 鉴权只在本机 | `gy:session` 可被任意改写，甚至自封 `admin` | 越权：冒充他人、删除作品 | Supabase Auth + JWT + RLS | D1 |
| R-02 | 密码策略形同虚设 | 演示密码明文写在前端 | 用户误用真实密码 | 关闭演示账号，强制邮箱验证 + 密码强度 | D1 |
| R-03 | 客户端校验可绕过 | zod 只在浏览器跑 | 超长文本、非法枚举写入 | 同一 schema 落 DB `check` 约束 + 触发器 | D2/D5 |
| R-04 | 数据只在本机 | IndexedDB 随浏览器数据清空即丢，换设备不可见 | 用户资产丢失、投诉 | Storage + Postgres 持久化；上线前必须提供「导出 JSON」并明示 | D3/D6 |
| R-05 | 图片无法跨端 | Blob 存在本机 IndexedDB | 分享链接在别人设备打不开 | Storage 上传 + CDN 分发 + 服务端二次剥离 EXIF | D3 |
| R-06 | XSS | 评论/心得若以 HTML 渲染即中招 | 会话被窃、页面被篡改 | 全站默认纯文本渲染；Markdown 走 `DOMPurify`；上线加 CSP | S5（先做）/ D6 |
| R-07 | 无频率限制 | 可脚本刷赞 | 榜单失真 | 服务端限流（Edge Function）+ 唯一约束 + 异常检测 | D4/D5 |
| R-08 | 计数可伪造 | 榜单在浏览器算 | 榜单单方信任崩塌 | 结算在数据库内完成，前端只读快照 | D4 |
| R-09 | 版权声明无存证 | 仅有文字声明 | 侵权投诉无法举证/下架 | 发布时记录授权勾选时间戳与版本号；投诉工单表 | D6 |
| R-10 | 无内容审核 | 上传即公开 | 违规内容风险 | 举报入口 + 人工审核队列 + `status='hidden'` 快速下架 | D5/P1.5 |
| R-11 | 第三方素材 | 示例图/字体来源未登记 | 许可证合规风险 | `CREDITS.md` 逐条登记（本阶段即做，不等后端） | S8 |
| R-12 | 演示数据混淆 | 种子作品看起来像真实用户内容 | 误导公众与版权归属 | 种子数据全部标注 `credit='示例素材'`，页脚常驻"演示模式"角标 | S1 |

**演示模式 UI 规范**（必须在 S1 就定，避免后期返工）：

1. 页脚固定一行：`演示模式：所有数据仅保存在你的浏览器，清除浏览数据即丢失。`
2. 登录页顶部黄色提示条，说明密码不具安全性。
3. 所有示例作品卡片右上角 `示例` 角标。
4. `/privacy` 明确写出本机存储的键名与清除方法。

---

## 6. 周排行榜

### 6.1 定义与时区

| 项 | 规定 |
| --- | --- |
| 周期 | 自然周，**ISO-8601 周**（周一开始，周日结束），周编号写 `2026-W44` |
| 时区 | `Asia/Shanghai`（UTC+8，无夏令时，边界稳定） |
| 窗口 | 半开区间 `[weekStartUtc, weekEndUtc)`：周一 00:00:00.000 +08:00 至次周一 00:00:00.000 +08:00，即 UTC 周日 16:00:00Z 至次周日 16:00:00Z |
| 计入对象 | `likes.createdAt` 与 `favorites.createdAt` 落在窗口内的行 |
| 上榜资格 | 作品 `status='published'` 且 `publishedAt < weekEndUtc`；作者自赞自藏权重为 0 |
| 榜单长度 | 计算 Top 100，展示 Top 20，首页取 Top 5 |
| 冻结规则 | 周一 00:15 +08:00 结算终榜（15 分钟宽限吸收网络延迟与时钟漂移），统计仍严格按 `createdAt < weekEndUtc` 过滤 |

### 6.2 评分公式 v1

```text
score(photo, week) = 1.0 × L + 3.0 × F

L = 该周窗口内、作者本人以外、仍存在的 like 行数
F = 该周窗口内、作者本人以外、仍存在的 favorite 行数
```

| 设计点 | 说明 |
| --- | --- |
| 为什么收藏 3 倍 | 收藏是"愿意再回来"的强意愿，成本高于点赞；点赞是轻量认同 |
| 为什么不计评论 | 评论易灌水（"好""赞"），且会让榜单被话痨作品主导；评论数仍在详情页展示 |
| 为什么有权重常量 | `domain/ranking.ts` 导出 `RANKING_WEIGHTS = { like: 1, favorite: 3 }`，与 `formulaVersion` 绑定 |
| 公式升级 | 改权重必须升 `formulaVersion`（如 `v2`），历史快照不改写，页面显示"本榜按 v1 计算" |

### 6.3 并列与排序

排序键（全序，保证任何两次计算结果完全一致）：

```
score DESC → favoriteCount DESC → likeCount DESC → publishedAt ASC → id ASC
```

| 场景 | 处理 |
| --- | --- |
| 同分 | 按上表依次比较，最终由 `id` 决胜，故**名次唯一、不并列** |
| 产品要求并列展示 | 若后续要"并列第 3"，用相同 `score` 归组做 dense rank，仅在展示层处理，不改变存储的 `rank` |
| 审计 | `tieBreakKey` 落库，形如 `score:42.00|f:10|l:12|2026-10-20T03:00:00Z|uuid`，出争议可直接复核 |

### 6.4 结算流程

**静态期（纯前端）**

| 步 | 动作 |
| --- | --- |
| 1 | 进入 `/rankings/weekly` → `useWeeklyRanking(isoWeek, kind)` |
| 2 | 命中 `gy:rank:v1:{isoWeek}:{kind}` 且未过期 → 立即渲染（SWR：后台静默重算） |
| 3 | 未命中 → 读 IndexedDB 实体 → 纯函数计算（数据 >5000 条移入 Web Worker） |
| 4 | 写缓存 + `computedAt`；页面显示"数据更新于 xx:xx" |
| 5 | 任意互动 → `interaction:changed` → 失效当期缓存 → 广播跨标签页 |
| 6 | 页面 `visibilitychange` 回前台且缓存 >60s → 重算 |
| 7 | 已结束周直接按 `final` 计算并长缓存（结果恒定） |

**动态期（服务端）**

| 步 | 动作 |
| --- | --- |
| 1 | pg_cron `15 16 * * 0`（UTC，= 周一 00:15 +08）调用 `settle_weekly_ranking()` |
| 2 | pg_cron `15 16 * * *` 调用 `capture_daily_ranking()` 生成当期 `daily` 快照，供 ↑↓ 变化 |
| 3 | 结算 SQL：`join` 作品与互动，按窗口聚合，`where author_id <> likes.user_id`，`order by score desc, f desc, l desc, published_at asc, id asc limit 100` |
| 4 | 幂等写入：先按 `(isoWeek, kind, formulaVersion)` 删除旧行再插入，或用 `on conflict do nothing`；快照 `status` 一次性置 `ready` |
| 5 | 只读 RPC `get_weekly_ranking(p_iso_week, p_kind)`，`security invoker` + RLS 允许 `select` |
| 6 | Realtime 订阅当期 `weekly_rank_entries` 变更；60 秒轮询兜底 |
| 7 | 历史榜完全静态化：`final` 快照生成后可由 Edge Function 输出 JSON 到 CDN，`immutable` 缓存 |

### 6.5 缓存策略

| 层 | 键 / 位置 | TTL | 失效触发 |
| --- | --- | --- | --- |
| 组件内存（TanStack Query） | `['ranking', isoWeek, kind]` | live 60s / final `Infinity` | 互动事件 `invalidateQueries` |
| 浏览器持久 | `gy:rank:v1:{isoWeek}:{kind}` | 300s | `formulaVersion` 或 `dataVersion` 变更 |
| 服务端物化 | `weekly_rank_entries` | 每周一次 | 新快照版本写入 |
| CDN 边缘 | `/rankings/{isoWeek}.json` | live `s-maxage=60, swr=300`；final `s-maxage=31536000, immutable` | 部署或新快照发布 |
| 应用层 | RPC 结果 | 不算缓存，依赖 Postgres 索引 | — |

**性能预算**：榜单首屏（含 20 张缩略图）LCP ≤ 2.5s（4G 模拟）；榜单计算纯函数耗时 ≤ 50ms / 5000 作品（有基准测试）；榜单路由 chunk ≤ 60KB gzip。

### 6.6 反作弊与资格规则

| 级别 | 规则 |
| --- | --- |
| V1（首版必须） | 作者自赞自藏不计分；`(userId, photoId)` 唯一约束使"取消再点"只算一次；只统计 `published` 作品；窗口严格半开以避免边界重复 |
| V1（记录不惩罚） | 注册不足 1 小时的账号互动仍计入，但在快照里记 `newAccountShare`，用于后续观察 |
| V2（有流量后） | 互动速率限流（同一用户 60 秒内最多 20 次写）；异常曲线检测（单作品 1 小时内赞数 > 全站中位数 20 倍）；影子封禁名单；设备指纹去重 |

### 6.7 榜单 UI 与数据契约

```ts
type WeeklyRanking = {
  isoWeek: string; kind: 'live' | 'final'; timezone: string;
  weekStartUtc: string; weekEndUtc: string; computedAt: string;
  formulaVersion: string;
  entries: Array<{
    rank: number; photo: PhotoSummary;
    likeCount: number; favoriteCount: number; score: number;
    rankChange: number | null;   // 与上一份 daily 快照比较，null = 新上榜
  }>;
};
```

UI 要素：名次徽章（前三名特殊样式）、名次变化箭头（↑2 / ↓1 / NEW / —）、缩略图、标题、分类、作者、赞/藏计数、得分条（相对第一名的百分比宽度）、"更新于"时间戳、周选择器、规则说明折叠区（含公式与并列规则，公开透明）。

---

## 7. 分类体系与搜索

### 7.1 分类表（定稿 8 个，一级分类，不建树）

| slug | 名称 | 判定标准（一句话） | 典型示例 |
| --- | --- | --- | --- |
| landscape | 风光 | 以自然环境为主体，强调光线、地貌与气象 | 日出山脊、海岸长曝、星空 |
| documentary | 人文纪实 | 以人的活动与社会现场为主体，讲事件与处境 | 集市、工地、节庆、手艺 |
| portrait | 人像 | 以单人/双人为画面核心，可含环境肖像 | 棚拍、环境肖像、家庭纪实 |
| street | 街头 | 公共空间中的偶发瞬间与秩序感 | 决定性瞬间、光影行人、橱窗反射 |
| architecture | 建筑 | 以建筑结构、空间与几何为主体 | 立面几何、室内空间、桥梁 |
| wildlife | 生态 | 动植物及其生境，含微距 | 鸟类、昆虫、植物细节 |
| stilllife | 静物 | 人为布置与布光的物件 | 器物、食物、产品 |
| experimental | 实验 | 非常规工艺或观念表达 | 蓝晒、多重曝光、抽象、合成 |

**为什么不做二级分类**：单人维护，树越深越难归类；细分需求由标签承担（如 `#长曝`、`#胶片`、`#夜景`）。`slug` 一旦发布永不修改（改名只改 `name`），保证 URL 与历史数据稳定。

### 7.2 标签规则

| 规则 | 内容 |
| --- | --- |
| 数量 | 每作品 0–5 个 |
| 形态 | 小写、去空格、2–12 字，中文/英文/数字 |
| 归一 | 全角转半角、去装饰符；同义词经 `tagAliases` 常量映射（如 `长曝光→长曝`） |
| 来源 | 发布时自由输入 + 热门标签推荐（静态期取现有标签词频 Top 20） |
| 反滥用 | 禁止与分类名重复的标签（"风光"不再作为标签） |

### 7.3 搜索接口契约（两期一致）

```ts
type PhotoQuery = {
  text?: string;
  categorySlug?: string;
  tags?: string[];
  locationName?: string;
  sort: 'relevance' | 'latest' | 'hot';   // hot = 近 7 天 score
  cursor?: string;
  limit: number;                           // 默认 24
};
searchPhotos(q: PhotoQuery): Promise<Page<PhotoSummary>>;
```

### 7.4 静态期搜索实现

| 环节 | 方案 |
| --- | --- |
| 索引位置 | **运行时构建**（静态期数据在用户浏览器里，不存在构建期索引） |
| 索引库 | MiniSearch（约 8KB gzip），字段权重：`title 3 / tags 2.5 / locationName 2 / description 1 / authorName 1` |
| 中文分词 | `Intl.Segmenter('zh-Hans', { granularity: 'word' })`；不支持时退化为 **bigram**（两字滑窗），保证"山海"能命中"山海之间" |
| 归一化 | 全角→半角、大小写统一、去首尾空白；查询与索引同一函数，避免不一致 |
| 构建时机 | 首次进入 `/search` 或搜索框获得焦点时 `import()` 懒加载并建索引；200 作品 < 100ms，2000 作品约 400ms（超 150ms 移入 Worker） |
| 缓存 | 索引驻留内存 + `gy:searchidx:{dataVersion}` 存 IndexedDB，数据未变直接复用 |
| 结果排序 | `relevance`（MiniSearch score + 时间衰减）→ `latest`（publishedAt desc）→ `hot`（近 7 天 score desc，与周榜同公式） |
| 高亮 | 命中词包 `<mark>`，仅文本节点，禁止 innerHTML 拼接 |
| 筛选 | 分类/标签/地点为内存过滤，先过滤再打分，保持与动态期 SQL 语义一致 |
| 空态 | 展示"无结果"+"试试这些标签"+"清除筛选"，并记录到搜索日志（本地）用于选题 |
| 体积预算 | 索引 + 搜索路由 chunk ≤ 120KB gzip |

### 7.5 动态期搜索实现

| 环节 | 方案 |
| --- | --- |
| 索引列 | `photos.search_text` 生成列 = `title || ' ' || description || ' ' || location_name || ' ' || array_to_string(tags,' ')`，统一小写、全角转半角 |
| 中文召回 | **pg_trgm**（`gin (search_text gin_trgm_ops)`）+ `similarity()`；Supabase 默认无中文分词词典，trigram 对 CJK 有效且零运维 |
| 关键词检索 | `websearch_to_tsquery('simple', :q)` 走 `to_tsvector('simple', search_text)`；短查询（1–2 字）走 trgm 分支 |
| 排序 | `relevance`：`similarity()` 与 `ts_rank` 加权 0.7 + 时间衰减 0.2 + 近 7 天热度 0.1；其余排序同静态期 |
| 分页 | keyset：`(relevance, published_at, id)` 编进游标，避免深翻页 |
| 可插拔 | 若中文质量不足，`SearchAdapter` 可换 Meilisearch/Typesense，接口不变（D-10 的价值） |
| 性能预算 | 1 万作品下 P95 < 120ms；索引列与 GIN 索引在迁移 SQL 中一次建好 |

### 7.6 一致性保障（契约测试用例）

| # | 输入 | 期望 |
| --- | --- | --- |
| C-1 | 空查询 + `latest` | 按发布时间倒序，游标可续页无重复 |
| C-2 | `text='山'` | 命中标题含"山"或标签含"山"，按相关度排序 |
| C-3 | `text='nikon'` 与 `text='ＮＩＫＯＮ'` | 结果集完全相同（归一化生效） |
| C-4 | `categorySlug='street'` + `sort='hot'` | 仅该类作品，按近 7 天 score 降序 |
| C-5 | `tags=['夜景']` | 精确命中该标签，不含"夜景人像"等近似标签 |
| C-6 | 无结果查询 | `items=[]`、`nextCursor=null`，不报错 |
| C-7 | 翻页中途插入新作品 | 已翻过的页不重复、不遗漏（游标稳定性） |
| C-8 | `limit=200`（超上限） | 收敛为 50 并返回提示 |

> 这套用例先跑在 `mock` 适配器上；第二期在同一份用例上跑真实数据库（测试 schema + 固定种子），任一不通过即阻断发布。

---

## 8. 学习板块信息结构

### 8.1 信息架构

```
/learn
├─ 拍摄技巧  /learn/topics/technique
│   ├─ 构图（三分法、引导线、负空间、层次）
│   ├─ 用光（自然光时段、逆光、人造光入门）
│   ├─ 色彩与影调（白平衡、色调分离、黑白转换）
│   └─ 主题实战（风光 / 人文 / 街头 各一篇）
├─ 器材      /learn/topics/gear
│   ├─ 机身与画幅（全画幅 vs APS-C vs M43 的取舍）
│   ├─ 镜头与焦段（广角/标准/长焦的使用场景）
│   ├─ 配件（滤镜、脚架、闪光、存储）
│   └─ 选购与二手避坑（预算分配、验机清单）
├─ 后期      /learn/topics/post
│   ├─ 基础调整流程（曝光→色彩→局部→输出）
│   ├─ 色彩管理与显示器校准
│   └─ 导出与压缩（网页用图规范）
└─ 伦理与版权 /learn/topics/ethics
    ├─ 拍摄伦理（被摄者意愿、纪实边界）
    ├─ 肖像权与授权书
    └─ 署名、二次创作与合理使用
```

### 8.2 文章 front-matter 字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` / `slug` | 是 | 标题 ≤30 字；slug 永不变更 |
| `topic` | 是 | 四个主题之一 |
| `difficulty` | 是 | `beginner` / `intermediate` / `advanced` |
| `summary` | 是 | ≤80 字，列表页与分享卡片用 |
| `cover` | 否 | 封面键，缺省用主题默认色块 |
| `tags` | 否 | ≤6，如 `长曝`、`滤镜`、`预算3000` |
| `equipment` | 否 | 器材标签，供"按器材找教程" |
| `relatedPhotos` | 否 | ≤6 个站内作品 ID |
| `publishedAt` / `updatedAt` / `version` | 是 | 更新时间与版本，页面显示"最后更新" |
| `draft` | 是 | `true` 时不进构建产物 |

### 8.3 单篇模板结构（固定七段）

1. **摘要卡**：一句话结论 + 适用人群 + 预计阅读时长。
2. **你将学会**：3 条可验证的能力点。
3. **正文**：Markdown，含参数示例表（机身/镜头/光圈/快门/ISO/焦距）。
4. **常见错误**：3–5 条"症状 → 原因 → 改法"。
5. **练习任务**：可勾选清单（本地记录完成状态），3 项以内。
6. **相关作品**：站内 3–6 张示例，点击进详情（形成内容与作品的闭环）。
7. **延伸阅读**：站内 2 篇 + 站外 1–2 个权威来源（注明许可）。

### 8.4 内容节奏与冷启动

| 项 | 计划 |
| --- | --- |
| 上线前存量 | 12 篇（每主题 3 篇），保证每个入口点进去不是空的 |
| 上线后节奏 | 每周 1 篇，固定周三发布；每月 1 篇器材长文 |
| 生产流程 | 大纲（30min）→ 拍摄示例（2h）→ 成稿（2h）→ 校对与配图（1h） |
| 质量门槛 | 每篇 ≥1 张自摄示例图；所有参数真实可复现；不写"多拍多练"式空话 |
| 归档 | 每年底做一次"过时内容"复查，标注 `version` 与修订说明 |

### 8.5 与其它模块的联动

- 作品详情页 → "相关教程"（按 `relatedPhotos` 反查）。
- 教程页 → "用这组参数拍的站内作品"（按 `equipment` 与 `tags` 匹配）。
- 发布页 → "不知道怎么拍？看看教程"的轻提示（不打断流程）。

---

## 9. 版权与开源合规

### 9.1 代码许可证

| 项 | 决定 | 理由 |
| --- | --- | --- |
| 代码许可 | **MIT** | 最短、GitHub 认知度最高、允许他人复用与二次开发；单人项目无专利防御需求 |
| 若在意专利与贡献者授权 | 升级为 **Apache-2.0** | 含明确专利授权与贡献者条款；代价是文件更长、需 NOTICE |
| 站点文案与教程 | **CC BY-SA 4.0** | 允许转载但必须署名并以同协议共享，保护内容不被洗稿商用 |
| 用户上传作品 | **默认保留所有权利**（可选 CC） | 平台不代用户授权；用户可自选 CC BY / CC BY-NC-ND / CC0 |
| 不要在 README 里写"本项目全部内容 MIT" | — | 代码与用户作品的许可必须分开声明，否则等于替用户授权 |

### 9.2 用户上传图片的授权条款（写进《用户协议》第 4 条）

必须逐条落地，缺一条都会在纠纷中吃亏：

1. **权利保留**：用户对自己的作品保留完整著作权，平台不取得所有权。
2. **授予平台的许可**：全球范围、非独占、免费、可向技术服务商（CDN、对象存储）转授权的展示许可，**目的严格限定**为：站内展示、缩略图与压缩图生成、榜单与推荐位展示、站内搜索索引、备份与故障恢复。
3. **明确排除**：AI 模型训练、对外商业授权、印刷出版、周边商品、NFT 铸造——均需另行书面授权。
4. **可撤回**：用户可随时删除作品；删除后平台在 30 天内从线上与 CDN 移除，备份留存不超过 90 天。
5. **权利保证**：用户保证拥有著作权，并已取得必要的肖像权、物权（私人场所/艺术品）授权；因侵权产生的索赔由上传者承担。
6. **避风港**：平台适用"通知—删除"规则，收到有效通知后及时下架，不承担事先审查义务。
7. **授权选择**：发布时可选 `保留所有权利 / CC BY 4.0 / CC BY-NC-ND 4.0 / CC0`，写入 `photos.license`；详情页展示许可徽标 + 机器可读标记（`rel="license"` 链接 + JSON-LD `license` 字段）。
8. **协议版本存证**：发布时记录用户勾选协议的版本号与时间戳（`termsVersion`、`acceptedAt`），供日后举证。

### 9.3 示例图与素材版权来源

| 优先级 | 来源 | 条件 |
| --- | --- | --- |
| 1 | **自己拍摄** | 最佳；保留 RAW 与拍摄记录 |
| 2 | Unsplash / Pexels | 免费商用，但仍需登记来源；不得暗示作者为本站背书 |
| 3 | Wikimedia Commons | 多为 CC BY-SA，**必须署名 + 同协议共享 + 链接许可原文** |
| 4 | CC0 图库（如 Openverse 筛选 CC0） | 可用，仍需登记 |
| 禁止 | 搜索引擎图片、带水印图、电商图、社交媒体截图、来源不明的 AI 生成图 | 一律不得进入仓库与种子数据 |

**登记文件 `CREDITS.md`**（每一张非自摄图片一行）：

| 列 | 内容 |
| --- | --- |
| 文件 | `public/seed/cover-street-01.webp` |
| 用途 | 种子作品 #12 封面 / 教程《街头决定性瞬间》配图 |
| 作者 | 摄影师署名（含主页链接） |
| 来源 URL | 原始页面地址 |
| 许可证 | `CC BY-SA 4.0` + 许可原文链接 |
| 获取日期 | 2026-10-20 |
| 备注 | 是否裁切/调色（CC BY-SA 要求标注修改） |

种子作品额外在 `photos.credit` 字段冗余写"示例素材 · 来源见 CREDITS.md"，并在卡片显示 `示例` 角标，避免被误认为站内用户原创。

### 9.4 站点必备法律页面

| 页面 | 必含内容 |
| --- | --- |
| `/terms` 用户协议 | 服务说明、账号规则、内容规范、上传授权（见 9.2）、免责、违约处理、协议变更 |
| `/privacy` 隐私政策 | 收集哪些数据（邮箱、作品、互动）、用途、存储位置、保留期限、Cookie 与 localStorage/IndexedDB 键名清单、用户权利（导出/删除）、联系方式。**静态期必须诚实写明：数据仅存本机浏览器，不上传服务器，清除浏览器数据即丢失** |
| `/copyright` 版权声明 | 平台代码许可、站点文案许可、用户作品权利归属、许可徽标含义、转载规则、侵权举报入口 |
| `/dmca` 侵权投诉 | 通知要素模板（权利人信息、权属证明、侵权链接、真实性声明、签名）、处理时限（48h 确认 / 7 个工作日处理）、反通知与申诉、恶意投诉的后果 |
| `/licenses` 开源许可 | 由构建脚本生成的依赖清单（名称/版本/许可/仓库地址） |
| `/community` 社区规范 | 允许/禁止内容、评论规范、处罚梯度（提醒→隐藏→封禁） |

> 静态期没有服务端，投诉只能走邮箱与 GitHub Issue 模板；页面须明确写"下架能力将在动态期上线后生效"，不要做出无法兑现的承诺。

### 9.5 仓库文件清单

| 文件 | 作用 | 要点 |
| --- | --- | --- |
| `LICENSE` | 代码许可 | MIT 全文 + 年份与作者名（不要留占位符） |
| `README.md` | 门面 | 一句话定位、截图/GIF、**演示模式声明**、本地运行三步、目录说明、路线图链接、许可与贡献入口 |
| `CONTRIBUTING.md` | 贡献流程 | 开发环境、分支命名、Conventional Commits、PR 检查清单、**DCO 签名（`git commit -s`）而非 CLA**、代码风格、测试要求 |
| `CODE_OF_CONDUCT.md` | 行为准则 | Contributor Covenant 2.1 原文 + 联系邮箱 |
| `SECURITY.md` | 安全策略 | 支持的版本、私密报告渠道、响应时限；明确"前端不含密钥，仅 `VITE_*` 公开变量" |
| `CREDITS.md` | 素材版权 | 见 9.3 |
| `THIRD_PARTY_NOTICES.md` | 依赖许可 | 由脚本生成，CI 校验与 lockfile 一致 |
| `CHANGELOG.md` | 变更记录 | Keep a Changelog 格式，与版本标签同步 |
| `.gitignore` | 忽略 | `node_modules/`、`dist/`、`.env*`（保留 `.env.example`）、`*.local`、`coverage/`、`playwright-report/`、`.DS_Store`、`Thumbs.db`、`.idea/`、`.vscode/*`（保留 `extensions.json`/`settings.json`）、`*.log` |
| `.editorconfig` / `.nvmrc` | 环境一致 | Node 22 LTS；2 空格、LF、UTF-8 |
| `.github/ISSUE_TEMPLATE/dmca.yml` | 投诉表单 | 必填项与 `/dmca` 页面一致 |
| `.github/PULL_REQUEST_TEMPLATE.md` | PR 模板 | 变更类型、影响页面、自测清单、截图 |

### 9.6 GitHub Actions

| 工作流 | 触发 | 步骤要点 |
| --- | --- | --- |
| `ci.yml` | `pull_request` + `push` 到非 main 分支 | `actions/checkout@v4` → `pnpm/action-setup` → `actions/setup-node@v4`（Node 22，缓存 pnpm）→ `pnpm install --frozen-lockfile` → `tsc --noEmit` → `eslint .` → `vitest run --coverage` → `pnpm build` → 产物体积检查（首屏 JS gzip ≤ 200KB，超标失败）→ Playwright 冒烟（仅 main 前分支跑一次） |
| `deploy.yml` | `push` 到 `main` + `workflow_dispatch` | 权限 `contents: read`、`pages: write`、`id-token: write`；`concurrency: { group: pages, cancel-in-progress: true }`；构建 → `actions/upload-pages-artifact` → `actions/deploy-pages` |
| `dependabot.yml` | 每周 | npm 与 GitHub Actions 分组更新，补丁级自动合并（需 CI 绿） |

**GitHub Pages 静态期三个必须处理的坑**：

1. **base 路径**：`vite.config.ts` 的 `base` 设为 `/<仓库名>/`，否则资源 404。
2. **SPA 路由回退**：构建后把 `index.html` 复制为 `404.html`，直接访问 `/works/xxx` 才不白屏。
3. **自定义域名**：放 `public/CNAME`，同时把 `base` 改为 `/`。

### 9.7 第三方依赖合规

- CI 增加许可扫描（`pnpm licenses list --json` 或 `license-checker`），黑名单：`GPL-2.0`、`GPL-3.0`、`AGPL-3.0`、`SSPL`（如确需，必须隔离并评估）。
- 白名单：MIT / ISC / Apache-2.0 / BSD-2/3 / CC0 / OFL（字体）。
- 字体优先使用系统字体栈；若引入开源字体，选 OFL 并登记到 `CREDITS.md`。
- 每次新增依赖必须在 PR 描述里写明"为什么不能自己写 20 行"。

### 9.8 侵权投诉处理流程

```
收到通知（邮箱 / Issue 模板）
  → 48 小时内确认收到并登记（工单号）
  → 初审：权属证明是否完整、链接是否指向本站
  → 成立：作品置 status='hidden' 立即下线，通知上传者并给 7 天申诉期
  → 不成立：书面说明理由，告知补充材料渠道
  → 申诉：上传者提供原创证据 → 复核 → 恢复或维持
  → 归档：全过程留痕（动态期落 reports 表）
```

---

## 10. 分阶段计划

### 10.1 投入假设

| 项 | 假设 |
| --- | --- |
| 人力 | 1 人（设计 + 前端 + 内容 + 运维） |
| 周投入 | 基准 **12 小时/周**（工作日 2 晚 × 2.5h + 周末 1 天 × 7h） |
| 缓冲 | 每阶段预留 15% 时间，不写入工时但占用周次 |
| 每周节奏 | 周一 30min 定目标 → 周三 30min 自测 → 周日 1h 验收与回填工时 |
| 技能前提 | 熟悉 React + TS；不熟悉 Supabase 需额外 6h 学习（计入 D0） |

### 10.2 静态期阶段表（S0–S8，合计 154h / 约 13 周）

| 编号 | 周次 | 阶段目标 | 主要任务 | 交付物 | 验收标准 | 工时 |
| --- | --- | --- | --- | --- | --- | --- |
| S0 | W1 | 决策冻结 | 本计划评审定稿；分类/许可/公式/时区拍板；待决问题清零 | ROADMAP v1.0、DATA-MODEL 初稿、决策日志 | 附录 A 待决问题全部有结论；分类与许可枚举不再变动 | 8h |
| S1 | W1–W2 | 工程地基与设计系统 | Vite+TS+ESLint+Prettier+Vitest 初始化；设计令牌（色板/字阶/间距/圆角/阴影）；Button/Input/Dialog/Tabs/Toast/Skeleton；Header/Footer/Shell；演示模式角标与页脚声明 | 可运行的空白站点、组件画廊页 `/_dev/ui`、CI 跑通 | `tsc`/`eslint` 零错误；组件在明暗两套令牌下无对比度不足（≥4.5:1）；键盘可操作全部弹层 | 16h |
| S2 | W2–W3 | 领域模型与数据层 | 写 `domain/types.ts` 全量实体与枚举；zod schema；8 个分类种子；仓储接口；IndexedDB 封装（版本迁移）；mock 仓储实现；seed 数据（10 用户/80 作品/300 互动/12 文章大纲）；伪造会话 | 契约接口定稿、mock 适配器、契约测试骨架、种子数据 | 契约测试全绿；seed 数据通过同一份 zod 校验；`domain` 目录零 React 依赖；`data/index.ts` 可切换数据源 | 20h |
| S3 | W4–W5 | 浏览主链路 | 首页、作品墙（网格/瀑布流、无限滚动）、详情页（画廊、EXIF、地点、作者、相关作品）、分类总览与分类墙、404/错误边界 | 可浏览的完整站点（只读） | 4 个页面 Lighthouse 移动端 Perf ≥ 90、A11y ≥ 95；无限滚动无重复项；图片无 CLS（宽高比占位生效） | 22h |
| S4 | W5–W7 | 账号、发布与个人主页 | 登录/注册（mock）、`RequireAuth`、头像与资料；上传器（拖拽、压缩、EXIF 白名单、GPS 剥离、进度）；发布表单（标题/心得/地点/分类/标签/授权）；草稿；个人主页三 Tab | 可注册、可发布、可查看自己作品的闭环 | 20MB 图片在 5s 内完成压缩入库；GPS 字段确实被剔除（有单测）；刷新后草稿不丢；未登录访问 `/publish` 正确跳转并回跳 | 22h |
| S5 | W7–W8 | 互动 | 点赞/收藏（乐观更新+回滚+跨标签同步）、评论（一级回复、软删占位）、举报入口占位；"我的收藏/喜欢"页 | 完整互动链路 | 双标签页操作 1s 内互相同步；弱网模拟失败后计数回滚正确；评论 XSS 用例（`<img onerror>`）不执行 | 16h |
| S6 | W8–W10 | 搜索与周榜 | MiniSearch 索引（分词/bigram 兜底）、搜索页与筛选、高亮；`computeWeeklyRanking` 纯函数、周榜页（当期+历史）、名次变化、规则说明 | 搜索与榜单两大功能 | 契约测试 C-1~C-8 全绿；5000 作品计算 ≤50ms；榜单页 LCP ≤2.5s；公式与并列规则在页面可查 | 20h |
| S7 | W10–W11 | 学习板块与法律页 | Markdown 渲染管线（净化）、12 篇文章上线、主题页、练习清单；`/terms` `/privacy` `/copyright` `/dmca` `/licenses` `/community` | 内容可读、法律页齐备 | 文章构建期渲染无 XSS；每篇含自摄示例图与参数表；法律页四项（授权/隐私/版权/投诉）无空缺条款 | 14h |
| S8 | W11–W13 | 合规、部署与打磨 | LICENSE/README/CONTRIBUTING/SECURITY/CREDITS/.gitignore；`ci.yml`/`deploy.yml`；Pages 上线（base/404.html）；无障碍修复（焦点环、跳过导航、表单 label）；性能收尾（路由分包、图片尺寸、字体）；Beta 邀请 5 人试用 | 线上可访问的 Beta 站点 | 三条主链路 E2E 绿；axe 0 critical/serious；首屏 JS ≤200KB gzip；5 人试用无 P0 缺陷；README 可让陌生人 10 分钟内跑起来 | 16h |

### 10.3 动态期阶段表（D0–D6，合计 90h / 约 8 周）

| 编号 | 周次 | 阶段目标 | 主要任务 | 交付物 | 验收标准 | 工时 |
| --- | --- | --- | --- | --- | --- | --- |
| D0 | W14 | 服务端基建 | Supabase 项目与环境分离（dev/prod）；迁移 SQL（表/索引/枚举/check）；`gen types`；RLS 草案；Storage 桶与策略；学习 Supabase（6h 含在此） | `supabase/migrations/*.sql`、生成类型、`mappers.ts` | 迁移可 `supabase db reset` 一次重建；domain 与 DB 字段差异为零（脚本比对）；Storage 路径规则与静态期一致 | 12h |
| D1 | W15 | 鉴权迁移 | 邮箱注册/登录/验证、GitHub OAuth、密码重置；`SupabaseAuthAdapter`；`RequireAuth` 与 `useSession` 零改动切换；注销与数据删除 | 真实账号体系 | 注册→验证→登录→发布全链路通过；会话刷新无闪烁；注销后本地缓存清空 | 10h |
| D2 | W16–W17 | 只读迁移 | `PhotoRepository`/`ArticleRepository` 的 Supabase 实现；游标分页（keyset）；搜索（trgm + tsquery）；灰度开关 `VITE_DATA_SOURCE`；双跑比对（同一查询两适配器结果 diff） | 只读全量切到 Supabase | 契约测试 C-1~C-8 在真实库全绿；首页/墙/详情/分类/搜索 P95 < 400ms；双跑 diff 差异率 < 0.5% | 14h |
| D3 | W17–W19 | 写入迁移 | 发布与上传（Storage、图片变换、EXIF 服务端二次剥离）；点赞/收藏/评论写入；计数触发器；乐观更新保持；旧数据导入（JSON 导出→脚本→SQL） | 真实持久化 | 互动计数与触发器一致（对账脚本零差异）；并发点赞 100 次计数准确；导入后作品/互动/图片链接全部可用 | 18h |
| D4 | W19–W20 | 榜单服务端化 | 结算函数、pg_cron、daily 快照、只读 RPC、边缘缓存头、历史榜静态 JSON；`RankingRepository` 切换 | 权威周榜 | 手工重跑结算结果幂等；终榜与前端历史计算结果逐条一致；历史榜命中 CDN | 14h |
| D5 | W20 | 安全与治理 | RLS 全表策略与越权测试（他人作品改删、私改计数、越权读草稿）；限流；举报工单；下架流程；CSP/HSTS | 安全基线 | 越权用例 12 条全部被拒；`anon` key 无法写入受限表；安全头扫描 A 级 | 12h |
| D6 | W21 | 收尾上线 | 数据迁移收尾与回滚预案；Sentry/Plausible 接入；Cloudflare Pages 切换；压测（100 并发）；文档补 `MIGRATION.md`；静态期站点转为"演示模式"入口 | 正式站点 | 压测 P95 < 800ms；回滚演练一次成功（30 分钟内切回静态版）；监控能收到错误与 5xx 告警 | 10h |

### 10.4 周历（甘特）

| 周 | W1 | W2 | W3 | W4 | W5 | W6 | W7 | W8 | W9 | W10 | W11 | W12 | W13 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 阶段 | S0 | S1 | S2 | S3 | S3 | S4 | S4/S5 | S5 | S6 | S6 | S7 | S8 | S8 |

| 周 | W14 | W15 | W16 | W17 | W18 | W19 | W20 | W21 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 阶段 | D0 | D1 | D2 | D2/D3 | D3 | D3 | D4/D5 | D6 |

**里程碑**：M1 = S2 结束（数据层定稿，架构风险出清）；M2 = S5 结束（核心闭环可用）；M3 = S8 结束（Beta 上线）；M4 = D3 结束（真实数据可用）；M5 = D6（正式上线）。

### 10.5 质量门禁（每个阶段的 DoD）

| # | 门禁 | 阈值 |
| --- | --- | --- |
| G-1 | 类型与静态检查 | `tsc --noEmit` 0 error，`eslint` 0 error、0 warning |
| G-2 | 单元测试 | `domain/` 与 `lib/` 覆盖率 ≥ 80%；`data/mock` 关键路径 ≥ 70% |
| G-3 | 契约测试 | 每条仓储方法至少 3 个用例（正常/边界/错误） |
| G-4 | E2E | 三条主链路：浏览→点赞收藏评论；注册→发布→个人主页可见；搜索→周榜→教程 |
| G-5 | 性能 | Lighthouse 移动端 Perf ≥ 90（首页/墙/详情/周榜）；LCP ≤ 2.5s；CLS ≤ 0.1；INP ≤ 200ms |
| G-6 | 体积 | 首屏 JS ≤ 200KB gzip；单路由 chunk ≤ 120KB；单图 ≤ 300KB（列表用缩略图） |
| G-7 | 无障碍 | axe 0 critical/serious；全站键盘可达；焦点可见；`prefers-reduced-motion` 生效 |
| G-8 | 运行时洁净 | 生产构建 0 console error/warning；无未捕获 Promise |
| G-9 | 内容完整 | 每个列表页有空态与错误态；每个受保护路由有守卫 |
| G-10 | 文档同步 | 本文件与 DATA-MODEL 已回填实际工时与偏差 |

### 10.6 风险表

| # | 风险 | 概率 | 影响 | 触发信号 | 应对 | 阶段 |
| --- | --- | --- | --- | --- | --- | --- |
| K-01 | 范围蔓延（想加关注流/私信） | 高 | 工期翻倍 | 连续两周新增"顺手做"的需求 | 需求进 `docs/BACKLOG.md` 并冻结到 D6 之后；每周只做计划内任务 | 全程 |
| K-02 | mock 与真实后端语义漂移 | 中 | 迁移时大面积返工 | 契约测试用例少于接口方法数×3 | 接口先冻结、契约测试先行、D2 双跑 diff | S2/D2 |
| K-03 | 本地存储配额不足或隐私模式受限 | 中 | 上传失败、数据丢失 | Safari 无痕下 IndexedDB 报错 | 上传前 `navigator.storage.estimate()` 检查并提示；超限降级为"仅当前会话"；明确告知数据在本机 | S4 |
| K-04 | 图片体积拖垮 LCP | 高 | 体验差、跳出 | 移动端 LCP > 3s | 三档尺寸（thumb 640 / display 1600 / 原图按需）；`loading=lazy` + 宽高比占位；上传即压缩；预算写进 CI | S3/S8 |
| K-05 | 中文搜索效果不达预期 | 中 | 核心功能不可用 | 单字查询召回率 < 60% | 静态期 bigram 兜底 + 契约用例；动态期 trgm；预留 Meilisearch 可插拔点 | S6/D2 |
| K-06 | 榜单被刷票 | 中 | 公信力崩塌 | 单作品赞数周环比 > 10 倍 | 唯一约束、自赞排除、限流（D5）、异常检测（V2）、公式与规则公开 | S6/D4 |
| K-07 | 版权投诉 | 中 | 法律与声誉风险 | 收到第一封投诉邮件 | CREDITS 登记、上传授权条款、通知—删除流程、示例图只用自有/CC0 | S7/S8 |
| K-08 | 单人开发中断（生病/加班/倦怠） | 高 | 项目烂尾 | 连续 2 周零提交 | 阶段颗粒度 ≤ 2 周、每阶段可独立上线、README 写清"如何 1 小时恢复上下文"、里程碑留 15% 缓冲 | 全程 |
| K-09 | RLS 配错导致越权 | 中 | 严重安全事故 | 越权测试有失败项 | D5 写 12 条越权用例并纳入 CI；生产前用 `anon` 角色手工验证写操作全被拒 | D5 |
| K-10 | Supabase 免费额度休眠/超限 | 中 | 站点不可用 | 冷启动 > 3s、API 429 | 定时保活 ping；额度告警；图片走 CDN 变换减少出口流量；预算内可升 Pro | D6 |
| K-11 | 依赖许可不兼容或许可证混用 | 低 | 开源合规问题 | CI 许可扫描告警 | 白名单 + CI 黑名单拦截；`THIRD_PARTY_NOTICES` 自动生成 | S8 |
| K-12 | Pages SPA 路由 404 | 高 | 分享链接打不开 | 直接访问深层路由白屏 | `404.html` 回退 + 自定义域时改 `base`；上线 checklist 必查项 | S8 |
| K-13 | 时区/周边界 bug 导致榜单错周 | 中 | 结算错误且难察觉 | 跨周边界作品计数异常 | 全部用 `weekStartUtc/weekEndUtc` 半开区间；周边界单测覆盖跨年（ISO W53）与闰年 | S6/D4 |
| K-14 | domain 类型与 DB 漂移 | 中 | 运行时字段缺失 | 迁移后出现 `undefined` 计数 | 字段比对脚本进 CI；`mappers.ts` 单测用真实 DB 行做夹具 | D0/D3 |

### 10.7 偏差与复盘机制

| 项 | 做法 |
| --- | --- |
| 工时回填 | 每阶段结束回填「预估 / 实际」，偏差 > 30% 时在文档里写一句原因 |
| 范围控制 | 任何新增需求先进 BACKLOG，不插入当前阶段 |
| 阶段复盘 | 3 问：交付物是否可用？门禁是否全绿？下一阶段最大不确定性是什么？ |
| 架构变更 | 接口或 domain 类型变更必须记入「决策日志」并标注影响页面，S2 之后冻结 |
| 发布节奏 | Beta 前每两周一次可点开的预览部署；Beta 后每周一次 |

---

## 附录 A 待决问题（已全部拍板 ✅，2026-10-26）

| # | 问题 | 选项 | 建议 | 拍板结果 | 截止 |
| --- | --- | --- | --- | --- | --- |
| Q-1 | 站点域名 | 子域 / 独立域 / 先 Pages 默认域 | 先用 Pages 默认域，Beta 后再买 | ✅ 先用 Pages 默认域 | S8 |
| Q-2 | 是否允许匿名浏览全部内容 | 全公开 / 详情需登录 | 全公开（利于传播与 SEO） | ✅ 全公开 | S3 |
| Q-3 | 是否允许匿名评论 | 允许 / 必须登录 | 必须登录（降低灌水） | ✅ 必须登录 | S5 |
| Q-4 | 图片存储最终选型 | Supabase Storage / Cloudflare R2 + Images | Supabase Storage 先行，流量起来后迁 R2（StorageAdapter 可换） | ✅ Supabase Storage 先行 | D3 |
| Q-5 | 是否需要 PWA/离线 | 要 / 不要 | 不要（静态期数据本就在本地，PWA 收益低） | ✅ 不要 | S8 |
| Q-6 | 是否展示完整 EXIF | 全展示 / 白名单 | 白名单（机身/镜头/光圈/快门/ISO），GPS 永不展示 | ✅ 白名单 | S3 |
| Q-7 | 教程文章是否允许外部投稿 | 允许 / 暂不 | 暂不，`CONTRIBUTING.md` 只开放代码贡献 | ✅ 暂不，只开放代码贡献 | S7 |
| Q-8 | 是否需要 sitemap/RSS | 要 / 不要 | sitemap 要（成本低），RSS 不要 | ✅ sitemap 要，RSS 不要 | S8 |

## 附录 B 关键数字速查

| 指标 | 目标 |
| --- | --- |
| 静态期总工时 | 154h（约 13 周 @12h/周） |
| 动态期总工时 | 90h（约 8 周 @12h/周） |
| 合计 | 244h，约 21 周 ≈ 5 个月 |
| 首发内容量 | 80 张示例作品（全部自有或 CC0）、12 篇教程、8 个分类 |
| 榜单计算量级 | ≤ 5000 作品 / 周窗口 ≤ 20000 条互动 |
| 首屏 JS 预算 | ≤ 200KB gzip |
| 单图预算 | thumb ≤ 60KB，display ≤ 300KB |
| Lighthouse 目标 | Perf ≥ 90、A11y ≥ 95、BP ≥ 95 |
| 核心 Web Vitals | LCP ≤ 2.5s、CLS ≤ 0.1、INP ≤ 200ms |

---

**文档结束**。下一步动作：评审本文件 → 清空附录 A 待决问题 → 进入 S0，产出 `docs/DATA-MODEL.md`（把第 4 节展开为可执行的建表清单）。
