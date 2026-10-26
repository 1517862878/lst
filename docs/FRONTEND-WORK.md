# 工科影展 · 前端落地执行文档（FRONTEND-WORK）

| 项 | 内容 |
| --- | --- |
| 项目 | 工科影展（Gongke Photo Fair） |
| 文档版本 | v1.0 |
| 定稿日期 | 2026-10-26 |
| 配套文档 | `ROADMAP.md`（产品与架构决策）、`docs/architecture.svg`（五层架构图）、`docs/DATA-MODEL.md`（S2 产出） |
| 适用周期 | 第一期（纯静态前端）S0–S8，共 13 周 |
| 交付边界 | **本文只描述"前端要写什么、写成什么样、怎么验收"**，不含产品论证、数据模型定义与后端方案 |
| 维护规则 | 每阶段验收后回填「实际工时」与偏差；组件签名变更须同步本文 §3 与 §7 的影响清单 |

**一句话定位**：ROADMAP 回答"为什么这样做"，本文回答"这周具体写哪几个文件、写到什么程度算完成"。本文不重复 ROADMAP 的选型论证、字段定义与公式推导，一律以「ROADMAP §x.y」形式引用。

---

## 0. 阅读约定

### 0.1 文档边界与引用规则

| 内容 | 归属文档 | 本文处理方式 |
| --- | --- | --- |
| 为什么选 React/TanStack Query/zod | ROADMAP §1 | 只写**使用约定**（§6.1–6.4），不重述选型理由 |
| 路由清单与优先级 | ROADMAP §2 | 本文逐页拆成可执行任务，**补充**组件、状态、验收点 |
| 目录结构 | ROADMAP §3 | 本文只在 §1.1 追加**新增文件**，不重复贴树 |
| 数据模型字段 | ROADMAP §4 | 本文只引用字段名，不重新定义 |
| Mock 方案 | ROADMAP §5 | 本文在 §4 拆成**逐条实现指引**（放哪个文件、用什么技术、易错点） |
| 周榜公式与时区 | ROADMAP §6 | 本文只写前端如何调用 `domain/ranking.ts`、如何缓存与失效 |
| 分类与搜索 | ROADMAP §7 | 本文写页面交互与索引建立时机 |
| 学习板块结构 | ROADMAP §8 | 本文写页面与渲染管线 |
| 版权合规 | ROADMAP §9 | 本文只写法律页组件与部署合规（§2.21、§6.9） |
| 阶段表与工时 | ROADMAP §10.2 | 本文在 §5 拆成 13 周可验收路径 |

### 0.2 三条前端铁律（源自 ROADMAP §0.1 的落地细则）

| 编号 | 规则 | 前端落地方式 | 校验手段 |
| --- | --- | --- | --- |
| FL-1 | **类型先行** | `src/domain/types.ts` → `src/domain/schemas.ts` → `src/data/contracts/` → UI，顺序不可倒 | ESLint 规则 `no-restricted-imports`：`features/` 不得 import `domain/schemas` 之外的校验逻辑 |
| FL-2 | **组件不碰实现** | `pages/`、`features/` 只能 import `hooks/`、`domain/`、`components/`；禁止出现 `data/mock`、`data/supabase` 字样 | ESLint `no-restricted-imports` 模式匹配 `**/data/(mock\|supabase)/**` |
| FL-3 | **URL 即状态** | 搜索词、分类、排序、视图模式、页码全部进 query string；组件内部不再持有"可分享状态" | 验收：刷新页面后筛选条件不丢；复制 URL 给别人能复现同一视图 |

### 0.3 本文符号约定

| 符号 | 含义 |
| --- | --- |
| ✅ | 必须实现（DoD 内） |
| ⭕ | 计划内但可顺延（不阻塞本阶段验收） |
| ❌ | 第一期明确不做（ROADMAP §0.3） |
| `文件名` | 相对仓库根目录的路径 |
| `[ ]` | 勾选框，未勾选表示未完成 |

---

## 1. 前端骨架：第 1 周必须立起来的文件

> 对应 ROADMAP §3 目录结构与 ROADMAP §10.2 的 S1。本节只列**前端侧**新增文件，`data/`、`domain/` 部分见 ROADMAP。

### 1.1 文件落位表（S1 产出，13 周内只增不改）

| 文件 | 类型 | 职责 | 产出周 | 备注 |
| --- | --- | --- | --- | --- |
| `src/app/main.tsx` | 新增 | 挂载 React 根、注入 Providers | W1 | 唯一挂载点 |
| `src/app/router.tsx` | 新增 | 路由表 + 懒加载边界 + 守卫 | W1（骨架）/W4（全部路由） | 见 §1.3 |
| `src/app/providers.tsx` | 新增 | QueryClientProvider → ErrorBoundary → RouterProvider 顺序固定 | W1 | 顺序不能颠倒，见易错点 |
| `src/app/queryClient.ts` | 新增 | QueryClient 默认值（staleTime / retry / refetch） | W1 | 单一实例，勿在组件内 new |
| `src/app/ErrorBoundary.tsx` | 新增 | 路由级错误边界兜底 | W1 | 类组件，React 19 仍支持 |
| `src/app/ScrollToTop.tsx` | 新增 | 路由切换复位滚动位置 | W1 | 保留 query string 的回退行为 |
| `src/styles/tokens.css` | 新增 | 设计令牌（色板/字阶/间距/圆角/阴影/动效时长） | W1 | 明暗双套，`data-theme` 切换 |
| `src/styles/index.css` | 新增 | Tailwind 入口 + `@layer` 基础样式 | W1 | |
| `src/stores/prefs.ts` | 新增 | Zustand：主题、网格/瀑布流视图模式、上次看的周 | W1 | 只存偏好，禁止存服务端数据 |
| `src/stores/session.ts` | 新增 | Zustand：当前会话镜像 + 登录态派生值 | W2 | 由 `useSession()` 同步写入 |
| `src/stores/ui.ts` | 新增 | Zustand：Toast 队列、移动端导航开合 | W1 | 纯 UI 状态 |
| `src/hooks/useDebouncedValue.ts` | 新增 | 输入防抖（搜索框默认 250ms） | W2 | |
| `src/hooks/useMediaQuery.ts` | 新增 | 响应式断点判断（SSR 无关，纯 SPA） | W1 | |
| `src/hooks/useCopyToClipboard.ts` | 新增 | 复制链接/投诉模板 | W4 | 需降级到 `execCommand` |
| `src/lib/cursor.ts` | 新增 | 游标编解码（base64url + 版本前缀） | W3 | 两期协议一致 |
| `src/lib/format.ts` | 新增 | 时间/数字/文本格式化（`Asia/Shanghai`） | W3 | |
| `src/lib/id.ts` | 新增 | `crypto.randomUUID()` 封装 + 短码生成 | W2 | D-03 |
| `src/lib/bus.ts` | 新增 | `BroadcastChannel('gy')` 封装：订阅/广播/自动降级 | W6 | 见 §4.5 |
| `src/lib/storage.ts` | 新增 | localStorage 安全封装（`gy:` 前缀、JSON、异常兜底） | W2 | Safari 无痕会抛错，必须 try/catch |
| `src/lib/time.ts` | 新增 | ISO 周计算、周起止、周边界 | W7 | 跨年/闰年单测 |
| `src/lib/image/compress.ts` | 新增 | Canvas 压缩 → display/thumb | W6 | 见 §4.2 |
| `src/lib/image/exif.ts` | 新增 | EXIF 解析 + 白名单 + GPS 剥离 | W6 | 见 §4.2 |
| `src/lib/image/placeholder.ts` | 新增 | 主色占位（替代真 blurhash） | W6 | 用 16×16 缩略取均色 |
| `src/lib/search/tokenize.ts` | 新增 | 中文分词（Segmenter + bigram 兜底） | W9 | |
| `src/lib/search/index.ts` | 新增 | MiniSearch 索引建立与查询封装 | W9 | |
| `src/lib/license.ts` | 新增 | 许可枚举 → 徽标文案 / SPDX ID / 链接 | W4 | 单一映射源 |
| `src/lib/markdown.ts` | 新增 | `marked` + `DOMPurify` 渲染管线 | W10 | 白名单标签与属性 |

### 1.2 Providers 顺序（写错会导致 Query 失效或错误边界失效）

| 顺序 | 包裹层 | 说明 |
| --- | --- | --- |
| 1 | `StrictMode` | React 19 开发期双调用，用来暴露副作用 bug |
| 2 | `QueryClientProvider` | QueryClient 从 `src/app/queryClient.ts` 单例导入 |
| 3 | `ErrorBoundary`（全局） | 捕获 Provider 以下的渲染错误 |
| 4 | `BrowserRouter` / `RouterProvider` | 路由层 |
| 5 | 页面级 `ErrorBoundary` | 每个一级路由包裹，见 §6.6 |

> 易错点：把 `ErrorBoundary` 放在 `QueryClientProvider` **外面**时，Provider 自身抛错不会被捕获；把 Toast 容器放在 Router 外层时，路由切换会导致 Toast 重新挂载、动画丢失。

### 1.3 路由表与分包策略

> 路由集合与 ROADMAP §2 一致；本表补充**分包、守卫、懒加载策略**。

| 路由 | 页面文件 | 分包 | 守卫 | 懒加载方式 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `/` | `src/pages/HomePage.tsx` | 首屏（主包） | 公开 | 直接 import | 首屏 LCP 主体，勿拆 |
| `/gallery` | `src/pages/GalleryPage.tsx` | 主包 | 公开 | 直接 import | |
| `/works/:id` | `src/pages/WorkDetailPage.tsx` | 独立 chunk | 公开 | `lazy()` | |
| `/categories` | `src/pages/CategoriesPage.tsx` | 主包 | 公开 | 直接 import | |
| `/categories/:slug` | `src/pages/CategoryPage.tsx` | 独立 chunk | 公开 | `lazy()` | |
| `/search` | `src/pages/SearchPage.tsx` | 独立 chunk | 公开 | `lazy()` | 路由级加载 MiniSearch |
| `/rankings/weekly` | `src/pages/RankingPage.tsx` | 独立 chunk | 公开 | `lazy()` | 榜单 chunk 预算 ≤60KB gzip |
| `/rankings/weekly/:isoWeek` | 同上（同一文件按参数分支） | 独立 chunk | 公开 | `lazy()` | 不新开文件，减少重复 |
| `/learn` | `src/pages/LearnHomePage.tsx` | 主包 | 公开 | 直接 import | |
| `/learn/topics/:topic` | `src/pages/LearnTopicPage.tsx` | 独立 chunk | 公开 | `lazy()` | |
| `/learn/:slug` | `src/pages/ArticlePage.tsx` | 独立 chunk | 公开 | `lazy()` | |
| `/login` | `src/pages/LoginPage.tsx` | 主包 | 仅游客（已登录跳 `/`） | 直接 import | |
| `/register` | `src/pages/RegisterPage.tsx` | 主包 | 仅游客 | 直接 import | |
| `/u/:username` | `src/pages/ProfilePage.tsx` | 独立 chunk | 公开 | `lazy()` | |
| `/settings/profile` | `src/pages/SettingsProfilePage.tsx` | 独立 chunk | 登录 | `lazy()` | |
| `/publish` | `src/pages/PublishPage.tsx` | 独立 chunk | 登录 | `lazy()` | 重表单，独立包 |
| `/me` | `src/pages/MePage.tsx` | 独立 chunk | 登录 | `lazy()` | |
| `/notifications` | `src/pages/NotificationsPage.tsx` | 独立 chunk | 登录 | `lazy()` | 占位页（§2.19） |
| `/about` `/terms` `/privacy` `/copyright` `/dmca` `/licenses` `/community` | `src/pages/legal/*.tsx` | 独立 chunk（合并为一个 chunk） | 公开 | `lazy()` | 七个静态页共用一个 chunk |
| `*` | `src/pages/NotFoundPage.tsx` | 主包 | 公开 | 直接 import | |

### 1.4 守卫与重定向约定

| 场景 | 行为 | 实现位置 |
| --- | --- | --- |
| 未登录访问受保护路由 | 跳 `/login?next=<encodeURIComponent(原路径+query)>` | `src/app/router.tsx` 内 `<RequireAuth>` |
| 登录成功 | 读 `next` 参数并 `replace` 回原路径；无 `next` 回 `/` | `src/features/auth/LoginForm.tsx` |
| 已登录访问 `/login`、`/register` | 重定向到 `/` | `<GuestOnly>` |
| `next` 参数非法（外部绝对 URL） | 丢弃并回 `/` | 校验 `startsWith('/')` 且不含 `//` |

> 易错点：开放重定向（`next=https://evil.com`）是安全缺陷；`next` 必须校验后再 `navigate`。

---

## 2. 逐页前端任务拆解

> 通用规则（不再逐页重复）：
> 1. 每页必须实现**加载态 / 空态 / 错误态**三态，缺一即视为未完成（ROADMAP §2 全局约束、G-9）。
> 2. 列表分页统一用游标（`nextCursor`），组件不解析游标（ROADMAP D-02）。
> 3. 页面组件只做**编排**：取数交给 hook，交互交给 `features/` 组件，页面文件超过 250 行即拆分。
> 4. 每页导出一个默认组件，由 `src/app/router.tsx` 懒加载挂载。

---

### 2.1 首页 `/`

| 项 | 内容 |
| --- | --- |
| 路由 | `/`（`/` 与 `/index` 不共存，只保留 `/`） |
| 页面职责 | 站点门面：一句定位 + 首屏精选大图 + 本周榜 Top5 + 最新教程 + 分类入口；30 秒内让访客明白"这是工科/技术类摄影社区" |
| 需要实现的组件 | `HeroCarousel`（精选轮播）、`SectionHeading`（区块标题+更多链接）、`PhotoCard`（复用）、`PhotoGrid`（复用）、`RankingMiniList`（Top5 精简榜）、`ArticleTeaserCard`、`CategoryQuickLinks`、`DemoBanner`（复用） |
| 交互与状态 | 轮播：自动播放 5s / 悬停暂停 / 键盘 ←→ 切换 / 触摸滑动；`prefers-reduced-motion` 下关闭自动播放（ROADMAP G-7）；区块"更多"为普通 `<a>`，不做客户端跳转 |
| 数据来源（hook） | `useFeaturedPhotos({ limit: 6 })`、`useWeeklyRanking(currentIsoWeek, 'live')`（只取 Top5）、`useArticles({ limit: 3, sort: 'latest' })`、`useCategories()` |
| 加载态 | `HeroCarousel` 用 `Skeleton` 占位（宽 16:9）；榜单区用 5 行骨架行；教程区 3 张卡片骨架。**首屏不用全屏 spinner** |
| 空态 | 三条降级路径：① 无精选作品 → 显示分类入口 + "暂无精选作品"；② 当期榜单无数据 → 隐藏榜单区块（不留空框）；③ 无教程 → 展示"教程整理中"，但**不得**隐藏分类入口 |
| 错误态 | 榜单/教程区各自独立错误边界，失败只影响本区块并显示"重试"按钮；Hero 失败显示静态占位图 + 文案，页面其余部分仍可用 |
| 验收要点 | - [ ] 首屏 JS ≤ 200KB gzip（ROADMAP G-6）<br>- [ ] LCP ≤ 2.5s、CLS ≤ 0.1（轮播图片必须写死宽高比）<br>- [ ] 轮播可键盘操作，焦点可见<br>- [ ] 三区块数据互不阻塞，任一失败其余照常渲染<br>- [ ] 页面含唯一 `<h1>`，区块标题为 `<h2>` |

