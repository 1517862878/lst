# 工科影展 · 数据模型设计（DATA-MODEL）

| 项 | 内容 |
| --- | --- |
| 文档版本 | v1.0 |
| 定稿日期 | 2026-10-26 |
| 前置文档 | [ROADMAP.md](../ROADMAP.md)（决策与字段定义，本文是其 §4 的展开） |
| 定位 | **领域模型的事实源**：字段、枚举、索引、约束、类型草稿、建表清单，全部在此定稿 |
| 适用范围 | 静态期 IndexedDB + 动态期 Postgres 共用同一套字段（L-3：不允许"临时字段"） |
| 维护规则 | 字段变更必须同时改本文、`domain/types.ts`、`data/mock`、`data/supabase` 四处，并记入决策日志 |

> **一句话**：本文是「数据长什么样」的唯一答案。S2 按 §5 写 `types.ts`，D0 按 §7 写迁移 SQL；两者字段必须与本文逐字一致。

---

## 0. 建模约定（继承 ROADMAP §4.1）

| 项 | 约定 |
| --- | --- |
| 主键 | `uuid`（v4，客户端生成）；分类/主题用 `slug text` 作主键（可读、URL 稳定、改名不变） |
| 时间 | 存 UTC ISO-8601 字符串；DB 用 `timestamptz`；展示按 `Asia/Shanghai` |
| 软删除 | `status` 枚举 + `deletedAt`；物理删除仅限用户主动注销 |
| 计数 | `likeCount / favoriteCount / commentCount` 冗余在作品行，**只读派生**，永远由互动行重算，不手写加减 |
| 枚举 | 全小写+下划线，TS 字面量联合与 DB `check` 约束逐字相同 |
| 文本长度 | 在 zod schema 与 DB `check` 约束写同一个数字 |
| 富文本 | 一期只允许纯文本 + 换行；Markdown 仅用于教程文章（构建期渲染并净化） |
| 命名 | domain 类型用 camelCase；DB 列用 snake_case，转换只在 `mappers.ts` 完成 |
| null | 用 `null` 不用空串；`deletedAt` 空表示未删除 |

---

## 1. 枚举字典（全量定稿）

| 枚举 | 取值 | 说明 |
| --- | --- | --- |
| `UserRole` | `user` \| `editor` \| `admin` | 默认 `user` |
| `PhotoStatus` | `draft` \| `published` \| `hidden` \| `removed` | 默认 `draft` |
| `PhotoLicense` | `all_rights_reserved` \| `cc_by` \| `cc_by_nc` \| `cc_by_nc_nd` \| `cc0` | 默认 `all_rights_reserved` |
| `LocationPrecision` | `exact` \| `district` \| `city` \| `hidden` | 默认 `city`，控制坐标展示精度 |
| `CommentStatus` | `visible` \| `hidden` \| `removed` | 默认 `visible` |
| `RankingKind` | `daily` \| `final` | `daily` 供名次变化箭头，`final` 为终榜 |
| `RankingStatus` | `ready` | 不可变，重算生成新行 |
| `ArticleDifficulty` | `beginner` \| `intermediate` \| `advanced` | — |
| `ArticleStatus` | `draft` \| `published` | 默认 `draft` |
| `ReportTargetType` | `photo` \| `comment` \| `profile` | — |
| `ReportReason` | `copyright` \| `explicit` \| `spam` \| `abuse` \| `other` | — |
| `ReportStatus` | `open` \| `reviewing` \| `upheld` \| `rejected` | 默认 `open` |
| `LicensePreference` | 同 `PhotoLicense` | 用户默认授权偏好，发布时可覆盖 |

---

## 2. 分类种子（定稿 8 个，`categories` 表数据）

