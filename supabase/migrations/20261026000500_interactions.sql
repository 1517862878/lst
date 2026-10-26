-- ============================================================================
-- 工科影展 · 0005 互动表：likes / favorites
-- 依据：docs/DATA-MODEL.md §3.3
-- 要点：
--   1) 主键 (user_id, photo_id)：保证"取消再点只算一次"；取消 = 删除行
--   2) (photo_id, created_at) 复合索引：周榜按时间窗口落窗查询
--   3) 计数由触发器重算（recount），不用应用层 +1/-1 —— 并发下加减必错
-- ============================================================================

-- ----------------------------------------------------------------------------
-- likes
-- ----------------------------------------------------------------------------
create table if not exists public.likes (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  photo_id   uuid not null references public.photos (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, photo_id)
);

comment on table public.likes is '点赞；(user_id, photo_id) 主键，取消即删行';

create index if not exists idx_likes_photo_created on public.likes (photo_id, created_at);
create index if not exists idx_likes_user_created  on public.likes (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- favorites
-- ----------------------------------------------------------------------------
create table if not exists public.favorites (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  photo_id   uuid not null references public.photos (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, photo_id)
);

comment on table public.favorites is '收藏；(user_id, photo_id) 主键，取消即删行';

create index if not exists idx_favorites_photo_created on public.favorites (photo_id, created_at);
create index if not exists idx_favorites_user_created  on public.favorites (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 计数重算触发器
-- 设计说明：
--   触发在互动表的 INSERT / DELETE 后，重新统计该 photo 的计数并写回 photos。
--   为什么用 count(*) 而不是 +1/-1：
--     并发点赞 100 次时，+1/-1 会因为读到过期值而漂移；count(*) 每次都是权威值。
--     代价是每次互动多一次聚合查询 —— 但 likes/favorites 都有 (photo_id) 索引，
--     单用户互动场景下开销可接受；如后期成为瓶颈，可改为增量 + 定期对账。
-- ----------------------------------------------------------------------------
create or replace function public.recount_photo_interactions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_photo uuid;
begin
  target_photo := coalesce(new.photo_id, old.photo_id);

  -- 只更新计数，避免触发 photos 的 updated_at（那会让列表缓存全失效）
  update public.photos p
     set like_count = (select count(*) from public.likes where photo_id = target_photo),
         favorite_count = (select count(*) from public.favorites where photo_id = target_photo)
   where p.id = target_photo;

  return null;
end;
$$;

comment on function public.recount_photo_interactions() is '互动表变动后重算 photos 的 like/favorite 计数（权威值，抗并发）';

drop trigger if exists trg_likes_recount on public.likes;
create trigger trg_likes_recount
  after insert or delete on public.likes
  for each row execute function public.recount_photo_interactions();

drop trigger if exists trg_favorites_recount on public.favorites;
create trigger trg_favorites_recount
  after insert or delete on public.favorites
  for each row execute function public.recount_photo_interactions();

-- ----------------------------------------------------------------------------
-- 一次性对账函数：供运维/迁移后校验计数是否漂移
-- 用法：select * from public.reconcile_photo_counts();  -- 返回所有不一致的行
-- ----------------------------------------------------------------------------
create or replace function public.reconcile_photo_counts()
returns table (photo_id uuid, stored_like int, actual_like int, stored_fav int, actual_fav int)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         p.like_count,
         (select count(*)::int from public.likes where photo_id = p.id),
         p.favorite_count,
         (select count(*)::int from public.favorites where photo_id = p.id)
    from public.photos p
   where p.like_count <> (select count(*) from public.likes where photo_id = p.id)
      or p.favorite_count <> (select count(*) from public.favorites where photo_id = p.id);
$$;

comment on function public.reconcile_photo_counts() is '对账：返回计数漂移的作品行，无输出即一致';