---

### 2.2 作品墙 `/gallery`

| 项 | 内容 |
| --- | --- |
| 路由 | `/gallery`，排序与视图模式进 query：`?sort=latest\|hot\|relevance&view=grid\|masonry` |
| 页面职责 | 全站作品总览，支持无限滚动浏览；是"发现"的主入口 |
| 需要实现的组件 | `GalleryToolbar`（排序切换 + 视图切换 + 数量统计）、`PhotoMasonry`（瀑布流）、`PhotoGrid`（等宽网格）、`PhotoCard`、`LoadMoreSentinel`（IntersectionObserver 触发）、`InfiniteScrollEnd`（到底提示）、`EmptyState`、`FilterChip` |
| 交互与状态 | 排序切换走 `setSearchParams`（FL-3）；视图模式写入 `usePrefs`（localStorage `gy:prefs`）且同步进 query；滚动加载保留"回到顶部"浮标；浏览位置用 `sessionStorage` 记录，返回时复位 |
| 数据来源（hook） | `usePhotos({ sort, cursor, limit: 24 })`（`useInfiniteQuery`），查询键 `['photos','list',query]` |
| 加载态 | 首屏 24 个 `PhotoCard` 骨架；翻页时底部 6 个骨架；骨架形状与真实卡片一致，避免布局跳动 |
| 空态 | `EmptyState` 组件：文案"还没有作品" + 按钮"发布第一张"（未登录时指向 `/login?next=/publish`）+ "去分类看看" |
| 错误态 | 首屏加载失败 → 整块错误卡片 + "重新加载"（`refetch`）；翻页失败 → 保留已加载内容，底部显示"加载失败，点击重试"，**不清空列表** |
| 验收要点 | - [ ] 无限滚动无重复、无遗漏（契约用例 C-7）<br>- [ ] 加载更多时 URL 不变化（游标不暴露给用户）<br>- [ ] 切换排序立即回到列表顶部<br>- [ ] 图片 `loading="lazy"` + 宽高比占位，CLS ≤ 0.1<br>- [ ] 键盘 Tab 顺序与视觉顺序一致 |

---

### 2.3 作品详情 `/works/:id`

| 项 | 内容 |
| --- | --- |
| 路由 | `/works/:id`；`id` 为客户端生成的 UUID（ROADMAP D-03） |
| 页面职责 | 单张作品的完整呈现：图、EXIF、地点、授权、作者、互动、评论、相关作品、相关教程、举报入口 |
| 需要实现的组件 | `PhotoViewer`（主图 + 键盘 ←→ 翻页）、`PhotoGallery`（多图横向条）、`ExifPanel`（白名单字段）、`LocationBlock`（按 `locationPrecision` 降级展示）、`LicenseBadge`、`CreditLine`、`LikeButton`、`FavoriteButton`、`ShareMenu`（复制链接/分享）、`ReportDialog`（占位）、`CommentList`、`CommentForm`、`AuthorCard`、`RelatedPhotos`、`RelatedArticles`、`Breadcrumb` |
| 交互与状态 | 点赞/收藏乐观更新（见 §4.3）；未登录点击互动 → 弹登录提示并跳转；评论仅一级回复（ROADMAP §0.3）；举报弹窗仅收集原因并本地记录（明确标注"动态期生效"）；EXIF 折叠默认收起；地点精度按 `exact/district/city/hidden` 逐级模糊 |
| 数据来源（hook） | `usePhoto(id)`（`['photo', id]`）、`useComments(photoId)`（`['comments', photoId]`）、`useProfile(authorId)`、`useToggleLike(photoId)`、`useToggleFavorite(photoId)`、`useAddComment(photoId)`、`useRelatedPhotos(photoId)` |
| 加载态 | 主图区用同尺寸灰底 + `blurhash` 主色占位（宽高已知，零跳动）；EXIF 与评论区分区骨架 |
| 空态 | ① 作品不存在 → 404 态（"作品不存在或已被作者删除" + 返回作品墙）；② 无评论 → 评论区显示"还没有评论，来说两句"；③ 无相关作品/教程 → 整个区块不渲染 |
| 错误态 | 主图加载失败 → 重试按钮 + 保留占位；评论加载失败不影响主内容；互动失败 → Toast 提示并回滚（§4.3） |
| 验收要点 | - [ ] 未知 id 显示 404 态而非空白<br>- [ ] 主图 EXIF 只展示白名单字段，**GPS 不出现在任何位置**<br>- [ ] 点赞后计数立即 +1，接口失败时回滚<br>- [ ] 未登录点击"发布"跳登录并回跳本页<br>- [ ] 键盘可切换主图，焦点环可见<br>- [ ] 详情页含 JSON-LD（`ImageObject` + `license`） |

---

### 2.4 分类总览 `/categories`

| 项 | 内容 |
| --- | --- |
| 路由 | `/categories` |
| 页面职责 | 8 个一级分类的入口页，说明每个分类的判定标准与作品数量 |
| 需要实现的组件 | `CategoryCard`（封面 + 名称 + 判定标准 + 作品数）、`CategoryGrid`、`CountBadge` |
| 交互与状态 | 整卡可点击（`<a>` 包裹，保留原生语义与右键新窗口）；无轮播、无弹窗 |
| 数据来源（hook） | `useCategories()`（`['categories']`，返回分类 + 各分类作品数） |
| 加载态 | 8 张卡片骨架（2×4 网格） |
| 空态 | 理论上不会为空（分类为种子常量）；若为空显示"分类加载失败"错误态而非空态 |
| 错误态 | 整页错误边界 + 重试 |
| 验收要点 | - [ ] 8 个分类全部渲染且顺序按 `sortOrder`<br>- [ ] 每张卡片的判定标准文案与 ROADMAP §7.1 一致<br>- [ ] 卡片有描述性 `alt`（用分类名，不用文件名）<br>- [ ] 卡片键盘可达，Enter 可跳转 |

---

### 2.5 分类作品墙 `/categories/:slug`

| 项 | 内容 |
| --- | --- |
| 路由 | `/categories/:slug`，排序进 query：`?sort=latest\|hot` |
| 页面职责 | 单一分类下的作品列表 |
| 需要实现的组件 | 复用 `PhotoGrid` / `PhotoMasonry` / `PhotoCard` / `GalleryToolbar` / `LoadMoreSentinel`；新增 `CategoryHeader`（名称 + 判定标准 + 数量） |
| 交互与状态 | 与作品墙一致；顶部提供"返回分类总览"面包屑；未知 slug → 404 |
| 数据来源（hook） | `useCategoryPhotos(slug, { sort, cursor })`（查询键 `['photos','list',{categorySlug: slug, ...}]`） |
| 加载态 | 同作品墙 |
| 空态 | "该分类下暂时还没有作品" + "看看其他分类"（列出其它 7 个分类链接） |
| 错误态 | 同作品墙 |
| 验收要点 | - [ ] 未知 slug 显示 404 而非空列表<br>- [ ] 分类名与描述与 `/categories` 完全一致（同一数据源）<br>- [ ] 切换分类时滚动位置复位到顶部 |

---

### 2.6 搜索结果页 `/search`

| 项 | 内容 |
| --- | --- |
| 路由 | `/search?q=&category=&tags=&sort=`（全部进 query，FL-3） |
| 页面职责 | 全站检索：关键词 + 分类 + 标签筛选 + 排序 + 高亮 + 无结果建议 |
| 需要实现的组件 | `SearchBar`（含防抖、历史词）、`SearchFilters`（分类单选 + 标签多选 + 地点）、`SortSelect`、`SearchResultItem`（复用 `PhotoCard` 变体）、`HighlightedText`（仅包 `<mark>`）、`SuggestedTags`、`SearchEmptyState`、`SearchLogHint` |
| 交互与状态 | 输入防抖 250ms 后写入 query（`replace`，不打爆历史）；回车立即提交；筛选变化 → 重置游标 → 回到顶部；标签点击加入筛选 chips；高亮只作用于文本节点，**禁止 `innerHTML` 拼接**（ROADMAP §7.4） |
| 数据来源（hook） | `useSearch(query)`（`['search', query]`）；索引建立由 `useSearchIndex()` 负责（懒加载 MiniSearch） |
| 加载态 | 首屏 24 项骨架 + 顶部"正在建立索引…"提示（首次进入）；后续查询显示细进度条不阻塞列表 |
| 空态 | "没有找到相关内容" + 建议动作：① 清除筛选 ② 尝试热门标签 Top20 ③ 去分类浏览 ④ 换个关键词 |
| 错误态 | 索引建立失败 → "搜索功能暂不可用" + 降级为"仅按分类浏览"链接（**不白屏**） |
| 验收要点 | - [ ] 输入停顿 250ms 后才请求（用 DevTools Network 验证）<br>- [ ] 全角 `ＮＩＫＯＮ` 与 `nikon` 结果集一致（契约 C-3）<br>- [ ] 高亮标签只包裹文本，不破坏 DOM 结构<br>- [ ] 刷新后筛选条件完整保留<br>- [ ] 搜索路由 chunk ≤ 120KB gzip |

---

### 2.7 周排行榜（当期）`/rankings/weekly`

| 项 | 内容 |
| --- | --- |
| 路由 | `/rankings/weekly` |
| 页面职责 | 展示当前自然周实时榜单：名次、变化箭头、缩略图、标题、作者、赞藏数、得分条，并公示规则 |
| 需要实现的组件 | `RankingTable`（移动端改卡片流）、`RankBadge`（前三特殊样式）、`RankChangeIndicator`（↑↓ NEW —）、`ScoreBar`（相对第一名百分比宽度，**纯 CSS**，不引图表库 ROADMAP §1.2）、`RankingWeekPicker`、`RankingRulesPanel`（折叠）、`RankingMetaBar`（更新于 / 公式版本 / 时区）、`PhotoThumb` |
| 交互与状态 | 展示 Top20（计算 Top100，ROADMAP §6.1）；周选择器切换到历史周时改路由为 `/rankings/weekly/:isoWeek`；规则面板默认折叠但**可被搜索引擎读到**（`<details>` 或 aria-expanded 按钮）；互动发生后 3 秒内刷新（见 §4.7） |
| 数据来源（hook） | `useWeeklyRanking(isoWeek, 'live')`（查询键 `['ranking', isoWeek, kind]`） |
| 加载态 | 20 行骨架行（含名次徽章占位），布局与真实行一致 |
| 空态 | 本周尚无数据 → "本周还没有作品上榜" + "去发布" + "看上周榜单" |
| 错误态 | 计算失败 → 错误卡 + "重试" + "查看规则"链接；**榜单失败不影响其余页面元素** |
| 验收要点 | - [ ] 名次唯一、无并列（ROADMAP §6.3）<br>- [ ] 得分条宽度 = `score / topScore`<br>- [ ] 页面展示公式版本号与时区 `Asia/Shanghai`<br>- [ ] 自赞自藏不增加得分（对照 §6.2 公式）<br>- [ ] 榜单页 LCP ≤ 2.5s，chunk ≤ 60KB gzip<br>- [ ] 移动端表格转为卡片列表，不出现横向滚动条 |

---

### 2.8 历史周榜 `/rankings/weekly/:isoWeek`

| 项 | 内容 |
| --- | --- |
| 路由 | `/rankings/weekly/:isoWeek`，`isoWeek` 形如 `2026-W44` |
| 页面职责 | 查看已结束周的终榜，并与上一周做名次对比 |
| 需要实现的组件 | 复用 `RankingTable` 及全部子组件；新增 `RankDiffColumn`（与上周对比的升/降/平） |
| 交互与状态 | 与当期同构，差别：**数据源为 `kind='final'`**，结果恒定、可长缓存（ROADMAP §6.5）；周选择器禁用未来周；非法 `isoWeek`（如 `2026-W99`）→ 404 |
| 数据来源（hook） | `useWeeklyRanking(isoWeek, 'final')` |
| 加载态 | 同当期 |
| 空态 | "该周没有榜单数据" + 回到当期榜 |
| 错误态 | 同当期 |
| 验收要点 | - [ ] 同一 `isoWeek` 多次访问结果完全一致（确定性）<br>- [ ] 未来周不可选<br>- [ ] 与上周对比列为"与上一周比较"，无上周数据时显示 "—"<br>- [ ] 缓存命中后秒开（localStorage `gy:rank:v1:{isoWeek}:final`） |

---

### 2.9 周榜规则说明

| 项 | 内容 |
| --- | --- |
| 路由 | 不单独占路由，作为 `/rankings/weekly` 的**折叠面板**组件（ROADMAP §6.7 UI 要素） |
| 页面职责 | 公开透明地公示评分公式、并列规则、时间窗口、结算时间、自赞处理、作弊防范 |
| 需要实现的组件 | `RankingRulesPanel`（可复用，内容通过 props 注入） |
| 交互与状态 | 默认折叠；展开时用 `<details>` 或受控 `aria-expanded`；文案硬编码在 `src/features/rankings/rules.ts` 常量中，不散落字符串 |
| 数据来源（hook） | 无（静态常量 + `formulaVersion` 来自 `useWeeklyRanking` 返回值） |
| 加载态 | 无 |
| 空态 | 无 |
| 错误态 | 无 |
| 验收要点 | - [ ] 公式、权重、并列规则、窗口时区四项齐全（ROADMAP G-9 内容完整）<br>- [ ] 文案与 `domain/ranking.ts` 的 `RANKING_WEIGHTS` 一致，升级权重时同 PR 修改<br>- [ ] 折叠状态可被爬虫读取（SSR 无关，确保 DOM 中存在文本） |

---

### 2.10 学习板块首页 `/learn`

| 项 | 内容 |
| --- | --- |
| 路由 | `/learn` |
| 页面职责 | 学习板块入口：4 个主题（拍摄技巧/器材/后期/伦理与版权）+ 最新文章 + 热门文章 |
| 需要实现的组件 | `TopicCard`（主题名 + 描述 + 篇数 + 配色块）、`TopicGrid`、`ArticleListItem`（标题 + 摘要 + 难度 + 时长 + 更新时间）、`ArticleSection`、`DifficultyBadge` |
| 交互与状态 | 主题卡跳 `/learn/topics/:topic`；文章条跳 `/learn/:slug`；整页无滚动劫持 |
| 数据来源（hook） | `useTopics()`（`['topics']`）、`useArticles({ sort: 'latest' \| 'hot', limit: 6 })` |
| 加载态 | 4 个主题卡骨架 + 6 条列表骨架 |
| 空态 | 主题恒不为空（种子常量）；文章为空 → "文章整理中，先看看主题分类" |
| 错误态 | 列表失败 → 错误卡 + 重试；主题失败不影响文章区 |
| 验收要点 | - [ ] 4 个主题与 ROADMAP §8.1 完全一致<br>- [ ] 每篇文章显示难度、阅读时长、最后更新时间<br>- [ ] 无文章时不出现空白大区块 |

---

### 2.11 主题文章列表 `/learn/topics/:topic`