| slug | name | description | sortOrder |
| --- | --- | --- | --- |
| `landscape` | 风景 | 自然风光、地貌、天象 | 1 |
| `people` | 人文 | 纪实、街拍、人物与生活 | 2 |
| `architecture` | 建筑 | 建筑外观、室内、结构 | 3 |
| `industrial` | 工业 | 工厂、机械、工程现场 | 4 |
| `technology` | 科技 | 科技产品、实验、数码 | 5 |
| `macro` | 微距 | 微距摄影、细节特写 | 6 |
| `night` | 夜景 | 夜间、长曝、星空 | 7 |
| `monochrome` | 黑白 | 黑白摄影、影调 | 8 |

> `slug` 永不变更（URL 稳定性）；`name` 可改；`sortOrder` 唯一。`coverPhotoId` 可空，缺省用主题默认色块。

---

## 3. 实体字段定义

> 每表给出：字段、TS 类型（camelCase）、DB 类型（snake_case）、约束、索引。索引命名 `idx_<table>_<col>`。

### 3.1 profiles（用户资料；鉴权身份由 Auth 托管，`id` 与之一致）

| 字段 | TS 类型 | DB 类型 | 约束 | 索引 |
| --- | --- | --- | --- | --- |
| id | string | uuid | PK | PK |
| username | string | citext | UNIQUE，3–20，`^[a-z0-9_-]+$` | UNIQUE |
| displayName | string | text | 1–30 | — |
| avatarKey | string \| null | text | 可空 | — |
| bio | string | text | 0–160 | — |
| role | UserRole | text | default `user` | — |
| links | {label,url}[] | jsonb | ≤3 | — |
| licensePreference | LicensePreference | text | default `all_rights_reserved` | — |
| createdAt / updatedAt | string | timestamptz | NOT NULL | — |
| deletedAt | string \| null | timestamptz | 可空 | — |

### 3.2 photos（作品）

| 字段 | TS 类型 | DB 类型 | 约束 | 索引 |
| --- | --- | --- | --- | --- |
| id | string | uuid | PK | PK |
| authorId | string | uuid | FK profiles，NOT NULL | idx_photos_author |
| title | string | text | 1–60 | — |
| description | string | text | 0–2000 | — |
| categorySlug | string | text | FK categories，NOT NULL | idx_photos_category |
| tags | string[] | text[] | ≤5，小写 | GIN |
| locationName | string | text | 0–80 | — |
| locationLat / locationLng | number \| null | numeric(9,6) | 可空 | — |
| locationPrecision | LocationPrecision | text | default `city` | — |
| shotAt | string \| null | timestamptz | 可空 | — |
| exif | Record<string,unknown> \| null | jsonb | 白名单键 | — |
| imageKey | string | text | NOT NULL | — |
| thumbKey | string | text | NOT NULL | — |
| width / height | number | int | >0 | — |
| blurhash | string \| null | text | 可空 | — |
| license | PhotoLicense | text | default `all_rights_reserved` | — |
| credit | string \| null | text | 可空，非本人拍摄时的来源署名 | — |
| status | PhotoStatus | text | default `draft` | idx_photos_status |
| likeCount / favoriteCount / commentCount / viewCount | number | int | default 0，只读派生 | — |
| publishedAt | string \| null | timestamptz | 可空 | idx_photos_published |
| createdAt / updatedAt | string | timestamptz | NOT NULL | — |
| deletedAt | string \| null | timestamptz | 可空 | — |

### 3.3 likes / favorites（互动，两表结构相同）

| 字段 | TS 类型 | DB 类型 | 约束 | 索引 |
| --- | --- | --- | --- | --- |
| userId | string | uuid | PK 组成，FK profiles | PK |
| photoId | string | uuid | PK 组成，FK photos | PK |
| createdAt | string | timestamptz | NOT NULL，**周榜按此落窗** | idx_likes_photo_created |

> 主键 `(userId, photoId)` 保证"取消再点只算一次"；取消 = 删除行。周榜查询需 `(photoId, createdAt)` 复合索引。

### 3.4 comments（评论，仅一级回复）

