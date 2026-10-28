\encoding UTF8
-- 工科影展 · 0018 一期账号中心：资料、设置、会话与可审计注销
--
-- 安全边界：
--   * 公开资料按 username 读取，不返回稳定 user UUID；discoverable 只影响发现/搜索，
--     不影响已知 username 的直达访问。private 仅本人可见。
--   * 登录态改密只能修改 auth.uid() 自己。旧 api_set_password(uuid,text) 对 app_user
--     永久撤权；找回密码只能用一次性 reset 验证码驱动的原子函数。
--   * 注销保留 profiles 主体和治理/合规审计关联，但匿名化身份字段、删除互动，
--     软撤回内容并撤销会话；不物理删除审计记录。
--   * 所有 API 函数固定 search_path、先撤 PUBLIC/app_user 再按最小权限授权。

alter table public.profiles add column if not exists visibility text not null default 'public';
alter table public.profiles add column if not exists show_likes boolean not null default true;
alter table public.profiles add column if not exists show_favorites boolean not null default false;
alter table public.profiles add column if not exists discoverable boolean not null default true;
alter table public.profiles add column if not exists notification_preferences jsonb not null default '{"accountSecurity":true,"productUpdates":true}'::jsonb;

alter table public.profiles drop constraint if exists ck_profiles_visibility;
alter table public.profiles add constraint ck_profiles_visibility
  check (visibility in ('public','private'));
create or replace function public.valid_profile_links(p_links jsonb)
returns boolean language plpgsql immutable
set search_path = pg_catalog, public
as $$
declare item jsonb;
begin
  if p_links is null or jsonb_typeof(p_links) <> 'array' or jsonb_array_length(p_links) > 3 then
    return false;
  end if;
  for item in select value from jsonb_array_elements(p_links) loop
    if jsonb_typeof(item) <> 'object'
       or (select count(*) from jsonb_object_keys(item)) <> 2
       or not (item ? 'label' and item ? 'url')
       or jsonb_typeof(item->'label') <> 'string'
       or jsonb_typeof(item->'url') <> 'string' then
      return false;
    end if;
  end loop;
  return true;
end
$$;
revoke all on function public.valid_profile_links(jsonb) from public, app_user;
alter table public.profiles drop constraint if exists ck_profiles_links_schema;
alter table public.profiles add constraint ck_profiles_links_schema
  check (public.valid_profile_links(links));
alter table public.profiles drop constraint if exists ck_profiles_avatar_key;
alter table public.profiles add constraint ck_profiles_avatar_key check (
  avatar_key is null or (
    char_length(avatar_key) between 1 and 512
    and avatar_key !~ '[[:cntrl:]]'
    and avatar_key !~ '(^|/)\.\.(/|$)'
    and avatar_key !~ '^[A-Za-z][A-Za-z0-9+.-]*://'
  )
);
alter table public.profiles drop constraint if exists ck_profiles_notification_preferences;
alter table public.profiles add constraint ck_profiles_notification_preferences check (
  jsonb_typeof(notification_preferences) = 'object'
  and notification_preferences = jsonb_build_object(
    'accountSecurity', notification_preferences->'accountSecurity',
    'productUpdates', notification_preferences->'productUpdates'
  )
  and jsonb_typeof(notification_preferences->'accountSecurity') = 'boolean'
  and jsonb_typeof(notification_preferences->'productUpdates') = 'boolean'
);

create table if not exists public.account_deletion_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  username_snapshot text not null,
  reason text not null default '' check (char_length(reason) <= 500),
  requested_at timestamptz not null default now(),
  ip_hash text check (ip_hash is null or char_length(ip_hash) <= 128),
  user_agent text check (user_agent is null or char_length(user_agent) <= 512)
);
create index if not exists idx_account_deletion_events_user
  on public.account_deletion_events(user_id, requested_at desc);
alter table public.account_deletion_events enable row level security;
revoke all on public.account_deletion_events from public, app_user;

