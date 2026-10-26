-- ============================================================================
-- 工科影展 · 0004 photos：作品
-- 依据：docs/DATA-MODEL.md §3.2
-- 要点：
--   1) 四个计数器（like/favorite/comment/view）只读派生，由触发器重算，禁止应用层手写
--   2) tags ≤5 且全小写；exif 只允许白名单键
--   3) status 状态机：draft → published → hidden/removed
--   4) 索引覆盖列表页排序（published_at desc）与分类过滤
-- ============================================================================

create table if not exists public.photos (
  id                 uuid primary key default gen_random_uuid(),
  author_id          uuid not null references public.profiles (id) on delete cascade,
  title              text not null check (char_length(title) between 1 and 60),
  description        text not null default '' check (char_length(description) <= 2000),
  category_slug      text not null references public.categories (slug),
  tags               text[] not null default '{}'
                       check (array_length(tags, 1) is null or array_length(tags, 1) <= 5),
  location_name      text not null default '' check (char_length(location_name) <= 80),
  location_lat       numeric(9, 6) check (location_lat between -90 and 90),
  location_lng       numeric(9, 6) check (location_lng between -180 and 180),
  location_precision text not null default 'city'
                       check (location_precision in ('exact', 'district', 'city', 'hidden')),
  shot_at            timestamptz,
  exif               jsonb
                       check (exif is null or jsonb_typeof(exif) = 'object'),
  image_key          text not null check (char_length(image_key) between 1 and 512),
  thumb_key          text not null check (char_length(thumb_key) between 1 and 512),
  width              integer not null check (width > 0),
  height             integer not null check (height > 0),
  blurhash           text,
  license            text not null default 'all_rights_reserved'
                       check (license in
                         ('all_rights_reserved', 'cc_by', 'cc_by_nc', 'cc_by_nc_nd', 'cc0')),
  credit             text,
  status             text not null default 'draft'
                       check (status in ('draft', 'published', 'hidden', 'removed')),
  like_count         integer not null default 0 check (like_count >= 0),
  favorite_count     integer not null default 0 check (favorite_count >= 0),
  comment_count      integer not null default 0 check (comment_count >= 0),
  view_count         integer not null default 0 check (view_count >= 0),
  published_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,

  -- 业务一致性：published 必须有发布时间；非 published 不该有（removed 保留原值，故只约束前两种）
  constraint ck_photos_published_at
    check (
      (status = 'published' and published_at is not null)
      or (status in ('draft', 'hidden', 'removed'))
    )
);

comment on table public.photos is '摄影作品；四个计数只读派生，由触发器重算';
comment on column public.photos.exif is '仅白名单键：Make/Model/LensModel/FNumber/ExposureTime/ISO/FocalLength/DateTimeOriginal';
comment on column public.photos.published_at is 'published 状态必填；用于列表排序与周榜资格判定';

-- ---- 索引（对应 DATA-MODEL §3.2 的索引列）----
create index if not exists idx_photos_author    on public.photos (author_id);
create index if not exists idx_photos_category  on public.photos (category_slug);
create index if not exists idx_photos_status    on public.photos (status);
create index if not exists idx_photos_published on public.photos (published_at desc nulls last);
create index if not exists idx_photos_tags      on public.photos using gin (tags);

-- 列表页主查询：已发布、未删除、按发布时间倒序（keyset 分页走这个复合索引）
create index if not exists idx_photos_feed
  on public.photos (published_at desc, id desc)
  where status = 'published' and deleted_at is null;

-- 分类页：分类 + 发布时间倒序
create index if not exists idx_photos_feed_category
  on public.photos (category_slug, published_at desc, id desc)
  where status = 'published' and deleted_at is null;

-- 小编与作者查草稿用
create index if not exists idx_photos_author_status
  on public.photos (author_id, status)
  where deleted_at is null;

-- ---- updated_at 自动维护 ----
drop trigger if exists trg_photos_updated_at on public.photos;
create trigger trg_photos_updated_at
  before update on public.photos
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 标签规范化：入库前统一小写、去空格，防止 "Landscape" 与 "landscape" 不一致
-- ----------------------------------------------------------------------------
create or replace function public.normalize_photo_tags()
returns trigger
language plpgsql
as $$
begin
  if new.tags is not null then
    select coalesce(array_agg(distinct lower(btrim(t))), '{}')
      into new.tags
      from unnest(new.tags) as t
     where btrim(t) <> '';
  end if;
  return new;
end;
$$;

comment on function public.normalize_photo_tags() is 'tags 入库前统一小写去重去空格';

drop trigger if exists trg_photos_normalize_tags on public.photos;
create trigger trg_photos_normalize_tags
  before insert or update of tags on public.photos
  for each row execute function public.normalize_photo_tags();

-- ----------------------------------------------------------------------------
-- 发布状态流转：draft → published 时自动补 published_at
-- 好处：应用层不必记得写这个字段，避免出现 published 但 published_at 为空
-- ----------------------------------------------------------------------------
create or replace function public.set_published_at()
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

comment on function public.set_published_at() is 'publish 时自动补 published_at，避免应用层遗漏';

drop trigger if exists trg_photos_set_published_at on public.photos;
create trigger trg_photos_set_published_at
  before insert or update of status on public.photos
  for each row execute function public.set_published_at();