| 字段 | TS 类型 | DB 类型 | 约束 | 索引 |
| --- | --- | --- | --- | --- |
| id | string | uuid | PK | PK |
| photoId | string | uuid | FK photos | idx_comments_photo |
| authorId | string | uuid | FK profiles | idx_comments_author |
| parentId | string \| null | uuid | FK comments，可空，仅指向顶层评论 | — |
| body | string | text | 1–500，纯文本 | — |
| status | CommentStatus | text | default `visible` | — |
| createdAt / updatedAt | string | timestamptz | NOT NULL | — |
| deletedAt | string \| null | timestamptz | 可空，软删保留占位 | — |

### 3.5 weekly_rank_snapshots（榜单快照）

| 字段 | TS 类型 | DB 类型 | 约束 | 索引 |
| --- | --- | --- | --- | --- |
| id | string | uuid | PK | PK |
| isoWeek | string | text | `UNIQUE(isoWeek, kind, formulaVersion)` | UNIQUE 复合 |
| kind | RankingKind | text | — | 同上 |
| timezone | string | text | default `Asia/Shanghai` | — |
| weekStartUtc / weekEndUtc | string | timestamptz | NOT NULL | — |
| capturedAt | string | timestamptz | NOT NULL | — |
| formulaVersion | string | text | default `v1` | 同上 |
| entryCount | number | int | ≥0 | — |
| status | RankingStatus | text | `ready` | — |

### 3.6 weekly_rank_entries（榜单条目）

| 字段 | TS 类型 | DB 类型 | 约束 | 索引 |
| --- | --- | --- | --- | --- |
| snapshotId | string | uuid | PK 组成，FK snapshots | PK |
| rank | number | int | PK 组成，≥1，全序唯一 | PK |
| photoId | string | uuid | FK photos | — |
| likeCount / favoriteCount | number | int | ≥0，该周窗口内 | — |
| score | number | numeric(10,2) | ≥0 | — |
| tieBreakKey | string | text | NOT NULL，审计用 | — |

### 3.7 article_topics（学习板块主题）

| 字段 | TS 类型 | DB 类型 | 约束 | 索引 |
| --- | --- | --- | --- | --- |
| slug | string | text | PK | PK |
| name | string | text | 1–12 | — |
| description | string | text | 0–100 | — |
| sortOrder | number | int | 唯一 | UNIQUE |

### 3.8 articles（教程文章）

| 字段 | TS 类型 | DB 类型 | 约束 | 索引 |
| --- | --- | --- | --- | --- |
| id | string | uuid | PK | PK |
| slug | string | text | UNIQUE，URL 用 | UNIQUE |
| topicSlug | string | text | FK article_topics | idx_articles_topic |
| title | string | text | 1–80 | — |
| summary | string | text | 0–140 | — |
| bodyMd | string | text | Markdown 原文 | — |
| coverKey | string \| null | text | Storage 键，可空 | — |
| authorId | string | uuid | FK profiles | — |
| difficulty | ArticleDifficulty | text | — | — |
| readingMinutes | number | int | ≥1，由字数估算 | — |
| tags | string[] | text[] | ≤6 | GIN |
| equipment | string[] | text[] | ≤6，器材标签 | GIN |
| relatedPhotoIds | string[] | text[] | ≤6，站内作品联动 | — |
| status | ArticleStatus | text | default `draft` | — |
| publishedAt / updatedAt | string | timestamptz | — | idx_articles_published |
| version | number | int | 每次实质更新 +1 | — |

### 3.9 reports（举报，P1.5 上线，模型先定）

| 字段 | TS 类型 | DB 类型 | 约束 | 索引 |
| --- | --- | --- | --- | --- |
| id | string | uuid | PK | PK |
| targetType | ReportTargetType | text | — | idx_reports_target |
| targetId | string | uuid | — | — |
| reason | ReportReason | text | — | — |
| detail | string | text | 0–500 | — |
| reporterId | string \| null | uuid | 可空（允许匿名） | — |
| status | ReportStatus | text | default `open` | idx_reports_status |
| createdAt / resolvedAt | string | timestamptz | — | — |

