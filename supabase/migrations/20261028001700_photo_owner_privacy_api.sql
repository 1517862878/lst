-- ============================================================================
-- 工科影展 · 0017 作品作者管理与隐私边界
-- 目的：补齐前端已声明的 PATCH/DELETE 契约，并在数据库信任边界约束 EXIF、地点与标签。
-- ============================================================================

create or replace function public.is_allowed_photo_exif(p_exif jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  select p_exif is null or (
    jsonb_typeof(p_exif) = 'object'
    and not exists (
      select 1
      from jsonb_each(p_exif) as entry(key, value)
      where entry.key not in (
        'Make', 'Model', 'LensModel', 'FNumber', 'ExposureTime', 'ISO',
        'FocalLength', 'DateTimeOriginal'
      )
      or jsonb_typeof(entry.value) in ('object', 'array')
    )
  );
$$;

comment on function public.is_allowed_photo_exif(jsonb) is
  '只允许公开 EXIF 白名单的扁平标量字段；拒绝 GPS、序列号及嵌套对象。';

alter table public.photos
  drop constraint if exists ck_photos_exif_whitelist;
alter table public.photos
  add constraint ck_photos_exif_whitelist
  check (public.is_allowed_photo_exif(exif)) not valid;

create or replace function public.are_allowed_photo_tags(p_tags text[])
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(bool_and(
    char_length(tag) between 1 and 20
    and tag !~ '[[:cntrl:]]'
  ), true)
  from unnest(coalesce(p_tags, array[]::text[])) as tag;
$$;

alter table public.photos
  drop constraint if exists ck_photos_tag_values;
alter table public.photos
  add constraint ck_photos_tag_values
  check (public.are_allowed_photo_tags(tags)) not valid;

alter table public.photos
  drop constraint if exists ck_photos_location_privacy;
alter table public.photos
  add constraint ck_photos_location_privacy
  check (
    (location_precision = 'hidden'
      and location_name = ''
      and location_lat is null
      and location_lng is null)
    or
    (location_precision in ('city', 'district')
      and location_lat is null
      and location_lng is null)
    or
    (location_precision = 'exact')
  ) not valid;

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
  v_uid uuid := auth.uid();
  v_row public.photos;
  v_location_name text := btrim(coalesce(p_location_name, ''));
  v_location_lat numeric := p_location_lat;
  v_location_lng numeric := p_location_lng;
begin
  if v_uid is null then
    raise exception '必须登录后创建作品' using errcode = '42501';
  end if;
  if p_id is null then
    raise exception '作品 id 不能为空' using errcode = '22023';
  end if;
  if p_image_key <> ('photos/' || v_uid::text || '/' || p_id::text || '/display.webp')
     or p_thumb_key <> ('photos/' || v_uid::text || '/' || p_id::text || '/thumb.webp') then
    raise exception '图片键不属于当前用户或作品' using errcode = '42501';
  end if;
  if p_license not in ('all_rights_reserved','cc_by','cc_by_nc','cc_by_nc_nd','cc0') then
    raise exception '许可类型无效' using errcode = '22023';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 60
     or p_description is null or char_length(p_description) > 2000
     or p_category_slug is null or char_length(btrim(p_category_slug)) not between 1 and 80
     or char_length(v_location_name) > 80 then
    raise exception '作品字段长度无效' using errcode = '22023';
  end if;
  if coalesce(array_length(p_tags, 1), 0) > 5
     or exists (
       select 1 from unnest(coalesce(p_tags, '{}'::text[])) as tag
       where char_length(btrim(tag)) < 1
          or char_length(btrim(tag)) > 20
          or btrim(tag) ~ '[[:cntrl:]]'
     ) then
    raise exception '标签不合法' using errcode = '22023';
  end if;
  if p_location_precision not in ('exact','district','city','hidden') then
    raise exception '地点精度无效' using errcode = '22023';
  end if;
  if not public.is_allowed_photo_exif(p_exif) then
    raise exception 'EXIF 含不允许的字段' using errcode = '23514';
  end if;
  if p_location_precision = 'hidden' then
    v_location_name := '';
    v_location_lat := null;
    v_location_lng := null;
  elsif p_location_precision in ('city','district') then
    v_location_lat := null;
    v_location_lng := null;
  end if;

  insert into public.photos(
    id, author_id, title, description, category_slug, tags,
    location_name, location_lat, location_lng, location_precision,
    shot_at, exif, image_key, thumb_key, width, height, blurhash, license, credit, status
  ) values (
    p_id, v_uid, trim(p_title), coalesce(p_description, ''), p_category_slug,
    coalesce(p_tags, '{}'::text[]), v_location_name, v_location_lat, v_location_lng,
    p_location_precision, p_shot_at, p_exif, p_image_key, p_thumb_key,
    p_width, p_height, p_blurhash, p_license, p_credit, 'draft'
  ) returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.api_update_photo(p_photo_id uuid, p_patch jsonb)
returns public.photos
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.photos;
  v_allowed_keys constant text[] := array[
    'title','description','categorySlug','tags','locationName','license','status'
  ];
  v_unknown text[];
  v_status text;
  v_title text;
  v_description text;
  v_category_slug text;
  v_location_name text;
  v_license text;
begin
  if v_uid is null then
    raise exception '必须登录后修改作品' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception '修改内容不能为空' using errcode = '22023';
  end if;

  select array_agg(key order by key) into v_unknown
  from jsonb_object_keys(p_patch) as key
  where key <> all(v_allowed_keys);
  if v_unknown is not null then
    raise exception '包含不可修改的字段: %', array_to_string(v_unknown, ',') using errcode = '22023';
  end if;

  select * into v_row
  from public.photos
  where id = p_photo_id and author_id = v_uid
  for update;
  if not found then
    raise exception '作品不存在' using errcode = 'P0002';
  end if;
  if v_row.deleted_at is not null or v_row.status = 'removed' then
    raise exception '已撤回作品不可修改' using errcode = 'P0002';
  end if;

  v_status := coalesce(p_patch->>'status', v_row.status);
  if p_patch ? 'status' and v_status <> 'removed' then
    raise exception 'status 只能用于撤回作品' using errcode = '22023';
  end if;
  if v_row.status = 'hidden' and v_status <> 'removed' then
    raise exception '审核隐藏作品只能撤回' using errcode = '22023';
  end if;

  v_title := case when p_patch ? 'title' then btrim(p_patch->>'title') else v_row.title end;
  v_description := case when p_patch ? 'description' then btrim(p_patch->>'description') else v_row.description end;
  v_category_slug := case when p_patch ? 'categorySlug' then btrim(p_patch->>'categorySlug') else v_row.category_slug end;
  v_location_name := case when p_patch ? 'locationName' then btrim(p_patch->>'locationName') else v_row.location_name end;
  v_license := case when p_patch ? 'license' then p_patch->>'license' else v_row.license end;

  if v_title is null or char_length(v_title) not between 1 and 60 then
    raise exception '标题不合法' using errcode = '22023';
  end if;
  if v_description is null or char_length(v_description) > 2000 then
    raise exception '描述不合法' using errcode = '22023';
  end if;
  if v_category_slug is null or char_length(v_category_slug) not between 1 and 80 then
    raise exception '分类不合法' using errcode = '22023';
  end if;
  if v_location_name is null or char_length(v_location_name) > 80 then
    raise exception '地点名称不合法' using errcode = '22023';
  end if;
  if v_license not in ('all_rights_reserved','cc_by','cc_by_nc','cc_by_nc_nd','cc0') then
    raise exception '许可类型无效' using errcode = '22023';
  end if;
  if p_patch ? 'tags' and (
    jsonb_typeof(p_patch->'tags') <> 'array'
    or jsonb_array_length(p_patch->'tags') > 5
    or exists (
      select 1 from jsonb_array_elements(p_patch->'tags') as tag(value)
      where jsonb_typeof(tag.value) <> 'string'
         or char_length(btrim(tag.value #>> '{}')) < 1
         or char_length(btrim(tag.value #>> '{}')) > 20
         or btrim(tag.value #>> '{}') ~ '[[:cntrl:]]'
    )
  ) then
    raise exception '标签不合法' using errcode = '22023';
  end if;

  update public.photos
  set title = v_title,
      description = v_description,
      category_slug = v_category_slug,
      tags = case when p_patch ? 'tags' then array(
        select distinct lower(btrim(value #>> '{}'))
        from jsonb_array_elements(p_patch->'tags') as tag(value)
        order by lower(btrim(value #>> '{}'))
      ) else tags end,
      location_name = v_location_name,
      license = v_license,
      status = v_status,
      deleted_at = case when v_status = 'removed' then coalesce(deleted_at, clock_timestamp()) else deleted_at end
  where id = p_photo_id
    and author_id = v_uid
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.api_remove_photo(p_photo_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_exists boolean;
begin
  if v_uid is null then
    raise exception '必须登录后撤回作品' using errcode = '42501';
  end if;
  select true into v_exists
  from public.photos
  where id = p_photo_id and author_id = v_uid;
  if not found then
    return false;
  end if;

  update public.photos
  set status = 'removed', deleted_at = coalesce(deleted_at, now())
  where id = p_photo_id
    and author_id = v_uid
    and (status <> 'removed' or deleted_at is null);
  return true;
end;
$$;

revoke all on function public.is_allowed_photo_exif(jsonb) from public, app_user;
revoke all on function public.api_create_photo(uuid,text,text,text,text[],text,numeric,numeric,text,timestamptz,jsonb,text,text,integer,integer,text,text,text) from public, app_user;
revoke all on function public.api_update_photo(uuid,jsonb) from public, app_user;
revoke all on function public.api_remove_photo(uuid) from public, app_user;
revoke update, delete on public.photos from app_user;
-- 读取仍走 photos 的 RLS；写入只能经过 SECURITY DEFINER API。
grant select on public.photos to app_user;
grant execute on function public.api_create_photo(uuid,text,text,text,text[],text,numeric,numeric,text,timestamptz,jsonb,text,text,integer,integer,text,text,text) to app_user;
grant execute on function public.api_update_photo(uuid,jsonb) to app_user;
grant execute on function public.api_remove_photo(uuid) to app_user;

-- 迁移时立即验证最关键的能力边界，避免后续默认权限变更悄悄重新放开表写入。
do $$
begin
  if has_table_privilege('app_user', 'public.photos', 'update')
     or has_table_privilege('app_user', 'public.photos', 'delete') then
    raise exception '0017 自检失败：app_user 仍可直接更新或删除 photos';
  end if;
  if not has_function_privilege('app_user', 'public.api_update_photo(uuid,jsonb)', 'execute')
     or not has_function_privilege('app_user', 'public.api_remove_photo(uuid)', 'execute') then
    raise exception '0017 自检失败：app_user 缺少作品管理函数执行权';
  end if;
end;
$$;