| 项 | 内容 |
| --- | --- |
| 路由 | `/learn/topics/:topic` |
| 页面职责 | 单主题下的文章列表，支持难度与器材筛选 |
| 需要实现的组件 | `TopicHeader`、`ArticleFilterBar`（难度多选 + 器材单选）、`ArticleListItem`、`FilterChip`、`Pagination`（文章量小，用普通分页） |
| 交互与状态 | 筛选进 query（FL-3）；难度/器材组合筛选；空主题 → 404（主题不存在）或空态（主题存在但无匹配） |
| 数据来源（hook） | `useArticles({ topic, difficulty, equipment, page })`（`['articles', params]`） |
| 加载态 | 6 条列表骨架 |
| 空态 | "该主题下暂无符合条件的文章" + "清除筛选" + "看全部文章" |
| 错误态 | 整块错误卡 + 重试 |
| 验收要点 | - [ ] 筛选条件写入 URL，可分享<br>- [ ] 未知 topic → 404<br>- [ ] 文章按 `publishedAt` 倒序 |

---

### 2.12 教程文章 `/learn/:slug`

| 项 | 内容 |
| --- | --- |
| 路由 | `/learn/:slug` |
| 页面职责 | 单篇教程阅读：固定七段结构（摘要卡 / 你将学会 / 正文 / 常见错误 / 练习任务 / 相关作品 / 延伸阅读） |
| 需要实现的组件 | `ArticleSummaryCard`、`LearningObjectives`、`MarkdownBody`、`ArticleToc`（右侧目录锚点）、`CommonMistakes`（症状→原因→改法三列表）、`PracticeChecklist`（本地勾选）、`RelatedPhotos`、`RelatedArticles`、`ExternalLinks`、`ArticleMeta`（作者/难度/时长/版本/更新日期）、`Breadcrumb` |
| 交互与状态 | 目录锚点点击平滑滚动并更新 URL hash（`scroll-margin-top` 预留吸顶头部高度）；练习任务勾选状态存 `localStorage`（键 `gy:practice:{articleSlug}`），仅本机；正文中的参数表需横向可滚动（`overflow-x-auto`） |
| 数据来源（hook） | `useArticle(slug)`（`['article', slug]`，返回 front-matter + 渲染后的 HTML） |
| 加载态 | 正文区高度占位骨架 + 目录骨架；保持布局不跳动 |
| 空态 | slug 不存在 → 404（"文章不存在或已下线"） |
| 错误态 | 渲染失败（Markdown 净化异常）→ 显示纯文本降级版本 + 错误提示，不整页白屏 |
| 验收要点 | - [ ] Markdown 经 `DOMPurify` 净化，`<script>` / `onerror` 不执行（ROADMAP R-06）<br>- [ ] 目录锚点可跳转且不高亮遮挡<br>- [ ] 练习勾选刷新后保留<br>- [ ] 相关作品可点击进详情，形成内容闭环（ROADMAP §8.5）<br>- [ ] 显示 `version` 与最后更新日期 |

---

### 2.13 登录 `/login`

| 项 | 内容 |
| --- | --- |
| 路由 | `/login?next=` |
| 页面职责 | 演示期登录入口；提供 3 个演示账号一键填入；顶部黄色提示条声明"密码不具安全性"（ROADMAP R-12 演示模式规范第 2 条） |
| 需要实现的组件 | `LoginForm`、`DemoAccountPicker`（alice / bob / editor 三卡）、`SecurityNoticeBar`、`FormField`（复用）、`PasswordInput`（可切换明文） |
| 交互与状态 | 表单校验：账号（静态期为用户名 `^[a-z0-9_-]+$` 3–20，动态期为邮箱格式）与密码 ≥ 6 位；提交中禁用按钮并显示 spinner；失败在字段下方内联报错；成功后读 `next` 跳转 |
| 数据来源（hook） | `useSession()` → `signIn(account, password)`（内部走 `AuthAdapter`，静态期为 `data/mock/auth.ts`；动态期 `AuthAdapter.signIn(email, password)` 签名不变，页面只换字段标签） |
| 加载态 | 提交中：按钮 spinner + 表单禁用；无整页加载 |
| 空态 | 不适用 |
| 错误态 | 错误分三类文案：账号不存在 / 密码错误 / 会话过期；网络类错误提示"请稍后重试"；错误信息显示在表单顶部 + 字段内联 |
| 验收要点 | - [ ] 演示账号一键填入后可直接登录<br>- [ ] 顶部安全提示条始终可见<br>- [ ] 登录成功回到 `next` 指定的原路径<br>- [ ] 登录后刷新页面会话仍在（localStorage `gy:session`）<br>- [ ] 表单 label 与输入框 `id` 关联，错误提示用 `aria-describedby` |

---

### 2.14 注册 `/register`

| 项 | 内容 |
| --- | --- |
| 路由 | `/register` |
| 页面职责 | 创建本地账号；用户名唯一性校验；协议勾选为必选（ROADMAP §2） |
| 需要实现的组件 | `RegisterForm`、`UsernameField`（带可用性检查）、`PasswordStrengthMeter`、`AgreementCheckbox`（必须勾选用户协议与隐私政策）、`FormField`、`SecurityNoticeBar` |
| 交互与状态 | 用户名失焦后异步校验唯一性（防抖 300ms）；密码强度提示（长度 + 字符类型）；协议未勾选时提交按钮禁用并给出原因 |
| 数据来源（hook） | `useSession()` → `signUp(input)`；用户名校验用 `useCheckUsername(username)`（`['username-available', name]`） |
| 加载态 | 提交中按钮 spinner；用户名校验中在输入框右侧显示小 spinner |
| 空态 | 不适用 |
| 错误态 | 用户名已存在 → 输入框内联错误 + 焦点移到该字段；协议未勾选 → 勾选框下方错误 |
| 验收要点 | - [ ] 用户名规则 `^[a-z0-9_-]+$`、3–20 字符，前后端一致（ROADMAP §4.2）<br>- [ ] 未勾选协议无法提交<br>- [ ] 注册成功自动登录并跳转 `/`<br>- [ ] 错误提示与字段有 `aria-describedby` 关联<br>- [ ] 页面明确提示"账号与数据只保存在本机浏览器" |

---

### 2.15 个人主页 `/u/:username`

| 项 | 内容 |
| --- | --- |
| 路由 | `/u/:username`，Tab 进 query：`?tab=works\|likes\|favorites`（默认 `works`） |
| 页面职责 | 展示某位用户的资料与三个内容 Tab：TA 的作品 / TA 喜欢的 / TA 收藏的 |
| 需要实现的组件 | `ProfileHeader`（头像、昵称、用户名、简介、链接、加入日期、统计数）、`ProfileTabs`（受控 Tabs，Radix）、`PhotoCard`（复用）、`EmptyState`、`ProfileLinkList` |
| 交互与状态 | Tab 切换同步 query 并可分享；"喜欢/收藏"仅登录用户可见（未登录显示"登录后查看"）；关注按钮为 P2，第一期仅占位禁用并标注 |
| 数据来源（hook） | `useProfile(username)`（`['profile', username]`）、`useProfilePhotos(username, tab, cursor)`（`['photos','list',{authorId, tab}]`） |
| 加载态 | 头部骨架 + Tab 内容 12 个卡片骨架；切 Tab 时保留骨架不闪空 |
| 空态 | 作品为空 → "TA 还没有发布作品"；喜欢为空 → "TA 还没有喜欢的作品"；收藏为空 → "TA 还没有收藏作品"；均附"去作品墙看看" |
| 错误态 | 用户不存在 → 404；Tab 列表失败 → 该 Tab 内错误卡 + 重试（不影响头部） |
| 验收要点 | - [ ] 用户名不存在 → 404 态<br>- [ ] Tab 状态写入 URL<br>- [ ] 访客不能看到"喜欢/收藏"明细<br>- [ ] 头像有 `alt`，装饰性图标 `aria-hidden`<br>- [ ] 统计数（作品/获赞/收藏）为派生只读 |

---

### 2.16 资料设置 `/settings/profile`

| 项 | 内容 |
| --- | --- |
| 路由 | `/settings/profile`（需登录） |
| 页面职责 | 修改头像、昵称、简介、个人链接、授权偏好 |
| 需要实现的组件 | `ProfileForm`、`AvatarUploader`（复用发布页的图片管线，尺寸限制 512×512）、`LinksEditor`（≤3 条）、`LicensePreferenceSelect`、`DangerZone`（注销入口占位） |
| 交互与状态 | 头像上传复用 §4.2 管线（压缩到 512 单尺寸）；链接 ≤3 条，超出时禁用添加按钮并提示；保存后 Toast 提示并刷新 `useProfile` 缓存 |
| 数据来源（hook） | `useProfile(username)` 读取当前值；`useUpdateProfile()` 执行保存（`['profile', username]` 失效） |
| 加载态 | 读取中表单骨架 + 禁用；保存中按钮 spinner |
| 空态 | 不适用 |
| 错误态 | 保存失败保留用户输入不清空，Toast 报错并内联提示 |
| 验收要点 | - [ ] 昵称 1–30、简介 ≤160 与 schema 一致<br>- [ ] 头像保存后个人主页立即更新<br>- [ ] 离开前有未保存变更提示（`beforeunload`）<br>- [ ] 保存失败不丢用户输入 |

---

### 2.17 发布页 `/publish`

| 项 | 内容 |
| --- | --- |
| 路由 | `/publish`（需登录） |
| 页面职责 | 上传图片 → 填写元信息 → 保存草稿 / 发布；含 EXIF 自动填充与授权选择 |
| 需要实现的组件 | `UploadDropzone`（拖拽 + 点选 + 粘贴）、`UploadQueue`（多文件进度条）、`ImagePreview`（缩略 + 裁切提示）、`ExifSummary`（只读白名单字段 + "已移除 GPS"提示）、`PublishForm`（标题/心得/分类/标签/地点/授权）、`TagInput`（≤5、归一化、别名映射）、`CategorySelect`、`LicenseSelect`（4 选 1，ROADMAP §9.2 第 7 条）、`LocationPicker`（文本 + 精度档位）、`DraftBar`（草稿状态 + "继续编辑"）、`TermsCheckbox`（协议版本号存证） |
| 交互与状态 | 分步单页表单（上传区在上、信息区在下），不做多页向导；上传即压缩并预览；EXIF 自动填入机身/镜头/光圈/快门/ISO；GPS 永不写入表单；草稿每 3 秒自动存 localStorage（键 `gy:draft:{userId}`），发布成功清除；发布前校验必填项；未登录访问 → 跳登录并回跳 |
| 数据来源（hook） | `useUploadPipeline()`（压缩 + EXIF + 入库，§4.2）、`useDraft(userId)`、`usePublishPhoto()`（`create`）、`useCategories()`、`useTagSuggestions()`（热门标签 Top20） |
| 加载态 | 上传中显示每文件进度条与阶段文案（读取→解析 EXIF→压缩→入库）；发布中按钮 spinner |
| 空态 | 无草稿时正常显示空表单；`/me` 的"继续草稿"入口指向 `/publish?draft=1` |
| 错误态 | 单文件失败不影响其它文件（队列逐项状态）；配额不足（`navigator.storage.estimate()`）提示"仅本次会话有效"（ROADMAP K-03）；表单校验错误定位到具体字段并滚动聚焦 |
| 验收要点 | - [ ] 20MB 图片 5s 内完成压缩入库（ROADMAP S4 验收）<br>- [ ] 生成的 Blob 中**不含 GPS IFD**（有单测）<br>- [ ] 刷新后草稿不丢<br>- [ ] 授权选择与 `photos.license` 枚举一致，默认"保留所有权利"<br>- [ ] 标签上限 5 且自动去重/归一<br>- [ ] 未登录访问 `/publish` 跳转登录，登录后回跳并保留草稿<br>- [ ] 发布成功后 `/u/:username` 立即可见 |

---

### 2.18 我的 `/me`

| 项 | 内容 |
| --- | --- |
| 路由 | `/me`（需登录） |
| 页面职责 | 登录后的快捷入口：我的作品、我的收藏、我的草稿、资料设置、消息、退出登录 |
| 需要实现的组件 | `MeMenuList`、`MyDraftCard`、`MyPhotoRow`、`SignOutButton` |
| 交互与状态 | 卡片式入口；草稿卡显示"上次编辑 xx"并可继续编辑；退出登录需二次确认；退出后清空 Query 缓存与本地会话（但**不清空** IndexedDB 作品数据，除非用户主动"清空演示数据"） |
| 数据来源（hook） | `useMyPhotos(cursor)`、`useMyFavorites(cursor)`、`useDraft(userId)`、`useSession()` → `signOut()` |
| 加载态 | 入口卡骨架 3 个 |
| 空态 | 无草稿 → "还没有草稿" + "去发布"；无作品 → 同理 |
| 错误态 | 任一列表失败 → 该卡片内错误 + 重试 |
| 验收要点 | - [ ] 退出登录后受保护路由不可访问<br>- [ ] 退出后回到登录页<br>- [ ] 提供"清空本机演示数据"入口（二次确认，危险操作） |

---

### 2.19 消息 / 通知占位 `/notifications`

| 项 | 内容 |
| --- | --- |
| 路由 | `/notifications`（需登录） |
| 页面职责 | **占位页**：明确告诉访客"消息功能将在动态期上线"，提供入口预告与替代联系方式；不实现任何消息逻辑 |
| 需要实现的组件 | `ComingSoonPanel`（通用占位组件，图标 + 说明 + 预告时间 + 替代方案）、`NotifyPreferencePreview`（只读展示，不落库） |
| 交互与状态 | 无交互；可提供一个"提交需求"外链到 GitHub Issue |
| 数据来源（hook） | `useNotifications()` → 固定返回 `{ items: [], available: false }`（纯常量，**不查库**） |
| 加载态 | 无 |
| 空态 | 占位页本身就是"空态"，不显示"加载中" |
| 错误态 | 不适用 |
| 验收要点 | - [ ] 页面明确写出"动态期上线"与预计时间，不承诺具体日期<br>- [ ] 不出现空白页或无限 loading<br>- [ ] 页脚与导航中不出现指向"私信/关注流"的死链（ROADMAP §0.3 明确不做） |

---

### 2.20 404 与错误页

| 项 | 内容 |
| --- | --- |
| 路由 | `*` → `NotFoundPage`；各路由级错误边界 → `RouteErrorPage` |
| 页面职责 | 404：引导回首页或搜索；错误页：展示可读错误 + 重试 + 返回 |
| 需要实现的组件 | `NotFoundPage`（404 大字 + 三个出口：回首页 / 去搜索 / 回到作品墙）、`RouteErrorPage`（错误码 + 错误摘要 + "重试" + "回首页" + "复制错误信息"） |
| 交互与状态 | 错误信息包含 `errorId`（时间戳 + 随机串），便于本地排查；"复制错误信息"复制到剪贴板 |
| 数据来源（hook） | 无（路由参数可读 `useParams`） |
| 加载态 | 无 |
| 空态 | 404 本身即空态 |
| 错误态 | 错误页内若再出错，降级为纯文本最小页（不套娃 ErrorBoundary） |
| 验收要点 | - [ ] 直接访问不存在的深层路由显示 404 而非白屏（GitHub Pages 需 `404.html` 回退，见 §6.10）<br>- [ ] 错误页有"重试"且重试能真正重新拉数据<br>- [ ] 404 页提供至少两个有效出口<br>- [ ] 错误摘要不含堆栈敏感信息 |