---

## 4. 学习板块主题种子（定稿 4 个）

| slug | name | description | sortOrder |
| --- | --- | --- | --- |
| `technique` | 拍摄技巧 | 构图、用光、色彩、主题实战 | 1 |
| `gear` | 器材 | 机身、镜头、配件、选购 | 2 |
| `post` | 后期 | 基础调整、色彩管理、导出 | 3 |
| `ethics` | 伦理与版权 | 拍摄伦理、肖像权、署名 | 4 |

> 详细信息架构见 ROADMAP §8.1；`articles.topicSlug` 只能取这四个值。

---

## 5. TypeScript 类型草稿（`src/domain/types.ts` 预演）

> S2 才落为文件；此处先定稿，保证「类型先行」有据可依。以下与 §3 逐字一致。

```ts
// —— 枚举（与 DB check 逐字一致）——
export type UserRole = 'user' | 'editor' | 'admin';
export type PhotoStatus = 'draft' | 'published' | 'hidden' | 'removed';
export type PhotoLicense = 'all_rights_reserved' | 'cc_by' | 'cc_by_nc' | 'cc_by_nc_nd' | 'cc0';
export type LocationPrecision = 'exact' | 'district' | 'city' | 'hidden';
export type CommentStatus = 'visible' | 'hidden' | 'removed';
export type RankingKind = 'daily' | 'final';
export type ArticleDifficulty = 'beginner' | 'intermediate' | 'advanced';
export type ArticleStatus = 'draft' | 'published';
export type ReportTargetType = 'photo' | 'comment' | 'profile';
export type ReportReason = 'copyright' | 'explicit' | 'spam' | 'abuse' | 'other';
export type ReportStatus = 'open' | 'reviewing' | 'upheld' | 'rejected';

// —— 通用 ——
export type IsoDate = string; // UTC ISO-8601，出库即 string，禁止 Date 穿透到组件

// —— 实体 ——
export interface Profile {
  id: string;
  username: string;            // 3–20, ^[a-z0-9_-]+$
  displayName: string;         // 1–30
  avatarKey: string | null;
  bio: string;                 // 0–160
  role: UserRole;
  links: { label: string; url: string }[]; // ≤3
  licensePreference: PhotoLicense;
  createdAt: IsoDate;
  updatedAt: IsoDate;
  deletedAt: IsoDate | null;
}

export interface Photo {
  id: string;
  authorId: string;
  title: string;               // 1–60
  description: string;         // 0–2000
  categorySlug: string;
  tags: string[];              // ≤5，小写
  locationName: string;        // 0–80
  locationLat: number | null;
  locationLng: number | null;
  locationPrecision: LocationPrecision;
  shotAt: IsoDate | null;
  exif: Record<string, unknown> | null; // 白名单键
  imageKey: string;
  thumbKey: string;
  width: number;               // >0
  height: number;              // >0
  blurhash: string | null;
  license: PhotoLicense;
  credit: string | null;
  status: PhotoStatus;
  likeCount: number;           // 派生
  favoriteCount: number;       // 派生
  commentCount: number;        // 派生
  viewCount: number;           // 派生
  publishedAt: IsoDate | null;
  createdAt: IsoDate;
  updatedAt: IsoDate;
  deletedAt: IsoDate | null;
}

export interface Interaction {   // likes 与 favorites 共用结构
  userId: string;
  photoId: string;
  createdAt: IsoDate;          // 周榜落窗依据
}

export interface Comment {
  id: string;
  photoId: string;
  authorId: string;
  parentId: string | null;     // 仅指向顶层评论
  body: string;                // 1–500 纯文本
  status: CommentStatus;
  createdAt: IsoDate;
  updatedAt: IsoDate;
  deletedAt: IsoDate | null;
}

export interface RankingSnapshot {
  id: string;
  isoWeek: string;             // '2026-W44'
  kind: RankingKind;
  timezone: string;            // 'Asia/Shanghai'
  weekStartUtc: IsoDate;
  weekEndUtc: IsoDate;
  capturedAt: IsoDate;
  formulaVersion: string;      // 'v1'
  entryCount: number;
  status: 'ready';
}

export interface RankingEntry {
  snapshotId: string;
  rank: number;                // ≥1，全序唯一
  photoId: string;
  likeCount: number;
  favoriteCount: number;
  score: number;               // numeric(10,2)
  tieBreakKey: string;
}

export interface ArticleTopic {
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
}

export interface Article {
  id: string;
  slug: string;                // UNIQUE
  topicSlug: string;
  title: string;               // 1–80
  summary: string;             // 0–140
  bodyMd: string;
  coverKey: string | null;
  authorId: string;
  difficulty: ArticleDifficulty;
  readingMinutes: number;
  tags: string[];              // ≤6
  equipment: string[];         // ≤6
  relatedPhotoIds: string[];   // ≤6
  status: ArticleStatus;
  publishedAt: IsoDate | null;
  updatedAt: IsoDate;
  version: number;
}

export interface Report {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  detail: string;              // 0–500
  reporterId: string | null;   // 允许匿名
  status: ReportStatus;
  createdAt: IsoDate;
  resolvedAt: IsoDate | null;
}
```

