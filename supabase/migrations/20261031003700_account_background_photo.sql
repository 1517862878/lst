\encoding UTF8
-- ============================================================================
-- 工科影展 · 0037 账号级外观偏好（背景照片）
--
-- 依据：docs/本轮功能-外观系统.md「待确认项 3：照片是否要跟随账号」
--
-- 需求：用户上传的背景照片原先只存本机（IndexedDB），换设备就没了。
--       本迁移让它跟随账号：登录用户把照片上传到服务器，元数据落库；
--       游客仍然走本机存储（那条路径完全不动）。
--
-- 本迁移做四件事：
--   1) profiles 增加两列：background_photo_key（对象键）与 background_photo_meta（jsonb）；
--   2) api_get_own_account_settings 带上这两列；
--   3) 新增 api_set_own_background_photo（存）与 api_clear_own_background_photo（清）；
--   4) 末尾 DO 块自检 —— 授权没落地就让迁移直接失败。
--
-- 为什么用 profiles 的两列而不是新建表：
--   一人一张背景照片、固定形状，两列足够；建表要多一套 RLS/函数/清理，
--   收益只有「将来支持多图」，而多图不在本期需求里。
--
-- 幂等（验收第 1 条：同一个库连着跑两遍）：
--   · 列：add column if not exists
--   · 约束：drop constraint if exists 之后重加
--   · 函数：一律 drop + create，随后重做 grant（不 drop function，会丢授权）
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. profiles 增加背景照片字段
-- ----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists background_photo_key  text,
  add column if not exists background_photo_meta jsonb;

comment on column public.profiles.background_photo_key is
  '背景照片对象键（形如 backgrounds/{userId}/background.webp）；null 表示未设置';
comment on column public.profiles.background_photo_meta is
  '背景照片元数据：{luma,width,height,blur,strength,focusX,focusY}，用于前端计算压暗强度';

-- 键形状约束：必须落在本人的 backgrounds/ 目录下，且不含路径穿越/控制字符。
-- 与 avatar_key 的约束风格保持一致（0018 已建立该模式）。
alter table public.profiles
  drop constraint if exists ck_profiles_background_photo_key;