-- CREATE OR REPLACE 不能改变 table-returning 行型；显式 drop 使本迁移可从旧 0018 重放升级。
drop function if exists public.api_get_profile_by_username(text);
create function public.api_get_profile_by_username(p_username text)
returns table(
  username text, display_name text, avatar_key text, bio text, role text, links jsonb,
  license_preference text, visibility text, show_likes boolean, show_favorites boolean,
  discoverable boolean, created_at timestamptz, is_owner boolean
)
language sql security definer stable
set search_path = pg_catalog, public
as $$
  select p.username::text, p.display_name, p.avatar_key, p.bio, p.role, p.links,
         p.license_preference, p.visibility, p.show_likes, p.show_favorites,
         p.discoverable, p.created_at, auth.uid() = p.id
  from public.profiles p
  where lower(p.username::text) = lower(btrim(coalesce(p_username,'')))
    and p.deleted_at is null
    and (p.visibility = 'public' or auth.uid() = p.id)
  limit 1
$$;
comment on function public.api_get_profile_by_username(text) is
  '直达公开资料；discoverable 只供发现/搜索过滤，不阻止已知 username 直达；不返回 user UUID';

-- 只允许登录态取得自己的身份资料，供 session/auth 内部读取，替代 profiles/:id 隐私旁路。
drop function if exists public.api_get_own_profile();
create function public.api_get_own_profile()
returns table(
  id uuid, username text, display_name text, avatar_key text, bio text, role text, links jsonb,
  license_preference text, created_at timestamptz, updated_at timestamptz, deleted_at timestamptz
)
language sql security definer stable
set search_path = pg_catalog, public
as $$
  select p.id, p.username::text, p.display_name, p.avatar_key, p.bio, p.role, p.links,
         p.license_preference, p.created_at, p.updated_at, p.deleted_at
  from public.profiles p
  where p.id = auth.uid() and p.deleted_at is null
$$;

drop function if exists public.api_get_own_account_settings();
create function public.api_get_own_account_settings()
returns table(
  id uuid, username text, display_name text, avatar_key text, bio text, role text, phone text,
  links jsonb, license_preference text, visibility text, show_likes boolean, show_favorites boolean,
  discoverable boolean, notification_preferences jsonb, created_at timestamptz, updated_at timestamptz
)
language sql security definer stable
set search_path = pg_catalog, public
as $$
  select p.id, p.username::text, p.display_name, p.avatar_key, p.bio, p.role, p.phone,
         p.links, p.license_preference, p.visibility, p.show_likes, p.show_favorites,
         p.discoverable, p.notification_preferences, p.created_at, p.updated_at
  from public.profiles p
  where p.id = auth.uid() and p.deleted_at is null
$$;

-- 精确按当前 userId 取凭据；不经过可变 username/phone，避免 TOCTOU 和错绑账号。
drop function if exists public.api_get_own_credential();
create function public.api_get_own_credential()
returns table(user_id uuid, password_hash text)
language sql security definer stable
set search_path = pg_catalog, public
as $$
  select u.id, u.password_hash
  from auth.users u join public.profiles p on p.id = u.id
  where u.id = auth.uid() and p.deleted_at is null
$$;