---

## 6. IndexedDB 表结构（静态期持久化）

> 数据库 `gy-db`，版本从 `1` 起，每改结构 +1 并写迁移函数。实体表与 DB 同名、字段 camelCase。

| 表 | 主键 | 索引 | 说明 |
| --- | --- | --- | --- |
| `profiles` | id | username(unique) | — |
| `photos` | id | authorId, categorySlug, status, publishedAt | 列表/分类/榜单查询 |
| `categories` | slug | sortOrder(unique) | 种子 8 行 |
| `likes` | [userId, photoId] | photoId+createdAt | 周榜落窗 |
| `favorites` | [userId, photoId] | photoId+createdAt | 周榜落窗 |
| `comments` | id | photoId | 倒序分页 |
| `rankSnapshots` | id | isoWeek+kind+formulaVersion(unique) | — |
| `rankEntries` | [snapshotId, rank] | photoId | — |
| `topics` | slug | sortOrder(unique) | 种子 4 行 |
| `articles` | id | slug(unique), topicSlug, publishedAt | — |
| `_meta` | key | — | schemaVersion, dataVersion, seededAt |

**IndexedDB `gy-assets` 库（图片 Blob，独立库避免与实体库混淆）**

| 表 | 字段 | 说明 |
| --- | --- | --- |
| `images` | `{ key, blob, width, height, createdAt }` | 键规则 `photos/{authorId}/{photoId}/display.webp` 与 `.../thumb.webp` |

**版本迁移方案**：`data/mock/db.ts` 维护 `MIGRATIONS: Record<number, (tx) => void>`；`onupgradeneeded` 依次执行；`_meta.schemaVersion` 记录当前版本。`dataVersion` 每次写入自增，供搜索索引与榜单缓存失效判断。

---

## 7. Postgres DDL 草稿（D0 落地为 `supabase/migrations/*.sql`）

> 此处仅给**关键建表骨架与约束**，完整 SQL（含 RLS、触发器、检查约束）在 D0/D2/D3 阶段写。

```sql
-- 示例：photos 表（节选，展示 check 约束与索引，供 D0 参考）
create table photos (
  id uuid primary key,
  author_id uuid not null references profiles(id),
  title text not null check (char_length(title) between 1 and 60),
  description text not null default '' check (char_length(description) <= 2000),
  category_slug text not null references categories(slug),
  tags text[] not null default '{}',
  location_name text not null default '',
  location_lat numeric(9,6),
  location_lng numeric(9,6),
  location_precision text not null default 'city'
    check (location_precision in ('exact','district','city','hidden')),
  exif jsonb,
  image_key text not null,
  thumb_key text not null,
  width int not null check (width > 0),
  height int not null check (height > 0),
  license text not null default 'all_rights_reserved'
    check (license in ('all_rights_reserved','cc_by','cc_by_nc','cc_by_nc_nd','cc0')),
  status text not null default 'draft'
    check (status in ('draft','published','hidden','removed')),
  like_count int not null default 0,
  favorite_count int not null default 0,
  comment_count int not null default 0,
  view_count int not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_photos_author on photos(author_id);
create index idx_photos_category on photos(category_slug);
create index idx_photos_status on photos(status);
create index idx_photos_published on photos(published_at);
create index idx_photos_tags on photos using gin(tags);
```