---

### 2.21 版权与协议页组

| 路由 | 页面职责 | 需要实现的组件 | 数据来源 | 加载/空/错误态 | 验收要点 |
| --- | --- | --- | --- | --- | --- |
| `/terms` | 用户协议全文，**必须含 ROADMAP §9.2 的 8 条**（权利保留、平台许可范围、明确排除项、可撤回、权利保证、避风港、授权选择、协议版本存证） | `LegalDocument`（标题 + 版本号 + 生效日期 + 目录 + 正文）、`LegalToc`、`VersionBadge` | 静态 Markdown（`src/content/legal/terms.md`，构建期导入） | 加载：骨架段落；空：不适用；错误：整页错误卡 | - [ ] 8 条条款逐条可检索命中<br>- [ ] 版本号与 `termsVersion` 一致<br>- [ ] 正文引用用户协议版本号与发布页勾选版本一致 |
| `/privacy` | 隐私政策；**必须诚实写明数据仅存本机** | `LegalDocument`、`LocalStorageKeyTable`（键名清单表）、`DataExportHint` | 静态 Markdown | 同上 | - [ ] 列出全部 `gy:` 开头的存储键及用途（ROADMAP §4.4）<br>- [ ] 明示"清除浏览器数据即丢失"<br>- [ ] 给出导出与清除的具体操作步骤 |
| `/copyright` | 版权声明：代码 MIT / 文案 CC BY-SA / 用户作品权利归属、许可徽标含义 | `LegalDocument`、`LicenseBadge`（复用）、`LicenseMeaningTable` | 静态 Markdown | 同上 | - [ ] 明确区分"代码许可"与"用户作品许可"，不写"全部 MIT"<br>- [ ] 许可徽标含义与 `photos.license` 枚举一一对应 |
| `/dmca` | 侵权投诉：通知要素模板、处理时限、反通知、恶意投诉后果 | `DmcaTemplate`（可复制）、`CopyButton`（复用 `useCopyToClipboard`）、`IssueLink`（指向 `.github/ISSUE_TEMPLATE/dmca.yml`）、`TimelineSteps`（48h / 7 工作日） | 静态 Markdown | 同上 | - [ ] 模板可一键复制且保留换行<br>- [ ] 明确写"下架能力在动态期生效"（ROADMAP §9.4 提示）<br>- [ ] 邮箱与 Issue 两个渠道都可点 |
| `/licenses` | 依赖清单（名称/版本/许可/仓库） | `LicenseTable`、`LicenseSearchBox` | **构建期生成的 JSON**（`scripts/gen-licenses.mjs` 输出 `src/content/licenses.json`） | 加载：骨架表；空：无；错误：表格区错误 + 其余正常 | - [ ] 清单与 `pnpm-lock.yaml` 一致（CI 校验）<br>- [ ] 支持按名称/许可过滤<br>- [ ] 出现黑名单许可时 CI 失败（ROADMAP §9.7） |
| `/community` | 社区规范：允许/禁止内容、评论规范、处罚梯度 | `LegalDocument`、`EscalationTable` | 静态 Markdown | 同上 | - [ ] 处罚梯度为"提醒→隐藏→封禁"三级<br>- [ ] 举报入口链接可用 |
| `/about` | 关于本站：定位、作者、进度、演示模式声明 | `LegalDocument`、`AboutHero` | 静态 Markdown | 同上 | - [ ] 含演示模式声明（ROADMAP §9.5 README 要求同款） |

> 法律页共用组件 `LegalDocument` 与 `LegalToc`（`src/features/legal/`），七个页面共一个 chunk；目录（TOC）由构建时按 Markdown 标题自动生成，不在运行时解析。

---
## 3. 组件清单表

> 用途：建立组件库清单与验收基线。每个组件标注**层级**、**props 签名要点**、**使用页面**、**产出周**。
> 命名约定：基础组件用名词（`Button`），业务组件用 `领域+名词`（`PhotoCard`），布尔 props 以 `is/has/show` 开头，事件回调以 `on` 开头（`onSelect`）。
> 组件不得自行取数（除明确标注"数据组件"），一律通过 props 或 `hooks/` 获得数据。

### 3.1 基础组件（`src/components/ui/`，无业务语义）

| 组件 | props 签名要点 | 使用页面 | 产出周 |
| --- | --- | --- | --- |
| `Button` | `variant: 'primary'\|'secondary'\|'ghost'\|'danger'`；`size: 'sm'\|'md'\|'lg'`；`loading?: boolean`；`icon?: ReactNode`；`asChild?: boolean`；原生 `disabled`/`type` 全透传 | 全站 | W1 |
| `IconButton` | `icon: LucideIcon`；`label: string`（**必填**，用作 `aria-label`）；`size`；`loading` | 全站（点赞/收藏/关闭） | W1 |
| `Input` | `id`（必填，label 关联）；`label`；`error?: string`；`hint?: string`；`value`/`onChange` 受控；`endAdornment?: ReactNode` | 登录/注册/发布/设置/搜索 | W1 |
| `Textarea` | 同 `Input` + `maxLength?` + `showCount?: boolean` | 发布/评论/设置 | W1 |
| `Select` | `options: {value,label}[]`；`label`；`error`；`placeholder` | 发布/筛选/排序 | W1 |
| `FormField` | `id`（必填，与 `htmlFor` 关联）；`label`；`error?`；`hint?`；`required?`；`children`（控件插槽）。**只给"自定义控件"用**；`Input`/`Textarea`/`Select` 自带 label 与 error，不要再套一层，否则出现双标签 | 注册/发布/评论/设置 | W7 |
| `PasswordInput` | `value`/`onChange` 或 `...register()`；`showToggle?: boolean`（默认 true）；固定 `autoComplete="current-password"` | 登录/注册 | W7 |
| `FilterChip` | `label`；`active?: boolean`；`onClick?`；`onRemove?`（删除态显示 `×` 且 `aria-label` 含"移除"） | 搜索/作品墙/主题页 | W3 |
| `Checkbox` | `label`；`error`；`required`；受控 `checked`/`onCheckedChange` | 注册协议/发布协议/练习清单 | W1 |
| `RadioGroup` | `options`；`value`；`onValueChange` | 授权选择/精度档位 | W1 |
| `Switch` | `checked`；`onCheckedChange`；`label` | 偏好设置 | W1 |
| `Dialog` | Radix `Dialog` 封装；`open`/`onOpenChange`；`title`；`description?`；`footer?` | 举报/退出确认/演示面板 | W1 |
| `Sheet` | 移动端侧滑抽屉；同 Dialog props | 移动端导航/筛选 | W2 |
| `Tabs` | Radix `Tabs` 封装；`value`/`onValueChange`；`items`（受控） | 个人主页/设置 | W1 |
| `Tooltip` | `content`；`side`；键盘可达（焦点与 Esc） | 按钮说明 | W1 |
| `Popover` | Radix Popover；用于演示模式面板 | 页脚 | W2 |
| `Toast` | `useToast()` 全局队列；`variant: 'info'\|'success'\|'error'`；支持 `action` | 全站 | W1 |
| `Skeleton` | `variant: 'text'\|'circle'\|'rect'`；`width`/`height`；`className` | 全站加载态 | W1 |
| `EmptyState` | `icon`；`title`；`description?`；`actions?: {label,to,onClick}[]` | 所有列表页 | W1 |
| `ErrorState` | `title?`；`error?: unknown`；`onRetry?`；`errorId?` | 所有数据区 | W1 |
| `Badge` | `tone: 'neutral'\|'info'\|'success'\|'warning'\|'danger'`；`size` | 分类/难度/许可/状态 | W1 |
| `Avatar` | `src?`；`name`；`size: 32\|48\|64`；`shape: 'circle'\|'square'` | 详情/主页/评论 | W1 |
| `Card` | `as?: 'div'\|'article'\|'a'`；`interactive?: boolean` | 全站 | W1 |
| `Breadcrumb` | `items: {label,to?}[]`；末项为当前页（`aria-current="page"`） | 详情/文章/分类墙 | W2 |
| `Pagination` | `page`；`totalPages`；`onPageChange`（仅文章列表用） | 主题文章列表 | W3 |
| `Menu` | Radix DropdownMenu；`items: {label,icon?,onSelect,danger?}[]` | 个人主页/作品卡/页脚 | W2 |
| `VisuallyHidden` | `children` | 全站（图标按钮标签） | W1 |
| `Divider` | `orientation`；`label?` | 详情页/规则面板 | W1 |
| `Prose` | Markdown 正文容器样式（`className`） | 文章页 | W10 |
| `ScrollArea` | 固定高度内滚动（评论区、演示面板） | 详情页/页脚 | W4 |
| `VersionBadge` | `version: string`；`effectiveAt?: string`；渲染为 `<span>` + `title`（协议版本存证用） | 法律页 | W10 |
| `EscalationTable` | `levels: {level,trigger,action,duration}[]` | 社区规范页 | W10 |
| `TimelineSteps` | `steps: {label,time}[]`；渲染为有序列表（`48h` / `7 工作日`） | DMCA 页 | W10 |

### 3.2 布局组件（`src/components/layout/`）

| 组件 | props 签名要点 | 使用页面 | 产出周 |
| --- | --- | --- | --- |
| `Shell` | `children`；`variant: 'default'\|'wide'\|'full'`；提供最大宽度与内边距令牌 | 全站 | W1 |
| `Header` | `onOpenSearch`；`session: Session \| null`；移动端汉堡菜单 | 全站 | W1 |
| `HeaderNav` | `items: {label,to,match?}`；当前项高亮（`aria-current="page"`） | 全站 | W1 |
| `GlobalSearch` | 位于 Header 的搜索入口；`onSubmit(q)`；`onFocus` 预热索引 | 全站 | W9 |
| `Footer` | 静态链接组（关于/协议/隐私/版权/投诉/许可/社区）+ `DemoModeFooter` | 全站 | W1 |
| `DemoModeBadge` | `variant: 'footer'\|'card'`；`reason?`；固定文案"演示模式" | 页脚/卡片/登录页 | W1 |
| `MobileNav` | 抽屉式主导航；`open`/`onOpenChange` | 全站 | W2 |
| `PageHeader` | `title`；`description?`；`breadcrumbs?`；`actions?` | 列表/分类/搜索/榜单 | W2 |
| `Section` | `title`；`action?`；`dense?`；语义 `<section>` + `<h2>` | 首页/学习板块 | W1 |
| `Container` | `size: 'sm'\|'md'\|'lg'\|'full'` | 全站 | W1 |
| `RequireAuth` | `children`；`fallback?: ReactNode`；未登录跳转带 `next` | `/publish` `/settings/profile` `/me` `/notifications` | W4 |
| `GuestOnly` | `children`；已登录跳 `/` | `/login` `/register` | W4 |
| `LazyRoute` | `children: ReactNode`；`fallback: ReactNode`；包装 `Suspense` | 全站懒加载路由 | W1 |
| `ScrollToTop` | 无 props；路由变化复位滚动（`behavior: 'auto'`） | 全站 | W1 |
| `RouteErrorBoundary` | `fallback?: (error, reset) => ReactNode`；`level: 'route'\|'section'` | 每路由 / 每个首页区块 | W1 |
| `Announcer` | 路由与筛选变化时向 `aria-live` 区播报 | 全站 | W8 |
| `SkipLink` | "跳到主内容"；`targetId="main"` | 全站 | W8 |
| `NotFoundPage` | 无 props；404 大字 + 三个出口（回首页 / 去搜索 / 回到作品墙） | `*` 兜底路由 | W2 |
| `RouteErrorPage` | `error: unknown`；`onReset`；`errorId: string`；复制错误信息 | 各路由错误边界 | W2 |

### 3.3 业务组件（`src/features/*/`）

