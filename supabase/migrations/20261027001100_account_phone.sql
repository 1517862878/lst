-- ============================================================================
-- 工科影展 · 0011 账号体系扩展（手机号 + 放开用户名格式）
--
-- 背景（用户需求）：
--   1) 账号名与密码「不限格式」，只遵守网络行为规范
--   2) 绑定个人手机号
--   3) 通过短信验证码找回密码
--   4) 测试账号：小何 / 1517862878
--
-- 原 profiles 约束 username ~ '^[a-z0-9_-]{3,20}$' 只允许小写英文数字，
-- 中文用户名（如「小何」）会被直接拒绝，必须放开。
--
-- 设计取舍：
--   - 用户名放开到：任意 Unicode 字母/数字/下划线/连字符/中文，2–20 字符
--     仍然禁止：空格、控制字符、常见符号（防止冒充与注入视觉混淆）
--   - 手机号单独一列，11 位中国大陆手机号，唯一
--   - 短信验证码存独立表，60 秒冷却、5 分钟有效、连续错误 5 次作废
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 放开 username 格式约束
--    保留 citext（大小写不敏感），仅替换 check 规则
-- ----------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_username_check;

alter table public.profiles
  add constraint ck_profiles_username_format
  check (
    username ~ '^[a-zA-Z0-9_\-\u4e00-\u9fa5]{2,20}$'
  );

comment on column public.profiles.username is
  '用户名：2–20 字符，允许中英文、数字、下划线、连字符；citext 保证大小写不敏感';

-- ----------------------------------------------------------------------------
-- 2. 手机号
--    11 位中国大陆手机号；唯一（同一号码只能绑一个账号）
--    用单独列而非放进 auth.users，因为 profiles 是业务层可见的用户资料
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists phone text;

alter table public.profiles drop constraint if exists ck_profiles_phone_format;
alter table public.profiles
  add constraint ck_profiles_phone_format
  check (phone is null or phone ~ '^1[3-9]\d{9}$');

create unique index if not exists uq_profiles_phone
  on public.profiles (phone)
  where phone is not null and deleted_at is null;

comment on column public.profiles.phone is
  '绑定手机号（11 位，唯一）；可为空，为空表示未绑定';

-- 手机号绑定时间，便于审计与风控
alter table public.profiles
  add column if not exists phone_verified_at timestamptz;

comment on column public.profiles.phone_verified_at is '手机号验证通过时间';

-- ----------------------------------------------------------------------------
-- 3. 短信验证码表
--
-- 安全要点（缺一不可）：
--   a) 验证码只存哈希，不存明文 —— 数据库泄露也无法直接使用
--   b) 60 秒内不可重复发送 —— 防刷短信费用
--   c) 5 分钟过期
--   d) 最多尝试 5 次，超过即作废 —— 防暴力猜解（6 位码空间 10^6，
--      限 5 次后成功率降到 5e-6）
--   e) 用后立即标记 consumed，不可重放
-- ----------------------------------------------------------------------------
create table if not exists public.phone_verifications (
  id           uuid primary key default gen_random_uuid(),
  phone        text not null check (phone ~ '^1[3-9]\d{9}$'),
  /** 用途：register 注册 / reset 找回密码 / bind 绑定手机 */
  purpose      text not null check (purpose in ('register', 'reset', 'bind')),
  /** 验证码哈希（sha256(phone|code|salt)），不存明文 */
  code_hash    text not null,
  /** 盐值，与 code_hash 配合校验 */
  salt         text not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  consumed_at  timestamptz,
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),

  constraint ck_phone_verif_expiry check (expires_at > created_at)
);

comment on table public.phone_verifications is
  '短信验证码记录；只存哈希，5 分钟过期，5 次尝试上限，用后 consumed';

create index if not exists idx_phone_verif_lookup
  on public.phone_verifications (phone, purpose, created_at desc)
  where consumed_at is null;

-- 同一手机号 + 用途，60 秒内只允许一条有效记录（防刷）
-- 说明：不能用 date_trunc 建索引 —— 它依赖 TimeZone 设置，不是 IMMUTABLE，
-- PostgreSQL 会拒绝「索引表达式中函数必需标记为 IMMUTABLE」。
-- 改为普通索引，冷却时间由应用层查询「最近一条 created_at」判断。
create index if not exists idx_phone_verif_cooldown
  on public.phone_verifications (phone, purpose, created_at desc)
  where consumed_at is null;

-- ----------------------------------------------------------------------------
-- 4. auth.users 增加手机号与密码哈希
--    自托管下 auth.users 是账号主表；profiles 是业务资料
-- ----------------------------------------------------------------------------
alter table auth.users
  add column if not exists phone text;

alter table auth.users
  add column if not exists phone_verified_at timestamptz;

comment on column auth.users.password_hash is '密码哈希（argon2id；由后端 API 写入，NOT 明文）';

-- 密码哈希非空校验交给应用层（注册时才写入），此处仅加长度上限防滥用
alter table auth.users drop constraint if exists ck_auth_users_pw_len;
alter table auth.users
  add constraint ck_auth_users_pw_len
  check (password_hash is null or char_length(password_hash) between 20 and 255);

-- 手机号在账号表也唯一（登录时可用手机号定位账号）
create unique index if not exists uq_auth_users_phone
  on auth.users (phone)
  where phone is not null;

-- ----------------------------------------------------------------------------
-- 5. 自动建 profile 的触发器要同步取手机号
--    原 handle_new_user 只用邮箱前缀生成 username；
--    现在注册可能只有手机号、没有邮箱，需要兼容
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
  src text;
begin
  -- 优先用邮箱前缀，其次手机号后 6 位，都没有则 user
  src := coalesce(new.email, '');
  if src = '' then
    src := coalesce(new.phone, '');
  end if;

  if src <> '' then
    base_name := lower(regexp_replace(split_part(src, '@', 1), '[^a-zA-Z0-9_-]', '', 'g'));
  else
    base_name := '';
  end if;

  if base_name is null or char_length(base_name) < 2 then
    base_name := 'user';
  end if;
  base_name := left(base_name, 18);

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

  insert into public.profiles (id, username, display_name, phone, phone_verified_at)
  values (
    new.id,
    final_name,
    left(coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'username',
      final_name
    ), 30),
    new.phone,
    new.phone_verified_at
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Auth 新用户触发器：自动创建 profiles 行，兼容邮箱或手机号注册';
