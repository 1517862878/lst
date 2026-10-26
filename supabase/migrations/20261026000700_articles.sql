-- ============================================================================
-- 工科影展 · 0007 articles：教程文章与主题
-- 依据：docs/DATA-MODEL.md §3.8
-- 要点：
--   1) slug 唯一（URL 用）；body_md 存原始 Markdown，渲染与净化在前端
--   2) related_photo_ids 联动站内作品（最多 6 条）
--   3) version 每次实质更新 +1（审计用）
-- ============================================================================

create table if not exists public.articles (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique check (slug ~ '^[a-z0-9-]{1,80}$'),
  topic_slug         text not null references public.article_topics (slug),
  title              text not null check (char_length(title) between 1 and 80),
  summary            text not null default '' check (char_length(summary) <= 140),
  body_md            text not null default '',
  cover_key          text,
  author_id          uuid not null references public.profiles (id) on delete cascade,
  difficulty         text not null
                       check (difficulty in ('beginner', 'intermediate', 'advanced')),
  reading_minutes    integer not null default 1 check (reading_minutes >= 1),
  tags               text[] not null default '{}'
                       check (array_length(tags, 1) is null or array_length(tags, 1) <= 6),
  equipment          text[] not null default '{}'
                       check (array_length(equipment, 1) is null or array_length(equipment, 1) <= 6),
  related_photo_ids  text[] not null default '{}'
                       check (array_length(related_photo_ids, 1) is null or array_length(related_photo_ids, 1) <= 6),
  status             text not null default 'draft'
                       check (status in ('draft', 'published')),
  published_at       timestamptz,
  updated_at         timestamptz not null default now(),
  version            integer not null default 1 check (version >= 1),

  constraint ck_articles_published_at
    check (status <> 'published' or published_at is not null)
);

comment on table public.articles is '教程文章；body_md 为原始 Markdown，前端 marked+DOMPurify 渲染';
comment on column public.articles.version is '每次实质更新 +1，用于审计与缓存失效';

create index if not exists idx_articles_topic     on public.articles (topic_slug);
create index if not exists idx_articles_published on public.articles (published_at desc nulls last);
create index if not exists idx_articles_tags      on public.articles using gin (tags);
create index if not exists idx_articles_equipment on public.articles using gin (equipment);

-- 已发布文章的列表页主查询
create index if not exists idx_articles_feed
  on public.articles (published_at desc, id desc)
  where status = 'published';

-- ---- updated_at 自动维护 ----
drop trigger if exists trg_articles_updated_at on public.articles;
create trigger trg_articles_updated_at
  before update on public.articles
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- version 自增：内容实质变化时 +1（标题/正文/摘要/封面）
-- 为什么不放应用层：多端编辑时应用层容易漏写，数据库层是唯一可靠位置
-- ----------------------------------------------------------------------------
create or replace function public.bump_article_version()
returns trigger
language plpgsql
as $$
begin
  if new.title is distinct from old.title
     or new.body_md is distinct from old.body_md
     or new.summary is distinct from old.summary
     or new.cover_key is distinct from old.cover_key then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

comment on function public.bump_article_version() is '文章实质内容变更时 version+1';

drop trigger if exists trg_articles_bump_version on public.articles;
create trigger trg_articles_bump_version
  before update on public.articles
  for each row execute function public.bump_article_version();

-- ----------------------------------------------------------------------------
-- 发布时自动补 published_at
-- ----------------------------------------------------------------------------
create or replace function public.set_article_published_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_articles_set_published_at on public.articles;
create trigger trg_articles_set_published_at
  before insert or update of status on public.articles
  for each row execute function public.set_article_published_at();