| 组件 | props 签名要点 | 使用页面 | 产出周 |
| --- | --- | --- | --- |
| `PhotoCard` | `photo: PhotoSummary`；`view: 'grid'\|'masonry'`；`showAuthor?`；`showCounts?`；`showDemoBadge?`；`onClick?` | 首页/墙/分类墙/主页/榜单 | W3 |
| `PhotoGrid` | `photos`；`columns?`；`emptyState?` | 首页/墙/分类墙/主页 | W3 |
| `PhotoMasonry` | `photos`；`columns?`；`gap?`；基于 CSS `column-count`，不使用 JS 布局库 | 作品墙/分类墙 | W3 |
| `GalleryToolbar` | `sort`；`view`；`total`；`onSortChange`；`onViewChange`（受控，写入 query / `usePrefs`） | 作品墙/分类墙 | W3 |
| `LoadMoreSentinel` | `onIntersect`；`enabled?: boolean`；`hasMore`；用 `IntersectionObserver`，`rootMargin` 提前 400px | 作品墙/分类墙/主页 | W3 |
| `InfiniteScrollEnd` | `count`；到底提示文案（如"已显示全部 80 件"） | 作品墙/分类墙 | W3 |
| `HeroCarousel` | `photos`；`interval?: number`（默认 5000）；`autoPlay`（受 `prefers-reduced-motion` 控制）；键盘 ←→；触摸滑动 | 首页 | W2 |
| `SectionHeading` | `title`；`action?: {label,to}`；渲染 `<h2>` + "更多"链接 | 首页/学习板块/榜单 | W2 |
| `ArticleTeaserCard` | `article: ArticleSummary`；主题色块 + 标题 + 摘要 + 难度 | 首页 | W9 |
| `CategoryQuickLinks` | `categories`；横向可滚动的分类快捷入口 | 首页 | W3 |
| `DemoBanner` | `variant: 'banner'\|'inline'`；复用 `DemoModeBadge` 文案 | 首页/列表页顶部 | W2 |
| `PhotoThumb` | `photo`；`size: 'thumb'\|'display'`；`priority?: boolean`（首屏 `fetchpriority="high"`） | 全站图片位 | W3 |
| `PhotoViewer` | `photos: PhotoSummary[]`；`initialIndex`；`onIndexChange`；支持键盘 ←→ 与 Esc | 作品详情 | W3 |
| `PhotoGallery` | `photos`；缩略图条 + 主图联动 | 作品详情 | W3 |
| `ExifPanel` | `exif: Record<string,unknown> \| null`；`collapsedByDefault` | 作品详情 | W3 |
| `LocationBlock` | `photo`；按 `locationPrecision` 降级显示（`hidden` 时完全不渲染坐标） | 作品详情/发布 | W3 |
| `LicenseBadge` | `license: PhotoLicense`；`size`；`href` 默认 `/copyright#license-{license}`（`PhotoLicense` 枚举：`all_rights_reserved` \| `cc_by` \| `cc_by_nc` \| `cc_by_nc_nd` \| `cc0`，对应锚点必须与版权页标题 id 一致） | 详情/发布/首页 | W4 |
| `CreditLine` | `credit?: string \| null`；示例素材显示"示例素材"标记 | 详情/卡片 | W4 |
| `LikeButton` | `photoId`；`count`；`liked`；`disabled?`；内部走 `useToggleLike` | 详情/卡片 | W6 |
| `FavoriteButton` | 同 `LikeButton` | 详情/卡片 | W6 |
| `ShareMenu` | `photoId`；`url`；复制链接 + 原生分享 | 详情 | W6 |
| `CommentList` | `photoId`；`comments`；`loading?`；`error?`；`onRetry?` | 详情 | W6 |
| `CommentItem` | `comment: Comment`；`onReply`；软删显示"该评论已删除"占位 | 详情 | W6 |
| `CommentForm` | `photoId`；`parentId?`；`onPosted`；字符数 500 | 详情 | W6 |
| `ReportDialog` | `targetType`；`targetId`；**仅收集不提交**，提示"动态期生效" | 详情/评论 | W6 |
| `RankingTable` | `entries: RankingEntry[]`；`previousEntries?`；`loading?` | 当期榜/历史榜 | W9 |
| `RankBadge` | `rank: number`；前三特殊样式 | 榜单 | W9 |
| `RankChangeIndicator` | `change: number \| null`；`null` → "NEW" | 榜单 | W9 |
| `ScoreBar` | `score`；`maxScore`；纯 CSS 宽度百分比 | 榜单 | W9 |
| `RankingWeekPicker` | `value: string`；`weeks: {isoWeek,label,kind}[]`；`onChange` | 榜单 | W9 |
| `RankingRulesPanel` | `formulaVersion`；`timezone`；文案来自常量 | 榜单 | W9 |
| `RankingMiniList` | `entries`（前 5） | 首页 | W9 |
| `SearchBar` | `value`；`onSubmit`；`onChange`；`suggestions?`；`historyKey` | 搜索页/Header | W9 |
| `SearchFilters` | `value: PhotoQuery`；`onChange` | 搜索页 | W9 |
| `HighlightedText` | `text`；`terms: string[]`；**仅包 `<mark>`，不解析 HTML** | 搜索页 | W9 |
| `SuggestedTags` | `tags`；`onSelect` | 搜索页/发布页 | W9 |
| `TopicCard` | `topic: ArticleTopic`；`count` | 学习首页 | W10 |
| `ArticleListItem` | `article: ArticleSummary`；`variant: 'list'\|'card'` | 学习首页/主题页 | W10 |
| `ArticleToc` | `headings: {id,text,level}[]` | 文章页 | W10 |
| `MarkdownBody` | `html: string`（已净化）；`className` | 文章页 | W10 |
| `CommonMistakes` | `items: {symptom,cause,fix}[]` | 文章页 | W10 |
| `PracticeChecklist` | `articleSlug`；`items: {id,text}[]`；勾选状态存本机 | 文章页 | W10 |
| `RelatedPhotos` | `photoIds: string[]` | 文章页 | W10 |
| `LoginForm` | `next?: string`；`onSuccess` | 登录页 | W4 |
| `DemoAccountPicker` | `accounts: DemoAccount[]`；`onPick` | 登录页 | W4 |
| `RegisterForm` | `onSuccess` | 注册页 | W4 |
| `UsernameField` | `value`；`onChange`；`onCheck`（异步校验） | 注册页 | W4 |
| `PasswordStrengthMeter` | `password` | 注册页 | W4 |
| `ProfileHeader` | `profile`；`isSelf`；`counts` | 个人主页 | W6 |
| `ProfileTabs` | `value`；`onValueChange`；`tabs` | 个人主页 | W6 |
| `AvatarUploader` | `value?`；`onChange(file)`；`maxSize` | 设置页/发布页 | W6 |
| `UploadDropzone` | `accept`；`multiple`；`onFiles`；`disabled` | 发布页 | W6 |
| `UploadQueue` | `items: UploadItem[]`；`onRetry`；`onRemove` | 发布页 | W6 |
| `ImagePreview` | `file`；`meta`；`onRemove` | 发布页 | W6 |
| `ExifSummary` | `exif`；`gpsStripped: boolean` | 发布页 | W6 |
| `PublishForm` | `draft`；`onSubmit`；`onSaveDraft` | 发布页 | W6 |
| `TagInput` | `value: string[]`；`onChange`；`max=5`；`suggestions` | 发布页 | W6 |
| `CategorySelect` | `value`；`onChange`；`categories` | 发布页 | W6 |
| `LicenseSelect` | `value`；`onChange`；含"保留所有权利"默认项 | 发布页 | W6 |
| `LocationPicker` | `value`；`onChange`；`precision`；`onPrecisionChange` | 发布页 | W6 |
| `TermsCheckbox` | `termsVersion`；`acceptedAt?`；`onChange` | 发布页 | W6 |
| `ComingSoonPanel` | `title`；`description`；`eta?`；`alternatives?` | 通知页 | W5 |
| `LegalDocument` | `doc: LegalDoc`（标题/版本/生效日期/目录/正文 HTML） | 七个法律页 | W10 |
| `LegalToc` | `headings`；`activeId?` | 法律页 | W10 |
| `LocalStorageKeyTable` | `rows: {key,purpose,clearable}[]` | 隐私页 | W10 |
| `DmcaTemplate` | `text`；`onCopy` | DMCA 页 | W10 |
| `LicenseTable` | `licenses: LicenseEntry[]`；`search` | 许可页 | W12 |
| `CopyButton` | `value`；`label?`；`copiedLabel?` | DMCA/详情页 | W4 |

### 3.4 组件库验收清单

| # | 检查项 | 阈值 |
| --- | --- | --- |
| C-1 | 所有交互组件可键盘操作，焦点环可见 | 100% |
| C-2 | 图标按钮均有 `aria-label` | 100% |
| C-3 | 表单控件与 label 正确关联（`htmlFor` / `id`） | 100% |
| C-4 | 明暗两套令牌下正文对比度 | ≥ 4.5:1 |
| C-5 | 基础组件无业务 import（不 import `domain` 之外的模块） | 0 例外 |
| C-6 | 业务组件不直接调用 `data/` | 0 例外 |
| C-7 | 组件可复用率（同款组件多页复用，不重复实现） | ≥ 80% |

---
## 4. 静态期 Mock 交互逐条实现指引

> 目标：把 ROADMAP §5 的方案翻译成**可照抄的文件级实现**。每条给出：放在哪个文件 / 用什么技术 / 实现要点 / 易错点。
> 贯穿原则：所有 Mock 能力必须通过 `src/data/contracts/` 的接口暴露，页面与组件**不感知** Mock 的存在（ROADMAP 铁律 L-2）。

### 4.1 登录态：伪造与持久化

| 项 | 内容 |
| --- | --- |
| 放在哪个文件 | `src/data/mock/auth.ts`（实现 `AuthAdapter`）、`src/hooks/useSession.ts`（React 侧）、`src/stores/session.ts`（Zustand 镜像）、`src/lib/storage.ts`（localStorage 封装） |
| 用什么技术 | `localStorage` + `BroadcastChannel` + TanStack Query `useQuery({ queryKey: ['session'] })` + Zustand |
| 实现要点 | ① `AuthAdapter.signIn` 校验账号/密码后从种子用户表取用户，写 `gy:session = { userId, mockToken: 'mock.'+uuid, expiresAt: ISO+7d }`；② `getSession()` 读 `gy:session`，**先判 `expiresAt`**，过期则删除并返回 `null`；③ `onChange(cb)` 订阅 `BroadcastChannel('gy')` 的 `session:changed` 消息 + `window` 的 `storage` 事件；④ `useSession()` 只做一次初始化读取，之后由 `onChange` 驱动 `queryClient.setQueryData(['session'], next)`；⑤ Zustand `stores/session.ts` 只是 `useSession()` 的镜像，供 Header/守卫同步渲染，**不作为数据真相源** |
| 易错点 | ① 不要在组件里直接读 `localStorage`（绕过缓存导致多标签不同步）；② `mock.` 前缀必须保留——ROADMAP §5.1 明确"不假装安全"，前端据此显示安全提示条；③ Safari 无痕模式下 `localStorage.setItem` 会抛 `QuotaExceededError`/`SecurityError`，`lib/storage.ts` 必须 try/catch 并返回 `null`，UI 降级为"仅当前会话"；④ 40 分钟无操作过期提示：用一个 `lastActiveAt` 心跳（监听 `pointerdown`/`keydown`/`scroll`，节流 30s 写一次）实现，不要用定时器轮询 |

**验收**：双标签页登录 A 后，B 标签页 1 秒内 Header 变为登录态；手动把 `gy:session.expiresAt` 改成过去时间，刷新后视为未登录。

---

### 4.2 图片上传：压缩 / EXIF 白名单 / GPS 剥离 / 预览

| 环节 | 文件 | 技术 | 要点 | 易错点 |
| --- | --- | --- | --- | --- |
| 文件选择与校验 | `src/features/publish/UploadDropzone.tsx` | `<input type="file">` + 拖拽 + `paste` 事件 | 校验 MIME（**仅 `image/jpeg`**）与大小（≤20MB）；`accept="image/jpeg,.jpg,.jpeg"` 显式限定 | ① `accept` 只约束文件选择器，**仍需用 MIME 二次校验**，不能只靠 `accept`；② 拒绝 PNG/WebP/HEIC 时给明确提示「仅支持 JPG/JPEG」 |
| EXIF 解析与白名单 | `src/lib/image/exif.ts` | 自己解析 JPEG APP1 段（或用 `exifr` 这类小库，需登记许可） | 只取白名单键：`Make / Model / LensModel / FNumber / ExposureTime / ISO / FocalLength / DateTimeOriginal`；**解析完成即丢弃原始 buffer** | ① 最易错：把整个 EXIF JSON 存进 `photos.exif`，等于把 GPS 存库；必须**逐键白名单**再存；② 厂商 APP1（如 Sony/Apple 的分段 EXIF）解析失败要静默降级为空，不报错 |
| GPS 剥离 | 同上 | 白名单即天然排除 | 解析后显式 `delete parsed.gpsLatitude` 等键，并断言输出对象不含任何 `gps*`/`GPS*` 键 | 单元测试必须断言：输入含 GPS 的图片，输出 `exif` 对象中 **不存在** 任何含 `gps`（不区分大小写）的键，且序列化后的 JSON 字符串中不含 GPS 数值 |
| 压缩 | `src/lib/image/compress.ts` | `createImageBitmap` → `<canvas>` → `canvas.toBlob('image/webp', q)` | 长边 >2400px 先等比缩到 2400 → `display`（WebP q0.82）；长边 >640px 缩到 640 → `thumb`（WebP q0.75）；保留原始宽高比并写入 `width/height` | ① iOS Safari 对 `createImageBitmap` 支持不稳，需回退 `new Image()` + `URL.createObjectURL`；② `toBlob` 失败时回退 `image/jpeg`；③ **必须用 `URL.revokeObjectURL` 释放**，否则长会话内存泄漏 |
| 占位主色 | `src/lib/image/placeholder.ts` | 16×16 canvas 取均色 | 生成 `#rrggbb` 作为模糊占位背景色（替代真 blurhash，ROADMAP §5.2 第 4 步） | 占位色与最终图差异大时会有"跳色"，用 `transition: background-color .3s` 缓解 |
| 入库 | `src/data/mock/repositories/storage.ts` | `idb` 包 | 键规则与 Storage 路径完全一致：`photos/{authorId}/{photoId}/display.webp`、`.../thumb.webp`（ROADMAP §5.2 第 5 步） | 键规则写死在一处常量 `STORAGE_KEY_TEMPLATE`，两期共用 |
| 预览与释放 | `src/hooks/useObjectUrl.ts` | `URL.createObjectURL` + `useEffect` 清理 | 任何 `createObjectURL` 的地方必须配对 `revokeObjectURL`；列表页用 `thumbKey`，详情页才取 `display` | 详情页来回切换多次不释放 → 内存暴涨，表现为移动端崩溃 |
| 配额检查 | `src/lib/storage.ts` | `navigator.storage.estimate()` | 上传前检查 `usage + size > quota * 0.9` 时提示；超限降级为"仅当前会话有效"（ROADMAP K-03） | 私密模式下 `estimate()` 可能不可用，需 try/catch 降级 |

**验收**：上传一张含 GPS 的手机原图 → 详情页 EXIF 面板无任何坐标；`gy-assets` 中存的 Blob 用 `exiftool`/单测断言无 GPS IFD；20MB 图片从选择到入库 ≤ 5s。

---

### 4.3 点赞 / 收藏：乐观更新与回滚

| 项 | 内容 |
| --- | --- |
| 放在哪个文件 | `src/hooks/useInteractions.ts`（`useToggleLike` / `useToggleFavorite` / `useAddComment`）、`src/data/mock/repositories/interactions.ts` |
| 用什么技术 | TanStack Query `useMutation` + `onMutate` / `onError` / `onSettled` + `queryClient.setQueryData` |
| 实现要点 | ① `onMutate` 里 `await queryClient.cancelQueries({queryKey:['photo',id]})`，随后从缓存快照算出新状态（`liked` 翻转、`likeCount ± 1`），`setQueryData` 写回；② `onError` 用 `onMutate` 保存的 `previous` 快照回滚，并 `toast.error('操作失败，已撤销')`；③ `onSettled` 无论成败都 `invalidateQueries(['photo',id])` 与 `['photos','list']`（列表页计数也要刷新）；④ **计数只在缓存里临时加减，持久化仍由数据层派生**（ROADMAP D-05）——组件不得把 `count` 写回数据库 |
| 易错点 | ① 忘记 `cancelQueries` → 并发请求返回乱序导致计数错乱；② 回滚用的是 `onMutate` 里的旧快照，不是当前值（多人同时操作时会覆盖别人的更新）；③ 连续快速点击会发出多次请求：用 `isPending` 禁用按钮，或做 300ms 节流；④ 未登录时 `onMutate` 也会改缓存——必须先判会话，否则乐观更新后再跳登录，数字对不上 |

**验收**：弱网（DevTools Slow 3G）下点赞 → 数字立即 +1；制造失败 → 数字回滚且 Toast 提示；双标签页 A 点赞，B 在 1s 内数字同步。

---

### 4.4 评论提交

| 项 | 内容 |
| --- | --- |
| 放在哪个文件 | `src/features/interactions/CommentForm.tsx`、`src/hooks/useInteractions.ts` 的 `useAddComment`、`src/data/mock/repositories/interactions.ts` |
| 用什么技术 | React Hook Form + zod（长度 1–500）、TanStack Query mutation |
| 实现要点 | ① `body` 纯文本渲染，**绝不 `dangerouslySetInnerHTML`**（ROADMAP R-06、XSS 用例）；② 提交成功后把新评论**插入列表缓存头部**（倒序列表）并 `invalidateQueries(['comments',photoId])`；③ `commentCount` 随 `photos` 缓存乐观 +1，失败回滚；④ 仅一级回复：`parentId` 只能指向顶层评论，UI 上回复按钮折叠为该评论下方的输入框 |
| 易错点 | ① 忘记把评论插入缓存 → 用户提交完看不到自己发的评论（除非强制刷新）；② 用 `innerHTML` 渲染会触发 XSS——用 `<img onerror=alert(1)>` 做用例；③ 软删评论要保留占位"该评论已删除"，不要直接过滤掉（否则计数与列表对不上） |

---

### 4.5 跨标签页同步