create or replace function public.api_update_own_profile(
  p_display_name text, p_bio text, p_links jsonb, p_license_preference text, p_avatar_key text
) returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_invalid boolean;
  v_avatar text := nullif(btrim(coalesce(p_avatar_key,'')),'');
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if p_display_name is null or char_length(btrim(p_display_name)) not between 1 and 30
     or btrim(p_display_name) ~ '[[:cntrl:]]' then
    raise exception 'DISPLAY_NAME_INVALID' using errcode='22023';
  end if;
  if p_bio is null or char_length(p_bio) > 160 or p_bio ~ '[\x00]' then
    raise exception 'BIO_INVALID' using errcode='22023';
  end if;
  if p_links is null or jsonb_typeof(p_links) <> 'array' or jsonb_array_length(p_links) > 3 then
    raise exception 'LINKS_INVALID' using errcode='22023';
  end if;
  select coalesce(bool_or(
    jsonb_typeof(link) <> 'object'
    or (select count(*) from jsonb_object_keys(link)) <> 2
    or not (link ? 'label' and link ? 'url')
    or jsonb_typeof(link->'label') <> 'string'
    or jsonb_typeof(link->'url') <> 'string'
    or char_length(btrim(link->>'label')) not between 1 and 40
    or (link->>'label') ~ '[[:cntrl:]]'
    or char_length(link->>'url') not between 1 and 500
    or (link->>'url') !~ '^https://[^/?#[:space:]@]+(?::[0-9]{1,5})?(?:[/?#][^[:space:][:cntrl:]]*)?$'
  ), false) into v_invalid from jsonb_array_elements(p_links) link;
  if v_invalid then raise exception 'LINKS_INVALID' using errcode='22023'; end if;
  if p_license_preference is null or p_license_preference not in
    ('all_rights_reserved','cc_by','cc_by_nc','cc_by_nc_nd','cc0') then
    raise exception 'LICENSE_INVALID' using errcode='22023';
  end if;
  if v_avatar is not null and (
    char_length(v_avatar) > 512 or v_avatar ~ '[[:cntrl:]]'
    or v_avatar ~ '(^|/)\.\.(/|$)'
    or v_avatar ~ '^[A-Za-z][A-Za-z0-9+.-]*://'
    or v_avatar !~ ('^avatars/' || v_uid::text || '/[A-Za-z0-9][A-Za-z0-9._/-]*$')
  ) then raise exception 'AVATAR_INVALID' using errcode='22023'; end if;

  update public.profiles
     set display_name=btrim(p_display_name), bio=p_bio, links=p_links,
         license_preference=p_license_preference, avatar_key=v_avatar
   where id=v_uid and deleted_at is null;
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode='P0002'; end if;
end
$$;

create or replace function public.api_update_own_preferences(
  p_visibility text, p_show_likes boolean, p_show_favorites boolean, p_discoverable boolean,
  p_notification_preferences jsonb
) returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if p_visibility is null or p_visibility not in ('public','private') then
    raise exception 'VISIBILITY_INVALID' using errcode='22023';
  end if;
  if p_show_likes is null or p_show_favorites is null or p_discoverable is null then
    raise exception 'PREFERENCES_INVALID' using errcode='22023';
  end if;
  if p_notification_preferences is null
     or jsonb_typeof(p_notification_preferences) <> 'object'
     or (select count(*) from jsonb_object_keys(p_notification_preferences)) <> 2
     or not (p_notification_preferences ? 'accountSecurity' and p_notification_preferences ? 'productUpdates')
     or jsonb_typeof(p_notification_preferences->'accountSecurity') <> 'boolean'
     or jsonb_typeof(p_notification_preferences->'productUpdates') <> 'boolean' then
    raise exception 'PREFERENCES_INVALID' using errcode='22023';
  end if;
  update public.profiles
     set visibility=p_visibility, show_likes=p_show_likes, show_favorites=p_show_favorites,
         discoverable=p_discoverable, notification_preferences=p_notification_preferences
   where id=auth.uid() and deleted_at is null;
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode='P0002'; end if;
end
$$;

drop function if exists public.api_list_own_sessions();
create function public.api_list_own_sessions()
returns table(id uuid, user_agent text, created_at timestamptz, last_seen_at timestamptz, expires_at timestamptz)
language sql security definer stable
set search_path = pg_catalog, public
as $$
  select s.id, s.user_agent, s.created_at, s.last_seen_at, s.expires_at
  from public.security_sessions s
  where s.user_id=auth.uid() and s.revoked_at is null and s.expires_at > now()
  order by s.last_seen_at desc
$$;

create or replace function public.api_revoke_own_session(p_session_id uuid)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  update public.security_sessions set revoked_at=clock_timestamp(), revoke_reason='admin'
   where id=p_session_id and user_id=auth.uid() and revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count > 0;
end
$$;

