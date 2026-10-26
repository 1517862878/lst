# 工科影展 · Gongke Photo Fair

一个面向公众的**摄影作品分享社区**：注册账号，上传自己拍摄的相片，附上拍摄地点与心得（类似 QQ 空间动态）；点赞、收藏、评论；每周实时排行榜；按主题分类浏览与中文搜索；并有分享拍摄技巧与器材心得的学习板块。

> **当前状态：静态演示版（第一期 S0–S8 已完成）**
> 所有数据仅保存在你自己浏览器的 IndexedDB 中，清除浏览数据即丢失；无需注册服务器、无需任何 API Key 即可本地跑通全部功能。动态后端（第二期）计划见 [ROADMAP.md](ROADMAP.md)。

### 🌐 在线演示

**[https://1517862878.github.io/lst/](https://1517862878.github.io/lst/)** —— 已部署到 GitHub Pages，打开即用，无需安装。

演示账号：`alice` / `bob` / `editor`，密码 `demo1234`（登录页可一键填入）。

---

## 项目介绍

摄影社区类产品通常需要后端服务，本项目反过来做：**用纯前端 + 浏览器本地存储**完整实现一遍社区的业务闭环，用于演示交互、验证架构与沉淀设计系统。

它的价值在于两点：

1. **开箱即用**：克隆后 `pnpm install && pnpm dev` 就能体验完整的社区产品，不需要数据库、不需要配置。
2. **可迁移架构**：数据层采用「仓储接口 + 适配器」模式。静态期用 Mock 适配器（IndexedDB），第二期切换到 Supabase 后端时，**页面与组件零改动**。

---

## 功能特性

### 内容与浏览

- 📷 **作品发布**：上传 JPG 图片，自动压缩为 WebP（展示图 2400px / 缩略图 640px 双档），附拍摄地点、心得与授权方式
- 🖼 **作品浏览**：首页精选、作品墙（网格 / 瀑布流两种视图切换）、分类总览、分类墙
- 🔍 **详情页**：大图浏览 + EXIF 白名单参数展示 + 相关作品推荐
- 🗂 **8 个主题分类**：风光、人像、街拍、建筑、静物、纪实、星空、生态

### 互动

- 👍 **点赞 / 收藏**：乐观更新（即时反馈）+ 失败自动回滚
- 💬 **评论**：需登录，支持一级回复、软删除占位，纯文本渲染防 XSS
- 🔄 **跨标签页同步**：用 `BroadcastChannel` 广播互动事件，多标签打开实时一致

### 排行榜与发现

- 🏆 **每周实时排行榜**：`得分 = 1 × 点赞 + 3 × 收藏`，每周一 00:00（Asia/Shanghai）结算
- 📊 当期实时榜 + 历史终榜 + 榜单规则公开说明
- 🔎 **中文搜索**：MiniSearch 运行时索引，中文分词（`Intl.Segmenter` + bigram 兜底），标题加权 + 模糊匹配 + 关键词高亮

### 学习板块

- 📚 4 大主题教程：拍摄技巧 / 器材 / 后期 / 伦理与版权
- 📝 Markdown 渲染走 `marked` + `DOMPurify` 白名单净化管线

### 安全与合规

- 🔒 **EXIF 隐私保护**：上传时只提取 7 项白名单参数，**GPS 坐标与设备序列号永不入库**
- 🛡 **XSS 防护**：全站纯文本渲染，Markdown 走白名单净化，链接强制 `noopener`
- ⚖️ **完整法律页**：服务条款、隐私政策、版权声明、DMCA、开源许可、社区规范、关于

### 工程质量

- ✅ TypeScript `strict` 模式，全程 `tsc` 0 错误
- ✅ ESLint 0 错误 0 警告（含依赖方向铁律校验）
- ✅ 首屏 JS gzip **126.9 KB**（预算 200 KB 以内）
- ✅ 全部 **24 条路由**构建后 HTTP 200
- ✅ React.lazy 全路由分包 + 单元测试

---

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | React 19 · TypeScript (strict) · Vite 7 |
| 路由 | react-router 7（全路由懒加载分包） |
| 样式 | Tailwind CSS 4（明暗双套设计令牌） |
| 数据请求 | TanStack Query 5 |
| 全局状态 | Zustand 5 |
| UI 原语 | Radix UI（无障碍） |
| 表单校验 | React Hook Form + Zod |
| 搜索引擎 | MiniSearch 7（中文分词） |
| Markdown | marked 18 + DOMPurify 3 |
| 本地存储 | IndexedDB（idb 8） |
| 测试 | Vitest 3 + Testing Library（单元）+ Playwright 1.64（E2E） |

---

## 环境依赖

### 必需

| 依赖 | 版本要求 | 说明 |
|---|---|---|
| **Node.js** | `>= 20.19.0`（推荐 22.x LTS） | Vite 7 的最低要求；`package.json` 的 `engines` 已声明 |
| **pnpm** | `>= 9`（推荐 10.x） | 项目使用 `pnpm-lock.yaml`，npm / yarn 不保证依赖树一致 |

检查版本：

```bash
node -v    # 期望 v20.19.0 或更高
pnpm -v    # 期望 9.x / 10.x
```

未安装 pnpm 时：

```bash
npm install -g pnpm
# 或（推荐，不污染全局）
corepack enable && corepack prepare pnpm@latest --activate
```

### 可选

| 依赖 | 用途 |
|---|---|
| Git | 拉取代码、提交贡献 |
| 现代浏览器 | Chrome / Edge / Firefox / Safari 最新版（需支持 IndexedDB、BroadcastChannel、`Intl.Segmenter`） |

### 无需

- ❌ 数据库（MySQL / PostgreSQL）
- ❌ 后端服务或 Supabase 账号
- ❌ 任何 API Key 或环境变量文件

---

## 安装与使用

### 安装

```bash
# 1. 克隆仓库
git clone https://github.com/<your-name>/lst.git
cd lst

# 2. 安装依赖
pnpm install
```

> **Windows 用户注意**（重要）
> 若你的项目路径包含**中文或空格**（例如 `E:\项目\我的网站`），pnpm 默认的 junction 链接器会生成畸形链接，导致 Vite 找不到 rollup 而报错。请改用 hoisted 模式安装：
>
> ```bash
> pnpm install --node-linker=hoisted
> ```

### 启动开发服务器

```bash
pnpm dev
```

打开终端输出的地址，默认 **<http://localhost:5173/>**。

### 生产构建与预览

```bash
pnpm build      # 类型检查 + 构建，产物输出到 dist/
pnpm preview    # 本地预览构建产物（默认 http://localhost:4173）
```

### 质量检查

```bash
pnpm lint          # ESLint（要求 0 error 0 warning）
pnpm test          # Vitest 单元测试（8 个）
pnpm test:e2e      # Playwright E2E（3 条主链路，15 个用例）
pnpm format        # Prettier 格式化
```

E2E 说明：

- 会自动构建产物并起一个本地静态服务器（`scripts/serve-dist.mjs`），无需手工准备
- 使用**系统已安装的 Chrome**（`channel: 'chrome'`），不需要 `npx playwright install` 下载浏览器
- 若系统没有 Chrome，先执行 `npx playwright install chromium` 并把 `playwright.config.ts` 里的 `channel` 去掉

### 可用脚本一览

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 启动开发服务器（HMR 热更新） |
| `pnpm build` | `tsc` 类型检查 + Vite 生产构建 |
| `pnpm postbuild` | 生成 GitHub Pages 用的 `404.html` 回退（`build` 后自动执行） |
| `pnpm preview` | 预览 `dist/` 构建产物 |
| `pnpm serve:dist` | 纯 Node 静态服务器（绕过 vite.config，适合受限环境） |
| `pnpm lint` | ESLint 代码检查 |
| `pnpm test` | 运行单元测试 |
| `pnpm test:e2e` | 运行 E2E 主链路测试 |
| `pnpm test:e2e:report` | 查看 E2E 报告 |
| `pnpm format` | Prettier 格式化全部文件 |

### 部署到 GitHub Pages（可选）

本项目**已部署**在 <https://1517862878.github.io/lst/>，采用 `gh-pages` 分支托管构建产物。

若你要部署自己的 fork：

```bash
# 部署到 https://<你的用户名>.github.io/lst/ 时，base 必须是 /lst/
VITE_BASE=/lst/ pnpm build
node scripts/postbuild.mjs   # 生成 404.html，作为 SPA 深链回退
```

然后把 `dist/` 的内容推到仓库的 `gh-pages` 分支，并在 **Settings → Pages** 中把源设为 `gh-pages` 分支的 `/` 目录。

> 首次访问某个深链接（如 `/gallery`）时，GitHub Pages 会返回 404 状态码，但同时交付 `404.html`（即 SPA 外壳），路由随后在浏览器端接管，**页面可正常显示**。这是 GitHub Pages 静态托管的固有行为。

---

## 使用说明

### 演示账号

无需注册即可登录体验，登录页提供**一键填入**：

| 用户名 | 密码 | 角色 |
|---|---|---|
| `alice` | `demo1234` | 普通用户 |
| `bob` | `demo1234` | 普通用户 |
| `editor` | `demo1234` | 编辑 |

> 演示密码明文写在前端属**设计如此**（静态演示版无真实鉴权），详见 [SECURITY.md](SECURITY.md)。

### 首次启动会发生什么

第一次打开页面时，应用会自动向 IndexedDB 灌入一份**幂等的演示数据集**：

- 10 个用户
- 80 张作品
- 300 条互动记录（点赞 / 收藏 / 评论）
- 12 篇教程文章

作品缩略图由前端根据作品 ID 生成**纯色占位块**，仓库不含任何第三方图片素材（见 [CREDITS.md](CREDITS.md)）。

### 页面地图

| 页面 | 路径 | 说明 |
|---|---|---|
| 首页 | `/` | 精选作品 + 榜单 Top5 + 教程推荐 + 分类入口 |
| 作品墙 | `/gallery` | 全部作品，支持排序与网格 / 瀑布流切换 |
| 作品详情 | `/works/seed-photo-001` | 大图 + EXIF 白名单 + 点赞收藏评论 |
| 分类总览 | `/categories` | 8 个分类及作品计数 |
| 分类墙 | `/categories/landscape` | 单分类作品列表 |
| 搜索 | `/search?q=星空` | 中文分词搜索 + 关键词高亮 |
| 周榜 | `/rankings/weekly` | 当期实时榜 |
| 历史周榜 | `/rankings/weekly/2026-W44` | 指定周终榜 |
| 学习首页 | `/learn` | 4 大主题教程入口 |
| 文章阅读 | `/learn/technique-1` | 正文 + 目录锚点 |
| 登录 / 注册 | `/login` `/register` | 需登录的操作会跳转登录并回跳 |
| 发布作品 | `/publish` | 需登录；仅接受 JPG，支持草稿自动保存 |
| 个人主页 | `/u/alice` | 作品 / 收藏 / 喜欢三个 Tab |
| 设置 | `/settings/profile` | 资料编辑、退出登录 |
| 我的 | `/me` | 个人快捷入口 |
| 法律页 | `/terms` `/privacy` `/copyright` `/dmca` `/licenses` `/community` `/about` | 7 个合规页面 |

### 典型操作路径

```
浏览作品（无需登录）→ 看详情页 EXIF → 点赞/收藏（需登录）→ 评论（需登录）
发布作品（需登录）→ 选 JPG → 填地点与心得 → 选授权方式 → 发布
搜索「星空」→ 查看结果高亮 → 进入详情
查看周榜 → 了解计分规则 → 看历史终榜
```

### 数据说明（重要）

| 事实 | 说明 |
|---|---|
| 数据存放位置 | 浏览器 IndexedDB（两个库：业务数据 + 文件存储） |
| 是否上传服务器 | **否**，全部留在本地浏览器 |
| 换浏览器 / 清缓存 | 数据丢失，会重新灌入种子数据 |
| 是否可导入导出 | 当前版本不支持 |
| 多标签一致 | 互动类操作通过 `BroadcastChannel` 实时同步 |

---

## 项目结构

```
src/
├── app/            # 应用外壳、路由表、Provider
├── components/     # 设计系统：基础组件 15 + 布局组件 6
├── domain/         # 领域模型：types / constants / ranking / permissions / schemas
├── data/
│   ├── contracts/  # 九大仓储接口 + AppError + 分页契约
│   ├── mock/       # 静态期 Mock 适配器（IndexedDB 实现）
│   └── index.ts    # 仓储工厂
├── hooks/          # usePhotos / useSearch / useInteractions / useSession
├── lib/            # time / bus / markdown / image（压缩与 EXIF）/ search
├── features/       # 业务组件：photos / auth / interactions / search / rankings / learn / legal
├── pages/          # 页面组件
└── styles/         # 设计令牌与全局样式
tests/unit/         # 单元测试（周榜算法、工具函数）
docs/               # 架构图与数据模型文档
scripts/            # postbuild（GitHub Pages 404 回退）
```

---

## 架构

数据层采用「仓储接口 + 双适配器」架构：页面与组件**只通过 hooks 访问数据**，从不直接引用具体适配器。这样静态期用 Mock，动态期换成 Supabase 时，业务代码零改动。

```
pages / features  →  hooks  →  services  →  data/contracts  →  { data/mock  |  data/supabase }
```

详见 [docs/architecture.svg](docs/architecture.svg) 与 [docs/DATA-MODEL.md](docs/DATA-MODEL.md)。

---

## 开源许可

本项目采用 **MIT License**，详见 [LICENSE](LICENSE)。

但请注意许可的**分层范围**（完整说明见 [NOTICE.md](NOTICE.md)）：

| 内容 | 许可 |
|---|---|
| 源代码 | **MIT**（可自由使用、修改、商用、再分发） |
| 教程文案 | CC BY-SA 4.0 |
| 用户上传的摄影作品 | 著作权归原作者所有（默认保留所有权利） |

---

## 贡献

欢迎提交 Issue 与 Pull Request。提交前请确认：

```bash
pnpm lint        # 0 error 0 warning
pnpm test        # 单元测试全部通过
pnpm test:e2e    # E2E 主链路全部通过
pnpm build       # 构建成功
```

详细规范见 [CONTRIBUTING.md](CONTRIBUTING.md)。发现安全漏洞请按 [SECURITY.md](SECURITY.md) 通过私有渠道报告，**不要公开 Issue**。

---

## 文档

| 文档 | 内容 |
|---|---|
| [ROADMAP.md](ROADMAP.md) | 完整开发计划：技术选型、数据模型、周榜公式、版权合规、分阶段计划、第二期动态化方案 |
| [docs/FRONTEND-WORK.md](docs/FRONTEND-WORK.md) | 前端落地工作清单 |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | 数据模型事实源 |
| [docs/MIGRATIONS.md](docs/MIGRATIONS.md) | **数据库迁移说明**：11 张表、28 条 RLS 策略、执行方式、上线前校验清单 |
| [docs/architecture.svg](docs/architecture.svg) | 架构图 |
| [分布工程总结.md](分布工程总结.md) | 分部工程总结（S1–S8 每阶段做了什么、如何验证） |

---

## 已知限制（演示版）

- 账号为本地伪造会话，**不是真实鉴权**，无法跨设备使用
- 数据不持久、不上云、不可导出
- 无图片真实上传存储（作品为占位色块 + 用户可自传 JPG 到本地库）
- 无服务器端榜单结算，周榜在浏览器端按周计算

以上限制将在第二期（Supabase 后端）逐一解决，见 [ROADMAP.md](ROADMAP.md) §10.3。
