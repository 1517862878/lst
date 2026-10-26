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
insert into public.categories (slug, name, description, sort_order) values
  ('landscape',    '风景', '自然风光、地貌、天象',   1),
  ('people',       '人文', '纪实、街拍、人物与生活', 2),
  ('architecture', '建筑', '建筑外观、室内、结构',   3),
  ('industrial',   '工业', '工厂、机械、工程现场',   4),
  ('technology',   '科技', '科技产品、实验、数码',   5),
  ('macro',        '微距', '微距摄影、细节特写',     6),
  ('night',        '夜景', '夜间、长曝、星空',       7),
  ('monochrome',   '黑白', '黑白摄影、影调',         8)
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