-- 登录态改密：目标身份只能来自 auth.uid()，不能由调用方指定。
create or replace function public.api_set_own_password(p_password_hash text)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if p_password_hash is null or char_length(p_password_hash) not between 20 and 255 then
    raise exception 'PASSWORD_HASH_INVALID' using errcode='22023';
  end if;
  update auth.users set password_hash=p_password_hash where id=v_uid;
  if not found then raise exception 'ACCOUNT_NOT_FOUND' using errcode='P0002'; end if;
  update public.security_sessions set revoked_at=clock_timestamp(), revoke_reason='password_changed'
   where user_id=v_uid and revoked_at is null;
end
$$;

-- 找回密码的隔离边界：验证、消费 reset 验证码、按该验证码绑定手机号定位账号、改密和
-- 撤销会话必须处于同一事务。app_user 无法传 userId，也无法复用已消费验证码。
drop function if exists public.api_reset_password_with_code(uuid,text,text,text);
create function public.api_reset_password_with_code(
  p_code_id uuid, p_phone text, p_code_hash text, p_password_hash text
) returns table(ok boolean, reason text, attempts integer, locked boolean)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_code public.phone_verifications;
  v_uid uuid;
  v_attempts integer;
begin
  if p_password_hash is null or char_length(p_password_hash) not between 20 and 255 then
    raise exception 'PASSWORD_HASH_INVALID' using errcode='22023';
  end if;
  select * into v_code from public.phone_verifications where id=p_code_id for update;
  if not found or v_code.phone<>btrim(coalesce(p_phone,'')) or v_code.purpose<>'reset'
     or v_code.consumed_at is not null then
    return query select false,'invalid_code'::text,0,false; return;
  end if;
  if v_code.expires_at<=now() then
    update public.phone_verifications set consumed_at=coalesce(consumed_at,clock_timestamp()) where id=p_code_id;
    return query select false,'expired'::text,v_code.attempt_count,false; return;
  end if;
  if v_code.attempt_count>=5 then
    update public.phone_verifications set consumed_at=coalesce(consumed_at,clock_timestamp()) where id=p_code_id;
    return query select false,'locked'::text,v_code.attempt_count,true; return;
  end if;
  if v_code.code_hash<>p_code_hash then
    v_attempts := v_code.attempt_count + 1;
    update public.phone_verifications
       set attempt_count=v_attempts,
           consumed_at=case when v_attempts>=5 then clock_timestamp() else consumed_at end
     where id=p_code_id;
    return query select false,case when v_attempts>=5 then 'locked' else 'mismatch' end,
                        v_attempts,v_attempts>=5; return;
  end if;
  select p.id into v_uid
    from public.profiles p
   where p.phone=v_code.phone and p.deleted_at is null
   for update;
  if v_uid is null then
    update public.phone_verifications set consumed_at=clock_timestamp() where id=p_code_id;
    return query select false,'invalid_code'::text,0,false; return;
  end if;
  update public.phone_verifications set consumed_at=clock_timestamp() where id=p_code_id;
  update auth.users set password_hash=p_password_hash where id=v_uid;
  if not found then raise exception 'ACCOUNT_NOT_FOUND' using errcode='P0002'; end if;
  update public.security_sessions set revoked_at=clock_timestamp(), revoke_reason='password_changed'
   where user_id=v_uid and revoked_at is null;
  return query select true,null::text,v_code.attempt_count,false;
end
$$;