> 所有表的 `check` 约束取值必须与 §5 的 TS 字面量逐字相同（L-1/L-3）；字段比对脚本（D0）会校验「domain ↔ DB 字段差异为零」。

---

## 8. 类型映射对照（TS ↔ Postgres ↔ IndexedDB）

| TS | Postgres | IndexedDB | 注意 |
| --- | --- | --- | --- |
| `string`（ISO） | `timestamptz` | `string` | 出库转 ISO 字符串，禁止 Date 对象穿透到组件 |
| `string \| null` | `text NULL` | `string \| null` | 不用空串代替 null |
| `number`（坐标） | `numeric(9,6)` | `number` | 出库 `parseFloat`，保留 6 位 |
| `string[]` | `text[]` | `string[]` | 顺序无意义，比较时排序后比 |
| `Record<string,unknown>` | `jsonb` | `object` | 只存白名单键，前端读前校验 |
| 联合字面量 | `text` + `check` | `string` | 约束值与 TS 枚举逐字相同 |
| `{label,url}[]` | `jsonb` | `object[]` | 长度上限在 zod 与 check 双写 |
| `number`（计数） | `int` | `number` | 只读派生，禁止直接写 |

---

## 9. seed 数据规格（静态期演示数据）

| 项 | 规格 | 备注 |
| --- | --- | --- |
| 用户 | 10 个（含 `alice`/`bob`/`editor` 演示账号） | 密码统一 `demo1234` |
| 作品 | 80 张 | 全部 `credit='示例素材'`，卡片右上角「示例」角标 |
| 互动 | 300 条（likes + favorites 合计） | 分布覆盖多个周窗口，供榜单测试 |
| 评论 | 若干（含软删占位样例） | — |
| 分类 | 8 个（§2） | 每类至少 8 张作品 |
| 文章 | 12 篇（§4 每主题 3 篇） | 每篇 ≥1 张自摄示例图 + 参数表 |
| 榜单快照 | 至少 2 周历史 `final` + 当期 `daily` | 供名次变化箭头测试 |

**素材版权约束**（ROADMAP §9.3）：seed 图片只允许「自己拍摄 / Unsplash-Pexels / Wikimedia / CC0」，全部登记 `CREDITS.md`；禁止搜索引擎图片、带水印图、AI 生成图。**图片输入格式仅 JPG/JPEG**（用户已拍板），存储后统一 WebP。

---

## 10. 已拍板决策对数据模型的影响（2026-10-26）

| 决策 | 落地位置 |
| --- | --- |
| 评论必须登录 | `comments.reporterId` 无匿名；`reports.reporterId` 允许 null（举报可匿名，属另一行为） |
| 图片仅 JPG/JPEG 输入 | 上传器 MIME 校验 `image/jpeg`；存储仍 WebP（`imageKey`/`thumbKey` 为 `.webp`） |
| EXIF 白名单 | `photos.exif` 只存 `Make/Model/LensModel/FNumber/ExposureTime/ISO/FocalLength/DateTimeOriginal`，GPS 与设备序列号永不入 `exif` |
| 其余 6 条按建议 | 见 ROADMAP 附录 A v1.1 |

---

**文档结束**。下一步：进入 S1（工程地基）前，可先按 §5 生成 `src/domain/types.ts`、按 §6 写 `data/mock/db.ts` 迁移骨架——这两者必须在 S2 落定，且与本文逐字一致。
