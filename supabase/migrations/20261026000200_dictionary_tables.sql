-- ============================================================================
-- 工科影展 · 0002 基础字典表：categories / article_topics
-- 依据：docs/DATA-MODEL.md §2（分类 8 个）、§4（主题 4 个）、§3.7
-- 特点：用 slug 作为主键（可读、URL 稳定、改名不变，DATA-MODEL §0）
-- ============================================================================

-- ----------------------------------------------------------------------------
-- categories：作品分类（8 个定稿）
-- ----------------------------------------------------------------------------
create table if not exists public.categories (
  slug            text primary key check (slug ~ '^[a-z0-9-]{1,32}$'),
  name            text not null check (char_length(name) between 1 and 12),
  description     text not null default '' check (char_length(description) <= 100),
  sort_order      integer not null check (sort_order >= 0),
  cover_photo_id  uuid,                         -- 刻意不加 FK：封面图可能被删，加 FK 会形成循环依赖
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

comment on table public.categories is '作品分类（slug 主键，8 个定稿，slug 不得变更）';
comment on column public.categories.cover_photo_id is '分类封面作品 id；不加外键以避免与 photos 循环依赖';

create unique index if not exists uq_categories_sort_order on public.categories (sort_order);

-- ----------------------------------------------------------------------------
-- article_topics：学习板块主题（4 个定稿）
-- ----------------------------------------------------------------------------
create table if not exists public.article_topics (
  slug        text primary key check (slug ~ '^[a-z0-9-]{1,32}$'),
  name        text not null check (char_length(name) between 1 and 12),
  description text not null default '' check (char_length(description) <= 100),
  sort_order  integer not null check (sort_order >= 0)
);

comment on table public.article_topics is '学习板块主题（slug 主键，4 个定稿）';

create unique index if not exists uq_article_topics_sort_order on public.article_topics (sort_order);

-- ----------------------------------------------------------------------------
-- 种子数据（幂等：重复执行不报错、不重复插入）
-- 与 src/domain/constants.ts 的 CATEGORIES / ARTICLE_TOPICS 逐字一致
-- ----------------------------------------------------------------------------
-- 2026-11 分类体系换代：题材维度 → 风格维度（迁移 0038 同步改写）。
-- 这里直接插入最终态，而不是先插旧分类再让 0038 覆盖 ——
-- 否则全新建库的中间状态会短暂存在一批马上要被下架的行，语义混乱。
insert into public.categories (slug, name, description, sort_order) values
  ('campus-fresh',   '校园清新',   '校园日常、青春感、明亮通透',   1),
  ('travel-doc',     '旅行纪实',   '旅途见闻、在地生活、纪实叙事', 2),
  ('japanese-soft',  '日系治愈',   '低对比、柔光、干净留白',       3),
  ('hk-retro',       '港风复古',   '霓虹、暖调、颗粒感与旧时光',   4),
  ('new-chinese',    '新中式国风', '写意留白、东方色、传统意象',   5),
  ('korean-clear',   '韩系清透',   '高亮低饱和、通透皮肤质感',     6),
  ('cinematic-dark', '暗调电影感', '低光、强影调、叙事感构图',     7),
  ('american-retro', '美式复古',   '暖橙、公路、复古颗粒',         8)
on conflict (slug) do update
  set name = excluded.name,
      description = excluded.description,
      sort_order = excluded.sort_order;

insert into public.article_topics (slug, name, description, sort_order) values
  ('technique', '拍摄技巧',   '构图、用光、色彩、主题实战', 1),
  ('gear',      '器材',       '机身、镜头、配件、选购',     2),
  ('post',      '后期',       '基础调整、色彩管理、导出',   3),
  ('ethics',    '伦理与版权', '拍摄伦理、肖像权、署名',     4)
on conflict (slug) do update
  set name = excluded.name,
      description = excluded.description,
      sort_order = excluded.sort_order;