| 项 | 内容 |
| --- | --- |
| 放在哪个文件 | `src/lib/bus.ts`（封装）、`src/data/mock/repositories/interactions.ts`（触发点）、`src/hooks/useSession.ts`（会话事件） |
| 用什么技术 | `BroadcastChannel('gy')`；不支持时回退 `window.addEventListener('storage')` |
| 实现要点 | ① 事件名统一：`interaction:changed` / `session:changed` / `photo:published` / `draft:changed`（ROADMAP §5.3 要求事件名两期一致，动态期由 Realtime 取代）；② 消息体 `{ type, payload, at }`；③ 收到 `interaction:changed` → `invalidateQueries(['photo',payload.photoId])` + `invalidateQueries(['photos','list'])` + `invalidateQueries(['ranking',...])`；④ BroadcastChannel 不可用时（老 Safari）用 localStorage 写入一个随机 key 触发 `storage` 事件 |
| 易错点 | ① **不要自己监听自己的消息**：发送方需标记来源（如 `tabId`）或发送后本地立即失效缓存，避免双次刷新；② 事件名拼写不一致会导致"看起来不生效"，必须集中在一处常量 `GY_EVENTS`；③ 组件卸载时必须 `unsubscribe()`，否则内存泄漏 |

**验收**：两个标签页同时打开 `/works/:id`，A 点赞 → B 的计数在 1s 内变化且 A 不会闪两次。

---

### 4.6 搜索索引建立

| 项 | 内容 |
| --- | --- |
| 放在哪个文件 | `src/lib/search/index.ts`（索引）、`src/lib/search/tokenize.ts`（分词）、`src/hooks/useSearch.ts`、`src/hooks/useSearchIndex.ts` |
| 用什么技术 | MiniSearch + `Intl.Segmenter('zh-Hans')`（不可用时 bigram 兜底）+ Web Worker（数据量大时） |
| 实现要点 | ① **懒加载**：MiniSearch 通过 `await import('minisearch')` 动态引入，只在首次进入 `/search` 或搜索框获得焦点时加载（ROADMAP §7.4）；② 字段权重 `title 3 / tags 2.5 / locationName 2 / description 1 / authorName 1`；③ 归一化函数 `normalize()` **索引端与查询端必须共用同一个函数**，否则大小写/全角行为不一致（契约 C-3）；④ 索引缓存在内存 + IndexedDB 键 `gy:searchidx:{dataVersion}`，`dataVersion` 未变直接复用；⑤ 命中词高亮用 `<mark>` 包裹**文本节点**，禁止字符串拼 HTML |
| 易错点 | ① 归一化函数在索引端和查询端各写一份 → 全角查询失效；② `Intl.Segmenter` 在部分环境缺失 → 必须 bigram 兜底而不是直接报错；③ 索引构建在主线程 >150ms 会卡 UI → 超阈值移入 Worker；④ `MiniSearch` 的 `fields` 与 `searchOptions.boost` 配置要写在同一处常量，避免各处硬编码权重 |

**验收**：`/search?q=ＮＩＫＯＮ` 与 `?q=nikon` 结果集完全一致（契约 C-3）；搜索路由 chunk ≤ 120KB gzip。

---

### 4.7 周榜本地计算与缓存失效

| 项 | 内容 |
| --- | --- |
| 放在哪个文件 | `src/domain/ranking.ts`（纯函数，零依赖）、`src/hooks/useWeeklyRanking.ts`、`src/lib/rankingCache.ts`（localStorage 缓存读写） |
| 用什么技术 | 纯函数 + TanStack Query（SWR 模式）+ localStorage 缓存 |
| 实现要点 | ① `computeWeeklyRanking({photos, likes, favorites}, isoWeek, tz)` 是**纯函数**，输入输出都是数据，可单测、可放 Worker；② 缓存键 `gy:rank:v1:{isoWeek}:{kind}`，含 `computedAt`；③ 读取顺序：localStorage 命中且未过期 → **先渲染缓存**，再后台静默重算（SWR），避免白屏；④ 失效触发：任意互动 → `interaction:changed` → `invalidateQueries(['ranking',...])` + 删除 localStorage 对应键；⑤ `visibilitychange` 回到前台时，若缓存超过 60s 则重算（ROADMAP §5.4）；⑥ 已结束周用 `kind='final'`，结果恒定，缓存 TTL 可设为 `Infinity` |
| 易错点 | ① 计算里用了"当前时间" → 结果不可复现，`isoWeek` 必须由参数传入（对照 K-13 周边界 bug）；② 排序键必须全序（`score DESC → favoriteCount DESC → likeCount DESC → publishedAt ASC → id ASC`），少一个就会出现并列，破坏"名次唯一"约定；③ 自赞自藏权重为 0，**在计算时过滤**，不要在 UI 上隐藏；④ 半开区间 `[weekStartUtc, weekEndUtc)` 的边界用 `>= start && < end`，写成 `<=` 会重复计数跨周互动；⑤ `dataVersion` 变化时所有榜单缓存必须失效（否则改了作品标题榜里还是旧名） |

**验收**：契约测试覆盖跨周边界、跨年（ISO W53）、闰年；5000 作品计算 ≤ 50ms（ROADMAP S6 验收）。

---

### 4.8 演示模式角标

| 项 | 内容 |
| --- | --- |
| 放在哪个文件 | `src/components/layout/DemoModeBadge.tsx`（通用）、`src/components/layout/Footer.tsx`（固定一行声明）、`src/features/auth/SecurityNoticeBar.tsx`（登录页黄条）、`src/features/photos/PhotoCard.tsx`（卡片角标） |
| 用什么技术 | 纯组件 + CSS；文案抽到常量 `src/constants/demo.ts` |
| 实现要点 | ① 四处规范（ROADMAP §5.5 演示模式 UI 规范）：页脚固定行、登录页黄条、示例作品卡右上角"示例"角标、`/privacy` 写清键名与清除方法；② 角标不遮挡内容，用 `absolute top-2 right-2` + `pointer-events-none`；③ 示例作品判定依据是 `photo.credit` 含"示例素材"或 `photo.authorId` 属于种子用户集合（**判定逻辑写在一处**，不要在卡片里散落判断） |
| 易错点 | ① 角标加了 `pointer-events: none` 但父级设了 `pointer-events: auto`，卡片点击被吞；② 页脚固定行用 `position: fixed` 会遮挡移动端底部内容 —— 用普通文档流 + `sticky` 或留出 `padding-bottom`；③ 忘记在 `/privacy` 列出实际存储键，隐私页与实际实现不一致是合规风险 |

---

### 4.9 其他 Mock 能力速查（照 ROADMAP §5 补齐）

| 能力 | 文件 | 要点 | 易错点 |
| --- | --- | --- | --- |
| 种子数据 | `src/data/mock/seed.ts` | 10 用户 / 80 作品 / 300 互动 / 12 文章大纲；全部通过同一份 zod 校验 | 种子数据未过 zod → 后续类型错误难定位 |
| IndexedDB 封装 | `src/data/mock/db.ts` | `gy-db`（实体表）与 `gy-assets`（图片 Blob）两个库；版本迁移写 `onupgradeneeded` | 迁移函数写成非幂等 → 老用户数据打不开 |
| 数据版本 | `gy-db._meta.dataVersion` | 每次写入自增；搜索索引与榜单缓存据此失效 | 只在部分写操作自增 → 缓存不失效 |
| 草稿持久化 | `src/hooks/useDraft.ts` | localStorage `gy:draft:{userId}`；3 秒自动保存 | 不区分用户 → 换账号看到别人的草稿 |
| 举报占位 | `src/features/interactions/ReportDialog.tsx` | 只收集本地记录 + 提示"动态期生效" | 做成真的"已提交"会误导用户 |

---

## 5. 每周开发任务清单（13 周）

> 与 ROADMAP §10.2 的 S0–S8 对齐；每阶段的**范围、交付物、验收标准**以 ROADMAP 为准，本节只补充**"这周写哪些页面与组件 + 从哪个 URL 验收"**。
> 工时按 ROADMAP §10.1 的 12 小时/周基线，阶段留 15% 缓冲（缓冲不计入下表工时）。

| 周 | 阶段 | 本周必须写完的页面 | 本周必须写完的组件 | 本周关键任务（非页面） | 工时 | 当周可验收路径（URL） |
| --- | --- | --- | --- | --- | --- | --- |
| W1 | S0+S1 | `/`（静态骨架）、`/_dev/ui`（组件画廊） | `Button` `Input` `Select` `Checkbox` `Dialog` `Tabs` `Toast` `Skeleton` `EmptyState` `ErrorState` `Badge` `Avatar` `Card` `Shell` `Header` `Footer` `Section` `Container` `LazyRoute` `ScrollToTop` `RouteErrorBoundary` | 脚手架初始化（Vite+TS+ESLint+Prettier+Vitest）；设计令牌（明暗双套）；Providers 顺序；QueryClient 单例；CI 跑通 | 8h(S0)+6h(S1) | `http://localhost:5173/`（骨架）、`/_dev/ui`（组件画廊，明暗切换、键盘可达） |
| W2 | S1+S2 | `/`（接数据骨架） | `Skeleton` 变体、`Breadcrumb` `Menu` `Sheet` `Popover` `Tooltip` `MobileNav` `PageHeader` | `domain/types.ts` 全量实体与枚举；zod schema；8 分类种子；`lib/storage.ts` `lib/id.ts` `lib/format.ts`；`stores/prefs.ts` `stores/session.ts` `stores/ui.ts`；`hooks/useDebouncedValue` `useMediaQuery` | 10h(S1)+6h(S2) | `/`（令牌与导航生效）、`/settings/profile` 路由占位返回 404 态正确 |
| W3 | S2 | 无新页面 | 无新组件 | 仓储接口 `data/contracts/`；IndexedDB 封装 `data/mock/db.ts`；mock 仓储实现；seed 数据；契约测试骨架跑通 | 8h(S2) | 无 UI 验收；验收＝`pnpm test:contract` 全绿 |
| W4 | S2+S3 | `/categories` `/gallery`（列表） | `PhotoCard` `PhotoGrid` `PhotoMasonry` `PhotoThumb` `GalleryToolbar` `LoadMoreSentinel` `EmptyState` | `hooks/usePhotos` `useInfiniteQuery` 接入；`lib/cursor.ts` 游标编解码；`useRequireAuth` `RequireAuth` `GuestOnly`；路由守卫与 `next` 回跳 | 6h(S2)+6h(S3) | `/categories`（8 分类 + 数量）、`/gallery`（无限滚动，无重复项） |
| W5 | S3 | `/works/:id` `/categories/:slug` | `PhotoViewer` `PhotoGallery` `ExifPanel` `LocationBlock` `LicenseBadge` `CreditLine` `AuthorCard` `RelatedPhotos` `Breadcrumb` | 详情页数据装配；EXIF 白名单读取；地点精度降级；404 态与错误边界；`lib/license.ts` | 8h(S3) | `/works/{seedId}`（EXIF 白名单、无 GPS、相关作品）、`/categories/street` |
| W6 | S3+S4 | `/works/:id`（互动区） | `LikeButton` `FavoriteButton` `ShareMenu` `CommentList` `CommentItem` `CommentForm` `ReportDialog` | `hooks/useInteractions`（乐观更新 + 回滚）；`lib/bus.ts` 跨标签同步；`useCopyToClipboard`；评论 XSS 用例 | 6h(S3)+6h(S4) | `/works/{seedId}`（点赞回滚、评论渲染、`<img onerror>` 不执行） |
| W7 | S4 | `/login` `/register` | `LoginForm` `DemoAccountPicker` `RegisterForm` `UsernameField` `PasswordStrengthMeter` `SecurityNoticeBar` `FormField` `CopyButton` | `data/mock/auth.ts` 伪造会话；`useSession` + `BroadcastChannel` 会话同步；40 分钟无操作过期；`useCheckUsername` | 10h(S4) | `/login`（演示账号一键填入 + 顶部黄条）、`/register`（用户名唯一性 + 协议必选） |
| W8 | S4 | `/publish` `/settings/profile` | `UploadDropzone` `UploadQueue` `ImagePreview` `ExifSummary` `PublishForm` `TagInput` `CategorySelect` `LicenseSelect` `LocationPicker` `TermsCheckbox` `AvatarUploader` `ScrollArea` | `lib/image/*`（压缩 + EXIF + GPS 剥离 + 占位色）；`useUploadPipeline`；`useDraft` 自动保存；配额检查 | 12h(S4) | `/publish`（上传 → 预览 → 填表 → 存草稿 → 发布），刷新后草稿仍在 |
| W9 | S4+S5 | `/u/:username` `/me` | `ProfileHeader` `ProfileTabs` `ProfileLinkList` `MeMenuList` `MyDraftCard` `SignOutButton` | 个人主页三 Tab；"喜欢/收藏"仅登录可见；退出登录清缓存；`/notifications` 占位页 `ComingSoonPanel` | 4h(S4)+8h(S5) | `/u/alice`（三 Tab）、`/me`（草稿继续）、`/notifications`（占位说明） |
| W10 | S5+S6 | `/search` | `SearchBar` `SearchFilters` `SortSelect` `HighlightedText` `SuggestedTags` `SearchResultItem` | `lib/search/*`（MiniSearch + 分词 + bigram 兜底）；`useSearch` `useSearchIndex`；高亮只包 `<mark>` | 8h(S5)+6h(S6) | `/search?q=山`（相关度排序 + 高亮）、`/search?q=ＮＩＫＯＮ`（与 `nikon` 结果一致） |
| W11 | S6 | `/rankings/weekly` `/rankings/weekly/:isoWeek` | `RankingTable` `RankBadge` `RankChangeIndicator` `ScoreBar` `RankingWeekPicker` `RankingRulesPanel` `RankingMetaBar` `RankingMiniList` | `domain/ranking.ts` 纯函数；`useWeeklyRanking`；`lib/rankingCache`；`lib/time.ts` ISO 周计算；首页接入 Top5 | 12h(S6) | `/rankings/weekly`（Top20 + 名次变化 + 规则面板）、`/rankings/weekly/2026-W43`（与上周对比） |
| W12 | S6+S7 | `/learn` `/learn/topics/:topic` `/learn/:slug` | `TopicCard` `TopicGrid` `ArticleListItem` `ArticleFilterBar` `ArticleToc` `MarkdownBody` `CommonMistakes` `PracticeChecklist` `RelatedPhotos` `ArticleMeta` `Prose` `LegalDocument` `LegalToc` `LocalStorageKeyTable` `DmcaTemplate` `LicenseTable` | `lib/markdown.ts`（marked + DOMPurify）；12 篇文章内容；法律页 Markdown 转 HTML（构建期）；`/licenses` 依赖清单脚本 | 8h(S6)+4h(S7) | `/learn`（4 主题）、`/learn/topics/technique`（筛选进 URL）、`/learn/composition-basics`（目录锚点 + 练习勾选 + 相关作品）、`/terms` `/privacy` `/copyright` `/dmca` `/licenses` `/community` |
| W13 | S7+S8 | 全部页面收尾 | `Announcer` `SkipLink` | 许可证与合规文件；`ci.yml`/`deploy.yml`；Pages 上线（`base` + `404.html`）；无障碍修复；性能收尾；E2E 三条主链路 | 4h(S7)+8h(S8) | 线上 `https://<user>.github.io/<repo>/works/{id}` 直接可打开（验证 SPA 回退） |

### 5.1 每周例行节奏（ROADMAP §10.1）