alter table public.profiles
  add constraint ck_profiles_background_photo_key check (
    background_photo_key is null or (
      char_length(background_photo_key) between 1 and 512
      and background_photo_key !~ '[[:cntrl:]]'
      and background_photo_key !~ '(^|/)\.\.(/|$)'
      and background_photo_key !~ '^[A-Za-z][A-Za-z0-9+.-]*://'
      and background_photo_key ~ ('^backgrounds/' || id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*\.webp$')
    )
  );

-- CHECK 约束里不允许子查询，所以把元数据校验抽成一个 immutable 函数。
-- 函数只做纯判断（不读写表），immutable 才能在约束里安全使用。
create or replace function public.is_valid_background_meta(p_meta jsonb)
returns boolean
language sql immutable
set search_path = pg_catalog, public
as $$
  select p_meta is null or (
    jsonb_typeof(p_meta) = 'object'
    and pg_column_size(p_meta) <= 2048
    and (
      select bool_and(k in ('luma','width','height','blur','strength','focusX','focusY'))
      from jsonb_object_keys(p_meta) k
    )
    and (
      select bool_and(jsonb_typeof(v) = 'number')
      from jsonb_each(p_meta) as e(k, v)
    )
  )
$$;

comment on function public.is_valid_background_meta(jsonb) is
  '0037：背景照片元数据的形状校验（键白名单 + 值必须为数字），供 CHECK 约束与写函数复用';

-- 先删旧版（首次为不存在，幂等）
alter table public.profiles
  drop constraint if exists ck_profiles_background_photo_meta;
alter table public.profiles
  add constraint ck_profiles_background_photo_meta check (
    public.is_valid_background_meta(background_photo_meta)
  );

-- ----------------------------------------------------------------------------
-- 2. api_get_own_account_settings 带出背景照片
--
-- 按项目约定：drop + create（改返回列型必须重建），随后重做 grant。
-- 列顺序只在末尾追加两列，老调用方按名取值不受影响。
-- ----------------------------------------------------------------------------

drop function if exists public.api_get_own_account_settings();
create function public.api_get_own_account_settings()
returns table(
  id uuid, username text, display_name text, avatar_key text, bio text, role text, phone text,
  links jsonb, license_preference text, visibility text, show_likes boolean, show_favorites boolean,
  discoverable boolean, notification_preferences jsonb, created_at timestamptz, updated_at timestamptz,
  exif_visibility text, pinned_photo_ids uuid[], pinned jsonb,
  background_photo_key text, background_photo_meta jsonb
)
language sql security definer stable
set search_path = pg_catalog, public, pg_temp
as $$
  select p.id, p.username::text, p.display_name, p.avatar_key, p.bio, p.role, p.phone,
         p.links, p.license_preference, p.visibility, p.show_likes, p.show_favorites,
         p.discoverable, p.notification_preferences, p.created_at, p.updated_at,
         p.exif_visibility, p.pinned_photo_ids,
         public.profile_pinned_summaries(p.pinned_photo_ids),
         p.background_photo_key, p.background_photo_meta
  from public.profiles p
  where p.id = auth.uid() and p.deleted_at is null;
$$;

comment on function public.api_get_own_account_settings() is
  '0037 起带 background_photo_key / background_photo_meta，供外观页同步背景照片。';

-- ----------------------------------------------------------------------------
-- 3. 存 / 清 背景照片
--
-- 校验放在函数里（与 0018 api_update_own_profile 的 avatar 校验同构）：
-- 路由层只查「字段是否存在 + 类型」，形状与归属只有一处定义。
-- ----------------------------------------------------------------------------

create or replace function public.api_set_own_background_photo(
  p_key text, p_meta jsonb
) returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_key text := nullif(btrim(coalesce(p_key,'')),'');
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if v_key is null then raise exception 'BACKGROUND_KEY_REQUIRED' using errcode='22023'; end if;
  if char_length(v_key) > 512 or v_key ~ '[[:cntrl:]]'
     or v_key ~ '(^|/)\.\.(/|$)'
     or v_key !~ ('^backgrounds/' || v_uid::text || '/[A-Za-z0-9][A-Za-z0-9._-]*\.webp$')
  then raise exception 'BACKGROUND_KEY_INVALID' using errcode='22023'; end if;

  -- 形状校验复用约束用的那个 immutable 函数：规则只有一处定义
  if p_meta is null or jsonb_typeof(p_meta) <> 'object' or not public.is_valid_background_meta(p_meta) then
    raise exception 'BACKGROUND_META_INVALID' using errcode='22023';
  end if;

  update public.profiles
     set background_photo_key = v_key, background_photo_meta = p_meta
   where id = v_uid and deleted_at is null;
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode='P0002'; end if;
end
$$;

comment on function public.api_set_own_background_photo(text, jsonb) is
  '设置本人背景照片对象键与元数据；键必须落在 backgrounds/{本人}/ 下';

create or replace function public.api_clear_own_background_photo()
returns text
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_old text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  select background_photo_key into v_old from public.profiles
   where id = v_uid and deleted_at is null;
  update public.profiles
     set background_photo_key = null, background_photo_meta = null
   where id = v_uid and deleted_at is null;
  return v_old;
end
$$;

comment on function public.api_clear_own_background_photo() is
  '清除本人背景照片并返回旧对象键（调用方据此删除磁盘文件）';

-- ----------------------------------------------------------------------------
-- 4. 授权：两条新函数 + 重建 get 的授权
--
-- 注意顺序：先 revoke 再 grant；函数用 create or replace 时保留原授权，
-- 但 api_get_own_account_settings 是 drop+create，授权会一起丢，必须重做。
-- ----------------------------------------------------------------------------

revoke all on function public.api_get_own_account_settings() from public, app_user;
grant execute on function public.api_get_own_account_settings() to app_user;

revoke all on function public.api_set_own_background_photo(text, jsonb) from public, app_user;
grant execute on function public.api_set_own_background_photo(text, jsonb) to app_user;

revoke all on function public.api_clear_own_background_photo() from public, app_user;
grant execute on function public.api_clear_own_background_photo() to app_user;

revoke all on function public.is_valid_background_meta(jsonb) from public;
grant execute on function public.is_valid_background_meta(jsonb) to app_user;

-- ----------------------------------------------------------------------------
-- 5. 自检：安全边界没落地就让迁移直接失败
-- ----------------------------------------------------------------------------

do $$
declare
  v_missing text;
begin
  -- 5.1 两列必须存在
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='profiles' and column_name='background_photo_key'
  ) then raise exception '0037 自检失败：background_photo_key 列不存在'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='profiles' and column_name='background_photo_meta'
  ) then raise exception '0037 自检失败：background_photo_meta 列不存在'; end if;

  -- 5.2 app_user 不得直接读写 profiles 的这两列（必须经函数）
  if has_column_privilege('app_user', 'public.profiles', 'background_photo_key', 'UPDATE') then
    raise exception '0037 自检失败：app_user 可直接更新 background_photo_key';
  end if;

  -- 5.3 三个函数必须可执行
  if not has_function_privilege('app_user', 'public.api_get_own_account_settings()', 'EXECUTE') then
    raise exception '0037 自检失败：app_user 不能执行 api_get_own_account_settings';
  end if;
  if not has_function_privilege('app_user', 'public.api_set_own_background_photo(text, jsonb)', 'EXECUTE') then
    raise exception '0037 自检失败：app_user 不能执行 api_set_own_background_photo';
  end if;
  if not has_function_privilege('app_user', 'public.api_clear_own_background_photo()', 'EXECUTE') then
    raise exception '0037 自检失败：app_user 不能执行 api_clear_own_background_photo';
  end if;

  -- 5.4 匿名用户不得执行写函数
  if has_function_privilege('public', 'public.api_set_own_background_photo(text, jsonb)', 'EXECUTE') then
    raise exception '0037 自检失败：public 可执行 api_set_own_background_photo';
  end if;

raise notice '0037 自检通过：背景照片字段与函数授权均已落地';
end
$$;
