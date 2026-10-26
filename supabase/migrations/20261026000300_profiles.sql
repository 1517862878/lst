-- ============================================================================
-- 工科影展 · 0003 profiles：用户资料
-- 依据：docs/DATA-MODEL.md §3.1
-- 要点：
--   1) id 与 auth.users.id 1:1（鉴权身份由 Auth 托管）
--   2) username 用 citext + 唯一，保证大小写不撞车
--   3) links 用 jsonb，长度上限 ≤3 在 check 里兜住
-- ============================================================================

create table if not exists public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  username            citext not null unique
                        check (username ~ '^[a-z0-9_-]{3,20}$'),
  display_name        text not null
                        check (char_length(display_name) between 1 and 30),
  avatar_key          text,
  bio                 text not null default ''
                        check (char_length(bio) <= 160),
  role                text not null default 'user'
                        check (role in ('user', 'editor', 'admin')),
  links               jsonb not null default '[]'::jsonb
                        check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 3),
  license_preference  text not null default 'all_rights_reserved'
                        check (license_preference in
                          ('all_rights_reserved', 'cc_by', 'cc_by_nc', 'cc_by_nc_nd', 'cc0')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

comment on table public.profiles is '用户资料；id 与 auth.users.id 一致（Auth 托管身份）';
comment on column public.profiles.username is 'citext：大小写不敏感唯一，3–20 位小写字母/数字/下划线/连字符';
comment on column public.profiles.links is '主页链接数组，最多 3 条，形如 [{"label":"...","url":"..."}]';

create unique index if not exists uq_profiles_username_lower on public.profiles (lower(username::text));
create index if not exists idx_profiles_role on public.profiles (role) where deleted_at is null;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 新用户注册后自动建 profile（Supabase Auth 触发器）
-- 用户名默认取邮箱前缀，冲突时自动加数字后缀；用户首次登录后可改
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_name text;
  final_name text;
  suffix int := 0;
begin
  -- 取邮箱前缀，清洗为合法 username 字符；不足 3 位补 'user'
  base_name := lower(regexp_replace(split_part(coalesce(new.email, ''), '@', 1), '[^a-z0-9_-]', '', 'g'));
  if base_name is null or char_length(base_name) < 3 then
    base_name := 'user';
  end if;
  base_name := left(base_name, 20);
  final_name := base_name;

  -- 冲突则追加数字后缀，最多试 100 次
  while exists (select 1 from public.profiles where username = final_name) loop
    suffix := suffix + 1;
    if suffix > 100 then
      final_name := base_name || '_' || substr(new.id::text, 1, 8);
      exit;
    end if;
    final_name := base_name || suffix::text;
  end loop;

  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    final_name,
    left(coalesce(new.raw_user_meta_data ->> 'display_name', final_name), 30)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is 'Auth 新用户触发器：自动创建 profiles 行，用户名取邮箱前缀并保证唯一';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