| 时点 | 时长 | 动作 |
| --- | --- | --- |
| 周一 | 30min | 确认本周任务清单，更新本文 §5 表的"本周必须写完"列 |
| 周三 | 30min | 自测本周可验收路径（把 URL 逐个点一遍），记录偏差 |
| 周日 | 1h | 阶段验收 + 回填实际工时（偏差 >30% 写一句原因） |

### 5.2 里程碑与工时对照

| 里程碑 | 所在周 | 前端侧验收物 |
| --- | --- | --- |
| M1 数据层定稿 | W3 末 | 契约测试全绿；`domain/` 零 React 依赖 |
| M2 核心闭环可用 | W9 末 | 浏览→点赞评论→发布→个人主页可见→搜索→周榜 全链路可点 |
| M3 Beta 上线 | W13 末 | 线上站点可访问；三条 E2E 绿；README 陌生人 10 分钟跑起来 |

---

## 6. 前端质量与规范

### 6.1 TypeScript 约定

| 项 | 规则 |
| --- | --- |
| 严格度 | `strict: true` + `noUncheckedIndexedAccess: true` + `exactOptionalPropertyTypes: true`（ROADMAP §1.2） |
| 禁 `any` | ESLint `@typescript-eslint/no-explicit-any: error`；确需动态值用 `unknown` + zod 解析 |
| 禁 `!` 非空断言 | 除非有前置条件注释说明（`// eslint-disable-next-line` 需写理由） |
| 类型来源 | 实体类型只在 `src/domain/types.ts` 定义；DTO 只在 `src/data/contracts/` 定义；**组件不得重复定义实体形状** |
| 枚举 | 全小写 + 下划线，与 DB 值完全一致（ROADMAP D-06） |
| 导入 | `import type` 用于纯类型导入；路径别名 `@/` → `src/`（`vite.config.ts` + `tsconfig.paths` 同步配置） |
| 时间 | 一律 ISO-8601 UTC 字符串，禁止 `Date` 对象穿透到组件（ROADMAP §4.5） |

### 6.2 Zustand 约定（只管客户端状态）

| 规则 | 说明 |
| --- | --- |
| 存什么 | 会话镜像、主题、视图模式、上次查看的周、UI 开关、Toast 队列 |
| 不存什么 | **服务端数据一律不进 Zustand**（列表、详情、榜单、评论、搜索结果全归 TanStack Query） |
| 持久化 | 只有 `stores/prefs.ts` 用 `persist` 中间件，键 `gy:prefs`；其余 store 不持久化 |
| 写操作 | 组件里禁止 `setState` 式直接改会话；统一 `useSession()` 驱动 |
| 选择器 | 一律用细粒度选择器（`usePrefs(s => s.viewMode)`），避免整店订阅导致的无关重渲染 |

### 6.3 TanStack Query 约定

| 项 | 约定 |
| --- | --- |
| QueryClient 单例 | 导出自 `src/app/queryClient.ts`，**禁止在组件内 new** |
| 查询键 | 统一数组形式，实体打头：`['photo', id]`、`['photos','list',query]`、`['comments',photoId]`、`['ranking',isoWeek,kind]`、`['session']`、`['articles',params]`、`['search',query]` |
| `staleTime` | 静态期统一 `30_000`；`['session']` 设 `Infinity`（由事件驱动失效）；`['ranking',week,'final']` 设 `Infinity` |
| `gcTime` | 默认 `5min`；`final` 榜单可设 `Infinity` |
| 重试 | `retry: 1`（避免静态期 404 反复重试）；`['photo',id]` 找不到时 `retry: false` |
| 占位数据 | `placeholderData: keepPreviousData` 用于分页/筛选切换，避免闪空 |
| 乐观更新 | 只用于互动（赞/藏/评），模式见 §4.3；**发布、删除不走乐观更新** |
| 失效 | 写操作后 `invalidateQueries` 精确到 key，不使用 `invalidateQueries()` 全清 |
| 变更 | `onMutate/onError/onSettled` 三段齐全，回滚快照必须保存 |

### 6.4 React Hook Form + zod 约定

| 项 | 约定 |
| --- | --- |
| schema 归属 | zod schema 放 `src/domain/schemas.ts`，与类型同源（`z.infer`）；**表单页不本地另写校验规则** |
| 字段注册 | `useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) })` |
| 错误展示 | `formState.errors` 映射到 `Input` 的 `error` prop；同时设置 `aria-invalid` 与 `aria-describedby` |
| 提交 | `handleSubmit` 内只调用 mutation；成功后 `reset()` + Toast；失败保留输入不清空 |
| 触发时机 | 用户名校验用 `mode: 'onBlur'`；密码强度实时用 `mode: 'onChange'`（仅强度条，不报错） |
| 长度限制 | 长度上限与 DB `check` 约束写同一个数字（ROADMAP §4.1） |

### 6.5 命名与目录约定

| 类型 | 规则 | 示例 |
| --- | --- | --- |
| 文件名 | 组件用 PascalCase；hook 用 `useXxx.ts`；工具用 camelCase；类型文件用小写 | `PhotoCard.tsx`、`useWeeklyRanking.ts`、`rankingCache.ts`、`types.ts` |
| 组件名 | 与文件名一致，一个文件一个主组件 | `PhotoCard.tsx` → `export function PhotoCard()` |
| Hook 名 | 必须以 `use` 开头；返回对象时字段顺序固定（`data`/`error`/`isLoading`/`isFetching`/`refetch`） | `usePhotos()` |
| 查询键 | 常量集中在 `src/hooks/queryKeys.ts`，禁止各处硬编码字符串数组 | `queryKeys.photo(id)` |
| 事件 props | `on` 前缀 + 动词 | `onSelect`、`onRetry`、`onFiles` |
| 布尔 props | `is` / `has` / `show` 前缀 | `isLoading`、`showDemoBadge` |
| 事件类型 | 统一 `type XxxEvent = ...` 命名，不写 `any` | `type PhotoCardClickEvent` |
| 目录 | 一个 feature 一个目录：`components/` `hooks/` `types.ts` `constants.ts` | `src/features/rankings/` |
| CSS | 只用 Tailwind 原子类；确需自定义写在 `src/styles/` 并加 `@layer components` | — |

### 6.6 错误边界

| 层级 | 位置 | 行为 |
| --- | --- | --- |
| 全局 | `src/app/ErrorBoundary.tsx`（包住 Provider 以下全部） | 渲染 `RouteErrorPage` 最小版本，含"刷新页面"与"回首页" |
| 路由级 | 每个一级路由外层 | 页面级崩溃只影响该路由，导航仍可用 |
| 区块级 | 首页各区块、详情页评论/EXIF 区 | 单区块失败不影响同页其它内容；提供"重试"按钮 |
| 兜底 | 错误页自身再出错 | 降级为纯文本最小页，不套娃 |

**约定**：错误信息展示给用户时**不含堆栈**；错误日志用 `console.error` + 错误 ID（时间戳 + 随机串）；生产构建 0 console error（ROADMAP G-8）。

### 6.7 加载骨架规范

| 规则 | 说明 |
| --- | --- |
| 形状一致 | 骨架与真实内容**同尺寸、同行数**，避免加载完成时布局跳动（CLS ≤ 0.1） |
| 不用全屏 spinner | 列表页用行/卡骨架；仅"提交中"用按钮内 spinner |
| 图片骨架 | 图片骨架用与目标图同宽高比的容器（已知 `width/height`），内部铺占位主色 |
| 首屏特殊 | 首屏图片用 `fetchpriority="high"`，非首屏一律 `loading="lazy"` |
| 数量规则 | 列表首屏骨架数 = 实际请求条数（24）；翻页骨架 6 条 |

### 6.8 空态组件规范

| 规则 | 说明 |
| --- | --- |
| 三要素 | 图标/插画 + 一句说明 + **至少一个可执行的下一步动作** |
| 禁止白屏 | 任何列表为空时必须渲染 `EmptyState`（ROADMAP G-9） |
| 分类 | 首次为空（无数据）/ 筛选为空（可清除）/ 权限受限（可登录）三种文案不同 |
| 组件 | 统一用 `EmptyState`（`icon` + `title` + `description` + `actions`），不各页手写 |
| 动作 | 用 `to`（路由）或 `onClick`（行为），由 `EmptyState` 内部决定渲染 `<a>` 或 `<button>` |

### 6.9 无障碍要点（对应 ROADMAP G-7）

| 领域 | 要求 |
| --- | --- |
| 语义结构 | 每页唯一 `<h1>`；区块 `<h2>`；列表用 `<ul>/<li>` 或 `<ol>`；表单项用 `<form>` + `<label for>` |
| 键盘 | 全站可 Tab 到达；`Dialog`/`Sheet` 焦点陷阱与 Esc 关闭；`PhotoViewer` 支持 ←→；`SkipLink` 跳主内容 |
| 焦点 | 焦点环可见（`:focus-visible`，对比度 ≥ 3:1）；跳转后焦点移到新内容标题 |
| 图片 | 缩略图 `alt` 写作品标题；装饰图 `alt=""`；头像 `alt` 写用户名 |
| 动态内容 | 筛选/搜索结果变化用 `aria-live="polite"` 播报"共 N 个结果"；Toast 用 `role="status"`；错误用 `role="alert"` |
| 对比度 | 正文 ≥ 4.5:1，大字与图形 ≥ 3:1；明暗两套令牌都测 |
| 动效 | 尊重 `prefers-reduced-motion`：关闭轮播自动播放与平滑滚动 |
| 表单 | 错误用 `aria-describedby` 关联到字段；必填项用 `required` + `aria-required` |
| 图表 | 榜单得分条附带文本数值（`aria-label` 或相邻文本），不靠颜色单独传达信息 |
| 颜色 | 分类/难度不只用颜色区分，必须有文字标签 |

### 6.10 GitHub Pages 部署注意事项

| 问题 | 做法 | 验证 |
| --- | --- | --- |
| **base 路径** | `vite.config.ts` 设 `base: '/<仓库名>/'`；用 `import.meta.env.BASE_URL` 作为路由 `basename`（`createBrowserRouter([{ path:'*', element:... }])` 配合 `basename` 参数） | 线上刷新后 CSS/JS 不 404 |
| **SPA 404 回退** | 构建后把 `dist/index.html` 复制为 `dist/404.html`（`vite.config.ts` 的 `closeBundle` 钩子或 `scripts/postbuild.mjs`） | 直接访问 `https://<user>.github.io/<repo>/works/xxx` 显示 SPA 而非 GitHub 404 |
| **自定义域名** | `public/CNAME` 放域名，同时把 `base` 改为 `/` | 两种情况都要有构建分支（可用 `VITE_BASE` 环境变量区分） |
| **路由匹配** | 用 `createBrowserRouter` 的 `basename`，不要手写 `window.location.pathname` 判断 | 带 `base` 的深层链接可直接打开 |
| **静态资源路径** | `public/` 下的文件（`robots.txt` `sitemap.xml` `og` 图）用绝对路径 `/<repo>/xxx` 或 `import.meta.env.BASE_URL` 拼接 | 浏览器 Network 无 404 |
| **缓存** | `dist/assets/*` 文件名带 hash，GitHub Pages 默认长缓存；`index.html` 不缓存 | 更新后强制刷新可见 |
| **CI 校验** | `ci.yml` 里加一步：检查 `dist/404.html` 存在、`dist/index.html` 中资源路径含 base 前缀 | PR 里拦住配置遗漏 |
| **本地预览** | 本地用 `vite preview` 验证 404 回退（`vite preview` 会用 `404.html`） | 部署前先本地验一遍 |
| **CSP/安全头** | GitHub Pages 不支持自定义响应头，静态期不设 CSP；动态期迁到 Cloudflare Pages 再加（ROADMAP D5/D6） | 文档中注明限制 |

### 6.11 其它规范速查

| 项 | 约定 |
| --- | --- |
| 图片 | 列表用 `thumb`（≤640px，≤60KB），详情用 `display`（≤2400px，≤300KB）；`width`/`height` 必写防 CLS |
| 路由分包 | 每个一级路由一个 `lazy()` chunk；单路由 chunk ≤ 120KB gzip，榜单 ≤ 60KB |
| 首屏体积 | JS ≤ 200KB gzip（CI 拦截） |
| 图表 | **不引图表库**，榜单用 CSS 宽度条（ROADMAP §1.2） |
| 控制台 | 生产构建 0 console error/warning |
| 第三方依赖 | 新增依赖须在 PR 说明"为什么不能自己写 20 行"；许可须在白名单内（ROADMAP §9.7） |
| 测试 | `domain/` `lib/` 覆盖率 ≥ 80%；`data/mock` ≥ 70%（ROADMAP G-2） |
| E2E | 三条主链路：浏览→互动；注册→发布→主页可见；搜索→周榜→教程（ROADMAP G-4） |

---
## 7. 第二期做动态时要改哪些前端文件

> 结论先行：**动态期前端只改 8 个文件、约 260 行**，页面、组件、路由、样式一律不改。
> 依据：ROADMAP 的「仓储接口 + 双适配器」（D-01）与「数据层可插拔」架构（`docs/architecture.svg`）。本文逐条给出**确切的文件、确切改什么、为什么**。

### 7.1 必改文件清单（共 8 个）

| # | 文件 | 改什么 | 规模 | 为什么改 |
| --- | --- | --- | --- | --- |
| 1 | `src/data/index.ts` | 工厂函数按 `import.meta.env.VITE_DATA_SOURCE` 选择 `mock` 或 `supabase` 实现；两者返回**同一组接口** | ~20 行 | 唯一的环境分支点（ROADMAP D-01） |
| 2 | `src/data/supabase/client.ts`（新建） | 创建 Supabase 客户端（`createClient(url, anonKey)`）；`url`/`anonKey` 来自 `import.meta.env.VITE_SUPABASE_*` | ~15 行 | 动态期唯一新增的基础设施 |
| 3 | `src/data/supabase/auth.ts`（新建） | 实现 `AuthAdapter`：邮箱注册/登录/验证、GitHub OAuth、密码重置、注销 | ~120 行 | 静态期 `mock/auth.ts` 是伪造会话，动态期要换成真实 Auth |
| 4 | `src/data/supabase/repositories/photos.ts`（新建） | 实现 `PhotoRepository`：list（keyset 游标）、get、create、update、remove | ~150 行 | 静态期读 IndexedDB，动态期读 Postgres |
| 5 | `src/data/supabase/repositories/interactions.ts`（新建） | 实现 `InteractionRepository`：toggleLike、toggleFavorite、listComments、addComment | ~80 行 | 写入从 IndexedDB 换成 Postgres + RLS |
| 6 | `src/data/supabase/repositories/ranking.ts`（新建） | 实现 `RankingRepository.getWeekly` → 调只读 RPC `get_weekly_ranking` | ~30 行 | 榜单从本地计算换成服务端快照 |
| 7 | `src/data/supabase/repositories/storage.ts`（新建） | 实现 `StorageAdapter`：put（上传到 Storage 桶）、url（公开/签名 URL）、remove | ~60 行 | 图片从 IndexedDB Blob 换成 Storage + CDN |
| 8 | `src/data/supabase/mappers.ts`（新建） | snake_case → camelCase 映射（`cover_key→coverKey`、`iso_week→isoWeek`、`created_at→createdAt`）；枚举值两端一致故无需值转换 | ~60 行 | 隔离 DB schema（ROADMAP D-06/D-07） |