create or replace function public.api_delete_own_account(p_reason text, p_ip_hash text, p_user_agent text)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_username text;
  v_deleted_at timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  select username::text into v_username
    from public.profiles where id=v_uid and deleted_at is null for update;
  if v_username is null then raise exception 'PROFILE_NOT_FOUND' using errcode='P0002'; end if;

  insert into public.account_deletion_events(user_id, username_snapshot, reason, ip_hash, user_agent)
  values(v_uid, v_username, left(coalesce(p_reason,''),500), left(p_ip_hash,128), left(p_user_agent,512));

  update public.security_sessions set revoked_at=v_deleted_at, revoke_reason='admin'
   where user_id=v_uid and revoked_at is null;
  delete from public.likes where user_id=v_uid;
  delete from public.favorites where user_id=v_uid;
  update public.comments
     set body='[账号已注销]', status='removed', deleted_at=coalesce(deleted_at,v_deleted_at)
   where author_id=v_uid;
  update public.photos
     set title='已注销用户作品', description='', tags='{}', location_name='',
         location_lat=null, location_lng=null, location_precision='hidden', shot_at=null, exif=null,
         credit=null, status='removed', deleted_at=coalesce(deleted_at,v_deleted_at)
   where author_id=v_uid;
  update public.articles
     set title='已注销用户文章', summary='', body_md='', cover_key=null, tags='{}', equipment='{}',
         related_photo_ids='{}', status='draft', published_at=null
   where author_id=v_uid;
  update public.profiles
     set username=('del_' || left(replace(v_uid::text,'-',''),16))::citext,
         display_name='已注销用户', avatar_key=null, bio='', links='[]'::jsonb,
         visibility='private', show_likes=false, show_favorites=false, discoverable=false,
         notification_preferences='{"accountSecurity":false,"productUpdates":false}'::jsonb,
         phone=null, phone_verified_at=null, deleted_at=v_deleted_at
   where id=v_uid;
  update auth.users
     set phone=null, email=null, password_hash=null, raw_user_meta_data='{}'::jsonb
   where id=v_uid;
end
$$;
comment on function public.api_delete_own_account(text,text,text) is
  '匿名化业务身份并软撤回用户内容；保留 profiles 主体及举报、制裁、审核、法律同意、注销事件等审计关联';

-- 旧任意 userId setter 必须同时收回 PUBLIC 和 app_user；仅数据库 owner 可用于紧急运维。
revoke all on function public.api_set_password(uuid,text) from public, app_user;
comment on function public.api_set_password(uuid,text) is
  'LEGACY/OWNER-ONLY：不得由应用调用。登录态用 api_set_own_password；找回用 api_reset_password_with_code';

revoke all on function public.api_get_profile_by_username(text) from public, app_user;
revoke all on function public.api_get_own_profile() from public, app_user;
revoke all on function public.api_get_own_account_settings() from public, app_user;
revoke all on function public.api_get_own_credential() from public, app_user;
revoke all on function public.api_update_own_profile(text,text,jsonb,text,text) from public, app_user;
revoke all on function public.api_update_own_preferences(text,boolean,boolean,boolean,jsonb) from public, app_user;
revoke all on function public.api_list_own_sessions() from public, app_user;
revoke all on function public.api_revoke_own_session(uuid) from public, app_user;
revoke all on function public.api_set_own_password(text) from public, app_user;
revoke all on function public.api_reset_password_with_code(uuid,text,text,text) from public, app_user;
revoke all on function public.api_delete_own_account(text,text,text) from public, app_user;

grant execute on function public.api_get_profile_by_username(text) to app_user;
grant execute on function public.api_get_own_profile() to app_user;
grant execute on function public.api_get_own_account_settings() to app_user;
grant execute on function public.api_get_own_credential() to app_user;
grant execute on function public.api_update_own_profile(text,text,jsonb,text,text) to app_user;
grant execute on function public.api_update_own_preferences(text,boolean,boolean,boolean,jsonb) to app_user;
grant execute on function public.api_list_own_sessions() to app_user;
grant execute on function public.api_revoke_own_session(uuid) to app_user;
grant execute on function public.api_set_own_password(text) to app_user;
grant execute on function public.api_reset_password_with_code(uuid,text,text,text) to app_user;
grant execute on function public.api_delete_own_account(text,text,text) to app_user;

do $$
begin
  if has_function_privilege('app_user','public.api_set_password(uuid,text)','EXECUTE') then
    raise exception '0018 自检失败：app_user 仍可调用任意用户改密函数';
  end if;
  if not has_function_privilege('app_user','public.api_set_own_password(text)','EXECUTE')
     or not has_function_privilege('app_user','public.api_reset_password_with_code(uuid,text,text,text)','EXECUTE') then
    raise exception '0018 自检失败：安全改密函数未授权';
  end if;
end
$$;
