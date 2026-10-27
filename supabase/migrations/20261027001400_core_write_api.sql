\encoding UTF8
-- ============================================================================
-- 工科影展 · 0014 核心写入 API
-- 目标：把作品、互动与评论写入收口到窄范围 SECURITY DEFINER 函数。
-- 身份只来自 auth.uid()，不信任客户端 author_id / user_id。
-- ============================================================================

-- ---- 私有辅助：只有已发布且未删除的作品可以互动 ----
create or replace function public.api_assert_interactable_photo(p_photo_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.photos p
     where p.id = p_photo_id
       and p.status = 'published'
       and p.deleted_at is null
  ) then
    raise exception '作品不存在或不可互动' using errcode = 'P0002';
  end if;
end;
$$;

-- ---- 创建草稿：ID 由客户端预生成，以便文件键与数据库记录保持一致 ----
create or replace function public.api_create_photo(
  p_id uuid,
  p_title text,
  p_description text,
  p_category_slug text,
  p_tags text[],
  p_location_name text,
  p_location_lat numeric,
  p_location_lng numeric,
  p_location_precision text,
  p_shot_at timestamptz,
  p_exif jsonb,
  p_image_key text,
  p_thumb_key text,
  p_width integer,
  p_height integer,
  p_blurhash text,
  p_license text,
  p_credit text
)
returns public.photos
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_row public.photos;
  v_prefix text;
begin
  if v_user is null then
    raise exception '请先登录' using errcode = '42501';
  end if;
  v_prefix := 'photos/' || v_user::text || '/' || p_id::text || '/';
  if p_image_key <> v_prefix || 'display.webp'
     or p_thumb_key <> v_prefix || 'thumb.webp' then
    raise exception '图片键必须属于当前用户与当前作品' using errcode = '42501';
  end if;

  insert into public.photos (
    id, author_id, title, description, category_slug, tags,
    location_name, location_lat, location_lng, location_precision,
    shot_at, exif, image_key, thumb_key, width, height, blurhash,
    license, credit, status
  ) values (
    p_id, v_user, p_title, coalesce(p_description, ''), p_category_slug, coalesce(p_tags, '{}'),
    coalesce(p_location_name, ''), p_location_lat, p_location_lng, p_location_precision,
    p_shot_at, p_exif, p_image_key, p_thumb_key, p_width, p_height, p_blurhash,
    p_license, p_credit, 'draft'
  ) returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.api_publish_photo(p_photo_id uuid)
returns public.photos
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_row public.photos;
begin
  if v_user is null then
    raise exception '请先登录' using errcode = '42501';
  end if;
  update public.photos
     set status = 'published', published_at = clock_timestamp()
   where id = p_photo_id
     and author_id = v_user
     and status = 'draft'
     and deleted_at is null
  returning * into v_row;
  if found then return v_row; end if;

  select * into v_row from public.photos
   where id = p_photo_id and author_id = v_user and status = 'published' and deleted_at is null;
  if found then return v_row; end if;
  raise exception '作品不存在、无权发布或状态不允许' using errcode = 'P0002';
end;
$$;

-- ---- 点赞/收藏：显式目标状态，函数本身幂等 ----
create or replace function public.api_set_like(p_photo_id uuid, p_liked boolean)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception '请先登录' using errcode = '42501'; end if;
  perform public.api_assert_interactable_photo(p_photo_id);
  if p_liked then
    insert into public.likes(user_id, photo_id) values (v_user, p_photo_id)
    on conflict (user_id, photo_id) do nothing;
  else
    delete from public.likes where user_id = v_user and photo_id = p_photo_id;
  end if;
  return p_liked;
end;
$$;

create or replace function public.api_set_favorite(p_photo_id uuid, p_favorited boolean)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception '请先登录' using errcode = '42501'; end if;
  perform public.api_assert_interactable_photo(p_photo_id);
  if p_favorited then
    insert into public.favorites(user_id, photo_id) values (v_user, p_photo_id)
    on conflict (user_id, photo_id) do nothing;
  else
    delete from public.favorites where user_id = v_user and photo_id = p_photo_id;
  end if;
  return p_favorited;
end;
$$;

-- ---- 评论：创建与软删 ----
create or replace function public.api_create_comment(
  p_photo_id uuid,
  p_parent_id uuid,
  p_body text
)
returns public.comments
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_row public.comments;
  v_parent public.comments;
begin
  if v_user is null then raise exception '请先登录' using errcode = '42501'; end if;
  perform public.api_assert_interactable_photo(p_photo_id);

  if p_parent_id is not null then
    select * into v_parent from public.comments
     where id = p_parent_id and photo_id = p_photo_id
       and parent_id is null and status = 'visible' and deleted_at is null;
    if not found then
      raise exception '父评论不存在、已删除或不是顶层评论' using errcode = '23514';
    end if;
  end if;

  insert into public.comments(photo_id, author_id, parent_id, body)
  values (p_photo_id, v_user, p_parent_id, btrim(p_body))
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.api_remove_comment(p_comment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_photo_id uuid;
begin
  if v_user is null then raise exception '请先登录' using errcode = '42501'; end if;
  update public.comments
     set status = 'removed'
   where id = p_comment_id
     and author_id = v_user
     and status <> 'removed'
  returning photo_id into v_photo_id;
  if found then return v_photo_id; end if;

  select photo_id into v_photo_id from public.comments
   where id = p_comment_id and author_id = v_user and status = 'removed';
  if found then return v_photo_id; end if;
  raise exception '评论不存在或无权删除' using errcode = 'P0002';
end;
$$;

-- ---- 收紧敏感表与函数能力 ----
revoke update, delete on public.photos from app_user;
revoke insert, update, delete on public.likes from app_user;
revoke insert, update, delete on public.favorites from app_user;
revoke insert, update, delete on public.comments from app_user;

-- 互动明细仅本人可读；聚合计数仍从 photos 返回。
drop policy if exists p_likes_select on public.likes;
create policy p_likes_select on public.likes for select using (user_id = auth.uid());
drop policy if exists p_favorites_select on public.favorites;
create policy p_favorites_select on public.favorites for select using (user_id = auth.uid());

revoke all on function public.api_assert_interactable_photo(uuid) from public, app_user;
revoke all on function public.api_create_photo(uuid,text,text,text,text[],text,numeric,numeric,text,timestamptz,jsonb,text,text,integer,integer,text,text,text) from public, app_user;
revoke all on function public.api_publish_photo(uuid) from public, app_user;
revoke all on function public.api_set_like(uuid,boolean) from public, app_user;
revoke all on function public.api_set_favorite(uuid,boolean) from public, app_user;
revoke all on function public.api_create_comment(uuid,uuid,text) from public, app_user;
revoke all on function public.api_remove_comment(uuid) from public, app_user;

grant execute on function public.api_create_photo(uuid,text,text,text,text[],text,numeric,numeric,text,timestamptz,jsonb,text,text,integer,integer,text,text,text) to app_user;
grant execute on function public.api_publish_photo(uuid) to app_user;
grant execute on function public.api_set_like(uuid,boolean) to app_user;
grant execute on function public.api_set_favorite(uuid,boolean) to app_user;
grant execute on function public.api_create_comment(uuid,uuid,text) to app_user;
grant execute on function public.api_remove_comment(uuid) to app_user;