### 7.2 可能需要改的文件（视动态期功能范围）

| # | 文件 | 改什么 | 触发条件 | 规模 |
| --- | --- | --- | --- | --- |
| 9 | `src/domain/types.ts` | **仅当**发现 DB 字段确需新增时才动；改动需同步 zod schema 并回填 DATA-MODEL | 有新字段需求 | ~10 行 |
| 10 | `src/hooks/useWeeklyRanking.ts` | 当期榜从"本地计算"切到"读服务端快照"时，**queryKey 与返回结构不变**，只可能在 `refetchInterval` 上从"事件驱动"改为"60s 轮询兜底" | D4 完成 | ~5 行 |
| 11 | `src/features/rankings/useRealtimeRanking.ts`（新建） | Realtime 订阅 `weekly_rank_entries` 变更，事件名仍为 `interaction:changed` 语义（ROADMAP §5.3） | 需要实时推送 | ~40 行 |
| 12 | `src/features/notifications/NotificationsPage.tsx` | 把 `ComingSoonPanel` 占位换成真实列表 | D5 之后 | ~80 行 |
| 13 | `src/hooks/useSession.ts` | **零改动**（`AuthAdapter.onChange` 契约不变）；仅在需要 token 刷新时于适配器内部处理 | 不会改页面 | 0 |
| 14 | `src/features/publish/UploadDropzone.tsx` | 压缩与 EXIF 剥离逻辑**保留在前端**（体验与隐私），只把最终 Blob 交给 `StorageAdapter.put` | D3 完成 | ~10 行 |
| 15 | `src/app/queryClient.ts` | 调整 `staleTime` / `retry`（真实网络需要更保守的 retry 与更长 staleTime） | 性能调优 | ~5 行 |
| 16 | `src/features/legal/*.tsx` | 隐私政策文本更新（本机存储 → Supabase 区域存储）、DMCA 流程改为真下架 | D5/D6 | 文案为主 |

### 7.3 **明确不会改**的文件（改动量为零）

| 类别 | 文件范围 | 为什么不变 |
| --- | --- | --- |
| 全部页面 | `src/pages/**`（22 个页面文件） | 页面只调用 `hooks/`，不感知数据来源（ROADMAP 铁律 L-2） |
| 全部业务组件 | `src/features/**`（除 §7.2 提到的 3 个） | 组件只接收 props 或 hook 返回值 |
| 全部基础组件 | `src/components/ui/**`、`src/components/layout/**` | 无业务语义，无数据依赖 |
| 全部 hooks（除榜单轮询） | `src/hooks/usePhotos` `usePhoto` `useComments` `useProfile` `useArticles` `useSearch` `useSession` … | 查询键、返回结构、错误语义由接口契约冻结（ROADMAP §1.6 第 3 步） |
| 领域层 | `src/domain/**`（types / schemas / ranking / categories / permissions） | 纯函数、零依赖；`computeWeeklyRanking` 变为服务端逻辑后仍保留，作为**校验对照**（D4 要求终榜与前端计算逐条一致） |
| 路由与守卫 | `src/app/router.tsx`、`RequireAuth`、`GuestOnly` | `AuthAdapter` 接口不变，`RequireAuth` 零改动（ROADMAP D-01 表格） |
| 工具库 | `src/lib/**`（除 `rankingCache` 可弃用） | 压缩、分词、格式化等纯前端能力 |
| 样式与令牌 | `src/styles/**` | — |
| 静态资源 | `public/**`（除 `CNAME`） | — |

### 7.4 为什么改动量极小（四条机制）

| 机制 | 作用 | 体现 |
| --- | --- | --- |
| **接口冻结** | `data/contracts/` 的方法签名在 S2 冻结，S2 之后改动需记入决策日志（ROADMAP §10.7） | 适配器实现差异被完全吸收在接口之下 |
| **依赖方向单向** | `pages → features → hooks → services → contracts → adapters`；`domain` 不依赖任何上层；适配器之间互不引用 | 换适配器不影响任何上层 |
| **ESLint 强约束** | `no-restricted-imports` 禁止 `pages/` `features/` 出现 `data/mock` `data/supabase` 字样 | 架构纪律由工具保证，不靠人自觉 |
| **契约测试同跑** | 同一份用例同时跑 mock 与 supabase（ROADMAP §7.6 的 C-1~C-8） | 语义漂移在 CI 就被拦下，不会带进生产 |

### 7.5 动态期前端的额外准备（静态期就要埋好的钩子）

| 准备项 | 静态期就要做 | 动态期收益 |
| --- | --- | --- |
| `VITE_DATA_SOURCE` 环境变量 | `.env.example` 中预留 `VITE_DATA_SOURCE=mock` | 动态期改环境变量即可灰度切换 |
| `.env.example` 列全 `VITE_*` | 列出 `VITE_SUPABASE_URL` `VITE_SUPABASE_ANON_KEY`（静态期留空） | 避免动态期改构建配置 |
| 双跑 diff 脚本 | 契约测试写成**参数化**（同一用例跑两种适配器） | D2 直接复用 |
| 存储键规则常量 | `STORAGE_KEY_TEMPLATE` 常量化，两期共用同一份 | Storage 路径不漂移 |
| 事件名常量 | `GY_EVENTS` 常量化，跨标签与 Realtime 共用 | 事件名一致（ROADMAP §5.3 要求） |
| 查询键常量 | `src/hooks/queryKeys.ts` | 失效逻辑可复用 |
| 隐私页键名表 | `/privacy` 的键名清单与 `lib/storage.ts` 常量同源 | 动态期改一处即可 |
| `Article` 渲染管线 | 文章用 `marked` + `DOMPurify` 在构建期渲染 | 文章移入 DB 后渲染层不变（ROADMAP §1.2） |

### 7.6 动态期前端工作量估算（与 ROADMAP §10.3 对齐）

| 阶段 | 前端侧改动 | 工时（ROADMAP 全阶段） |
| --- | --- | --- |
| D0 服务端基建 | 无前端改动（仅 `.env.example`） | 12h |
| D1 鉴权迁移 | `useSession` 零改动；登录/注册页表单字段可能微调（邮箱验证提示） | 10h |
| D2 只读迁移 | 页面零改动；灰度开关与双跑 diff | 14h |
| D3 写入迁移 | `UploadDropzone` 改走 Storage；发布页显示上传进度（原有进度条复用） | 18h |
| D4 榜单服务端化 | `useWeeklyRanking` 轮询兜底；`useRealtimeRanking` 新增 | 14h |
| D5 安全与治理 | 举报弹窗改真提交；RLS 越权时页面需处理 403 态 | 12h |
| D6 收尾上线 | 隐私政策文案；Sentry 接入（`queryClient` 错误上报） | 10h |

> **前端纯改动量合计 ≈ 260 行 / 约 3.5 人日**，分散在 7 周内，每周不足 1 小时。ROADMAP §10.3 的 90h 中绝大部分是后端、迁移与运维工作。

---

## 8. 开工前检查清单（S0 结束时必须全绿）

> 这一节是本文的"执行入口"：把下面的条目逐条打勾，全部打勾后再进入 W1 编码。

| # | 检查项 | 依据 | 状态 |
| --- | --- | --- | --- |
| P-1 | ROADMAP 附录 A 的 8 个待决问题全部有结论并回填 | ROADMAP §10.2 S0 | [ ] |
| P-2 | 8 个分类 `slug` 与名称定稿（改 `name` 不改 `slug`） | ROADMAP §7.1 | [ ] |
| P-3 | 许可枚举定稿：`all_rights_reserved / cc_by / cc_by_nc / cc_by_nc_nd / cc0` | ROADMAP §4.2 | [ ] |
| P-4 | 评分公式 `score = 1.0×L + 3.0×F` 与 `formulaVersion = 'v1'` 定稿 | ROADMAP §6.2 | [ ] |
| P-5 | 时区 `Asia/Shanghai`、窗口半开区间规则确认 | ROADMAP §6.1 | [ ] |
| P-6 | 路由清单与本文 §1.3 一致（无遗漏、无额外） | ROADMAP §2 + 本文 | [ ] |
| P-7 | `docs/DATA-MODEL.md` 初稿完成（本文的字段引用以它为准） | ROADMAP §10.2 S2 | [ ] |
| P-8 | UI 库选定并记入决策日志（本文 §3 组件表按此校准） | ROADMAP §10.7 | [ ] |
| P-9 | 命名与目录约定确认（本文 §6.5） | 本文 | [ ] |
| P-10 | ESLint `no-restricted-imports` 规则已写（禁止 `features/` import `data/`） | 本文 §0.2 FL-2 | [ ] |
| P-11 | 本文档评审通过，作为 W1–W13 的唯一执行依据 | 本文 | [ ] |

---

## 9. 附录

### 9.1 页面 → 组件 → Hook 速查表

| 路由 | 页面文件 | 核心业务组件 | 核心 Hook |
| --- | --- | --- | --- |
| `/` | `HomePage.tsx` | `HeroCarousel` `RankingMiniList` `ArticleTeaserCard` | `useFeaturedPhotos` `useWeeklyRanking` `useArticles` `useCategories` |
| `/gallery` | `GalleryPage.tsx` | `PhotoMasonry` `PhotoGrid` `LoadMoreSentinel` | `usePhotos` |
| `/works/:id` | `WorkDetailPage.tsx` | `PhotoViewer` `LikeButton` `CommentList` `ExifPanel` | `usePhoto` `useComments` `useToggleLike` `useToggleFavorite` `useAddComment` |
| `/categories` | `CategoriesPage.tsx` | `CategoryCard` | `useCategories` |
| `/categories/:slug` | `CategoryPage.tsx` | `CategoryHeader` + 复用列表组件 | `useCategoryPhotos` |
| `/search` | `SearchPage.tsx` | `SearchBar` `SearchFilters` `HighlightedText` | `useSearch` `useSearchIndex` |
| `/rankings/weekly` | `RankingPage.tsx` | `RankingTable` `ScoreBar` `RankingRulesPanel` | `useWeeklyRanking` |
| `/rankings/weekly/:isoWeek` | `RankingPage.tsx` | 同上 + `RankDiffColumn` | `useWeeklyRanking(isoWeek,'final')` |
| `/learn` | `LearnHomePage.tsx` | `TopicCard` `ArticleListItem` | `useTopics` `useArticles` |
| `/learn/topics/:topic` | `LearnTopicPage.tsx` | `ArticleFilterBar` | `useArticles` |
| `/learn/:slug` | `ArticlePage.tsx` | `MarkdownBody` `ArticleToc` `PracticeChecklist` | `useArticle` |
| `/login` | `LoginPage.tsx` | `LoginForm` `DemoAccountPicker` | `useSession` |
| `/register` | `RegisterPage.tsx` | `RegisterForm` `UsernameField` | `useSession` `useCheckUsername` |
| `/u/:username` | `ProfilePage.tsx` | `ProfileHeader` `ProfileTabs` | `useProfile` `useProfilePhotos` |
| `/settings/profile` | `SettingsProfilePage.tsx` | `ProfileForm` `AvatarUploader` | `useProfile` `useUpdateProfile` |
| `/publish` | `PublishPage.tsx` | `UploadDropzone` `PublishForm` `TagInput` `LicenseSelect` | `useUploadPipeline` `useDraft` `usePublishPhoto` |
| `/me` | `MePage.tsx` | `MeMenuList` `MyDraftCard` | `useMyPhotos` `useMyFavorites` `useDraft` `useSession` |
| `/notifications` | `NotificationsPage.tsx` | `ComingSoonPanel` | `useNotifications`（占位） |
| 法律页 ×7 | `legal/*.tsx` | `LegalDocument` `LegalToc` | 无（静态内容） |
| `*` | `NotFoundPage.tsx` | `NotFoundPage` `RouteErrorPage` | 无 |

### 9.2 三态速查（每个数据区都要有）

| 数据区 | 加载态 | 空态 | 错误态 |
| --- | --- | --- | --- |
| 作品列表 | 24 个卡片骨架 | `EmptyState` + 发布入口 | 整块错误卡 + 重试 |
| 作品详情主图 | 同尺寸灰底占位 | 404 态（作品不存在） | 占位 + 重试按钮 |
| 评论区 | 3 行骨架 | "还没有评论" | 区内错误，不影响主内容 |
| 榜单 | 20 行骨架 | "本周还没有作品上榜" | 错误卡 + 重试 + 规则链接 |
| 搜索结果 | 24 项骨架 + "正在建立索引…" | 建议标签 + 清除筛选 | 降级为分类浏览 |
| 教程文章 | 正文占位骨架 + 目录骨架 | 404 态 | 纯文本降级版 |
| 我的作品/收藏 | 3 个入口卡骨架 | "还没有草稿/作品" | 卡内错误 + 重试 |
| 分类 | 8 卡骨架 | 不适用（种子常量） | 整页错误 |
| 主题/文章列表 | 6 条骨架 | "文章整理中" | 整块错误 + 重试 |
| 个人主页 Tab | 12 卡骨架 | 三个 Tab 各自文案 | Tab 内错误，头部正常 |

### 9.3 术语对照（与 ROADMAP §0.2 一致）

| 术语 | 本文中的含义 |
| --- | --- |
| 作品 / Photo | 一次发布的影像条目（`Photo` / `PhotoSummary`） |
| 互动 / Interaction | 点赞、收藏、评论三类行为 |
| 快照 / Snapshot | 某周排行榜的不可变结算结果 |
| 适配器 / Adapter | 数据层实现：静态期 `mock`，动态期 `supabase` |
| 契约测试 | 同一份用例跑在两套适配器上 |
| DTO | 适配器与上层之间的数据传输对象 |
| 游标 / cursor | 不透明分页令牌，客户端只回传不解析（D-02） |

### 9.4 与其它文档的关系

| 文档 | 关系 |
| --- | --- |
| `ROADMAP.md` | 上游决策文档。本文所有"为什么"均引用其章节号，不重复论证。 |
| `docs/architecture.svg` | 五层架构图（前端应用层 / 领域契约层 / 数据适配层 / 部署）。本文的目录与依赖方向与之对应。 |
| `docs/DATA-MODEL.md` | S2 产出（字段清单）。本文引用的字段名以其为准。 |
| `docs/MIGRATION.md` | 第二期填写。本文 §7 是它的前端部分提纲。 |
| `docs/BACKLOG.md` | 需求池（ROADMAP K-01）。本文 §2/§3 中标 ⭕ 的项进此池。 |

---

## 10. 文档维护

| 项 | 规则 |
| --- | --- |
| 版本 | v1.0（2026-10-26）。每次阶段验收后版本号 +0.1 并回填工时 |
| 回填字段 | §5 表格中每周新增"实际工时"与"偏差原因"两列 |
| 组件变更 | §3 组件表是组件库的真相源；新增/删除组件必须同步更新，避免"文档与代码不一致" |
| 范围控制 | §2 中标 ⭕ 的功能若要做，先进 `docs/BACKLOG.md`，不在当前阶段插队（ROADMAP §10.7） |
| 第二期 | 动态期开始时，本文的 §7 清单转为实际改动记录；新增章节"实际改动 vs 预估" |

---

**文档结束**。下一步动作：按 §8 清单完成 P-1 ~ P-11 评审 → 进入 W1，交付 `/_dev/ui` 组件画廊与空白站点骨架。
