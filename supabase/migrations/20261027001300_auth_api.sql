-- ============================================================================
-- 工科影展 · 0013 鉴权接口支撑层（后端第 2 步：鉴权）
--
-- 背景：第 1 步的 API 是只读的，且 `auth.users` 对 app_user 只有 SELECT、
--       phone_verifications 连 RLS 都没开。真要做注册/登录，必须先补这层。
--
-- 本文件解决 4 件事：
--   1) 注册要往 auth.users 写 —— 但 app_user 没有 INSERT 权限
--      → 用 security definer 函数开户，而不是给 app_user 开表权限
--   2) app_user 当前能直接 SELECT auth.users，即能读到全库 password_hash
--      → 收回直读，凭据只经 definer 函数按需取
--   3) phone_verifications 上 RLS 是关的，没有任何兜底
--      → 开 RLS（无策略 = 默认拒绝），验证码只经 definer 函数读写
--   4) 密码/验证码的哈希在 Node 侧算（要 crypto），库里只存结果
--
-- 为什么用 security definer 而不是给 app_user 授权：
--   给 auth.users 开 INSERT/UPDATE 就等于让 API 那条连接能改任何人的密码哈希。
--   definer 函数把「能做什么」收窄成几个明确动作，权限面小得多。
--
-- 【重要】函数里所有正则都用 '^[a-zA-Z0-9_\-\u4e00-\u9fa5]{2,20}$'。
--   PostgreSQL 的 ARE 正则引擎支持 \uXXXX 转义（4 位十六进制），
--   所以此处等价于 [一-龥]，中文用户名可用。已实测确认。
--   （standard_conforming_strings=on 时 SQL 字面量不处理 \u，
--     但正则引擎会处理，两回事，不要被字面量误导。）
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 收紧 auth.users
--    开启 RLS（无策略 = 对非属主一律拒绝），并收回 app_user 的直读权限。
--    属主 postgres 是超级用户，不受 RLS 影响，definer 函数照常工作。
-- ---------------------------------------------------------------------------
alter table auth.users enable row level security;

revoke select on auth.users from app_user;

comment on table auth.users is
  '自托管替身：账号主表。已开 RLS 且 app_user 无直读权限，'
  '凭据只能经 public.api_find_credential / api_register_account 等 definer 函数访问';

-- ---------------------------------------------------------------------------
-- 2. 收紧 phone_verifications
--    原来 RLS 未启用且 app_user 有全量增删改查 —— 任何查询失误都能读到别人的验证码。
--    现在只允许经 definer 函数访问。
-- ---------------------------------------------------------------------------
alter table public.phone_verifications enable row level security;

revoke insert, update, delete, select, truncate, references
  on public.phone_verifications from app_user;

comment on table public.phone_verifications is
  '短信验证码记录；只存哈希，5 分钟过期，5 次尝试上限，用后 consumed。'
  'RLS 已启用且无策略，app_user 不能直读，只能经 public.api_* 函数';

-- ---------------------------------------------------------------------------
-- 3. 开户：注册
--
--    流程：建 auth.users 行（触发器 on_auth_user_created 顺带建 profiles）
--          → 再把用户名/昵称改写成用户自选值
--
--    为什么必须改写：handle_new_user() 是用「邮箱前缀」或「手机号」推导用户名的，
--    清洗规则会把中文全删掉（「小何」→ 空 → 'user'），且注册时可能既无邮箱
--    又未绑定手机。所以用户自选用户名必须由本函数显式写入。
--
--    错误码约定（与后端 lib/errors.ts 的 translateDbError 对齐）：
--      23514 check_violation      → 前端 VALIDATION（参数不合法）
--      23505 unique_violation     → 前端 CONFLICT（已存在）
-- ---------------------------------------------------------------------------
create or replace function public.api_register_account(
  p_username      text,
  p_display_name  text,
  p_password_hash text,
  p_phone         text default null
)
returns table (
  user_id      uuid,
  user_name    text,
  display_name text,
  user_role    text,
  phone        text,
  created_at   timestamptz
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_username text := btrim(coalesce(p_username, ''));
  v_display  text := btrim(coalesce(p_display_name, ''));
  v_phone    text := nullif(btrim(coalesce(p_phone, '')), '');
  v_id       uuid;
begin
  -- 用户名：2–20 字符，允许中英文、数字、下划线、连字符（用户明确要求「不限格式」，
  -- 但仍禁止空格与符号，防止冒充和视觉混淆）
  if v_username !~ '^[a-zA-Z0-9_\-\u4e00-\u9fa5]{2,20}$' then
    raise exception '用户名需 2–20 个字符，只能用中英文、数字、下划线、连字符'
      using errcode = '23514';
  end if;

  if char_length(v_display) < 1 or char_length(v_display) > 30 then
    raise exception '昵称需 1–30 个字符' using errcode = '23514';
  end if;

  -- 密码哈希长度与 auth.users 的 ck_auth_users_pw_len 约束一致
  if p_password_hash is null or char_length(p_password_hash) not between 20 and 255 then
    raise exception '密码哈希不合法' using errcode = '23514';
  end if;

  if v_phone is not null
     and not (char_length(v_phone) between 4 and 20 and v_phone ~ '^[0-9+\- ]+$') then
    raise exception '手机号格式不合法（4–20 位，可用数字、+、-、空格）'
      using errcode = '23514';
  end if;

  -- 先查再插，为的是给出中文友好错误；唯一索引仍是最终保证
  if exists (
    select 1 from public.profiles p
     where p.username = v_username::citext and p.deleted_at is null
  ) then
    raise exception '用户名已被占用' using errcode = '23505';
  end if;

  if v_phone is not null
     and exists (select 1 from auth.users u where u.phone = v_phone) then
    raise exception '该手机号已绑定其他账号' using errcode = '23505';
  end if;

  -- 别名 + 限定列名：本函数有 OUT 参数 id，不限定会和列名撞车
  insert into auth.users as au (email, phone, password_hash, raw_user_meta_data)
  values (
    null,
    v_phone,
    p_password_hash,
    jsonb_build_object('username', v_username, 'display_name', v_display)
  )
  returning au.id into v_id;

  -- 覆盖触发器推导出来的用户名/昵称
  update public.profiles p
     set username     = v_username::citext,
         display_name = v_display,
         phone        = v_phone
   where p.id = v_id;

  return query
    select u.id, p.username::text, p.display_name, p.role, p.phone, p.created_at
      from auth.users u
      join public.profiles p on p.id = u.id
     where u.id = v_id;
end;
$$;

comment on function public.api_register_account(text, text, text, text) is
  '注册开户：建 auth.users + 覆盖 profiles 用户名。security definer，app_user 无 auth.users 写权限';

-- ---------------------------------------------------------------------------
-- 4. 登录：按「用户名 或 手机号」取凭据
--
--    为什么单独一个函数：登录时还不知道用户 id，没法用 RLS 表达「查我自己」。
--    函数只返回一条精确匹配的记录，且不返回 email 等无关字段。
--    密码比对在 Node 侧做（argon2id 只有 Node 能算）。
-- ---------------------------------------------------------------------------
create or replace function public.api_find_credential(p_identifier text)
returns table (
  user_id       uuid,
  user_name     text,
  display_name  text,
  user_role     text,
  phone         text,
  password_hash text,
  deleted_at    timestamptz
)
language sql
security definer
set search_path = public, auth, pg_temp
stable
as $$
  select
    u.id,
    p.username::text,
    p.display_name,
    p.role,
    p.phone,
    u.password_hash,
    p.deleted_at
  from auth.users u
  join public.profiles p on p.id = u.id
  where p.username = btrim(coalesce(p_identifier, ''))::citext
     or (p.phone is not null and p.phone = btrim(coalesce(p_identifier, '')))
  limit 1;
$$;

comment on function public.api_find_credential(text) is
  '登录用：按用户名（citext 大小写不敏感）或手机号取账号与密码哈希';

-- ---------------------------------------------------------------------------
-- 5. 改密码（找回密码 / 未来「修改密码」）
-- ---------------------------------------------------------------------------
create or replace function public.api_set_password(
  p_user_id       uuid,
  p_password_hash text
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if p_user_id is null then
    raise exception '缺少用户 id' using errcode = '23514';
  end if;

  if p_password_hash is null or char_length(p_password_hash) not between 20 and 255 then
    raise exception '密码哈希不合法' using errcode = '23514';
  end if;

  update auth.users u set password_hash = p_password_hash where u.id = p_user_id;

  if not found then
    raise exception '账号不存在' using errcode = '23514';
  end if;
end;
$$;

comment on function public.api_set_password(uuid, text) is
  '重设密码哈希（找回密码流程用）；调用方负责先验证身份';

-- ---------------------------------------------------------------------------
-- 6. 短信验证码（三件套）
--
--    拆成三个函数而不是一个大函数，因为哈希要用 Node 的 crypto 算，
--    而比对结果也要回到 Node 做分支：
--      api_create_phone_code  发码（含 60 秒冷却、旧码作废）
--      api_latest_phone_code  取最近一条未消费的码（拿 salt 去比对）
--      api_finish_phone_code  记结果（成功则消费；失败累加，满 5 次锁死）
-- ---------------------------------------------------------------------------

-- 6.1 发码
create or replace function public.api_create_phone_code(
  p_phone            text,
  p_purpose          text,
  p_code_hash        text,
  p_salt             text,
  p_ttl_seconds      integer default 300,
  p_cooldown_seconds integer default 60
)
returns table (
  code_id            uuid,
  expires_at         timestamptz,
  cooldown_remaining integer
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_phone text    := btrim(coalesce(p_phone, ''));
  v_last  timestamptz;
  v_id    uuid;
  v_exp   timestamptz;
begin
  if not (char_length(v_phone) between 4 and 20 and v_phone ~ '^[0-9+\- ]+$') then
    raise exception '手机号格式不合法（4–20 位，可用数字、+、-、空格）'
      using errcode = '23514';
  end if;

  -- p_purpose is null 必须单独判断：null not in (...) 结果是 null，
  -- 在 if 里当 false 处理，会漏过校验
  if p_purpose is null or p_purpose not in ('register', 'reset', 'bind') then
    raise exception '验证码用途不合法' using errcode = '23514';
  end if;

  if p_code_hash is null or p_code_hash = '' then
    raise exception '验证码哈希不合法' using errcode = '23514';
  end if;

  if p_salt is null or char_length(p_salt) < 8 then
    raise exception '验证码盐值不合法' using errcode = '23514';
  end if;

  if p_ttl_seconds < 30 or p_ttl_seconds > 3600 then
    raise exception '有效期不合法（30–3600 秒）' using errcode = '23514';
  end if;

  if p_cooldown_seconds < 0 or p_cooldown_seconds > 600 then
    raise exception '冷却时间不合法' using errcode = '23514';
  end if;

  -- 冷却判断：不能用建索引的表达式做约束（date_trunc 非 IMMUTABLE），
  -- 所以按 0011 的设计在这里查「最近一条 created_at」
  select max(v.created_at) into v_last
    from public.phone_verifications v
   where v.phone = v_phone
     and v.purpose = p_purpose
     and v.consumed_at is null;

  if v_last is not null
     and now() - v_last < make_interval(secs => p_cooldown_seconds) then
    -- 仍在冷却：不建码，把剩余秒数交回调用方去报 RATE_LIMIT
    return query
      select
        null::uuid,
        null::timestamptz,
        ceil(extract(epoch from (
          make_interval(secs => p_cooldown_seconds) - (now() - v_last)
        )))::integer;
    return;
  end if;

  -- 旧码立即作废，避免多码并存被暴力枚举
  update public.phone_verifications v
     set consumed_at = now()
   where v.phone = v_phone
     and v.purpose = p_purpose
     and v.consumed_at is null;

  v_exp := now() + make_interval(secs => p_ttl_seconds);

  insert into public.phone_verifications as pv (phone, purpose, code_hash, salt, expires_at)
  values (v_phone, p_purpose, p_code_hash, p_salt, v_exp)
  returning pv.id into v_id;

  return query select v_id, v_exp, 0;
end;
$$;

comment on function public.api_create_phone_code(text, text, text, text, integer, integer) is
  '发短信验证码：60 秒冷却、旧码作废、只存哈希。冷却中返回 cooldown_remaining';

-- 6.2 取最近一条未消费的码
create or replace function public.api_latest_phone_code(
  p_phone   text,
  p_purpose text
)
returns table (
  code_id       uuid,
  code_hash     text,
  salt          text,
  expires_at    timestamptz,
  attempt_count integer,
  expired       boolean
)
language sql
security definer
set search_path = public, auth, pg_temp
stable
as $$
  select
    v.id,
    v.code_hash,
    v.salt,
    v.expires_at,
    v.attempt_count,
    v.expires_at <= now()
  from public.phone_verifications v
  where v.phone = btrim(coalesce(p_phone, ''))
    and v.purpose = p_purpose
    and v.consumed_at is null
  order by v.created_at desc
  limit 1;
$$;

comment on function public.api_latest_phone_code(text, text) is
  '取最近一条未消费验证码（含盐值），供 Node 侧比对哈希';

-- 6.3 记结果
create or replace function public.api_finish_phone_code(
  p_id      uuid,
  p_matched boolean
)
returns table (
  attempts integer,
  locked   boolean
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_attempts integer;
  v_consumed timestamptz;
begin
  -- SET 右侧用的是旧行值，所以 attempt_count + 1 判断「这一次失败后是否满 5 次」
  update public.phone_verifications v
     set attempt_count = v.attempt_count + (case when p_matched then 0 else 1 end),
         consumed_at   = case
                           when p_matched then now()
                           when v.attempt_count + 1 >= 5 then now()
                           else v.consumed_at
                         end
   where v.id = p_id
     and v.consumed_at is null
  returning v.attempt_count, v.consumed_at into v_attempts, v_consumed;

  if not found then
    -- 已被消费 / 不存在 / 已锁定：一律当作不可再用
    return query select 0, true;
    return;
  end if;

  return query select v_attempts, v_consumed is not null;
end;
$$;

comment on function public.api_finish_phone_code(uuid, boolean) is
  '记录验证码比对结果：成功即消费；失败累加，满 5 次锁死';

-- ---------------------------------------------------------------------------
-- 7. 授权
--    security definer 函数默认对 PUBLIC 开放 EXECUTE，
--    必须收回再单独授予 app_user，否则任何人都能调。
-- ---------------------------------------------------------------------------
revoke all on function public.api_register_account(text, text, text, text) from public;
revoke all on function public.api_find_credential(text) from public;
revoke all on function public.api_set_password(uuid, text) from public;
revoke all on function public.api_create_phone_code(text, text, text, text, integer, integer) from public;
revoke all on function public.api_latest_phone_code(text, text) from public;
revoke all on function public.api_finish_phone_code(uuid, boolean) from public;

grant execute on function public.api_register_account(text, text, text, text) to app_user;
grant execute on function public.api_find_credential(text) to app_user;
grant execute on function public.api_set_password(uuid, text) to app_user;
grant execute on function public.api_create_phone_code(text, text, text, text, integer, integer) to app_user;
grant execute on function public.api_latest_phone_code(text, text) to app_user;
grant execute on function public.api_finish_phone_code(uuid, boolean) to app_user;

-- RLS 策略里会调 auth.uid()，所以 schema auth 的 usage 与函数执行权必须保留。
-- 收回的只是 auth.users 的【表】直读权，别一起收掉。
grant usage on schema auth to app_user;
grant execute on function auth.uid() to app_user;

-- ---------------------------------------------------------------------------
-- 8. 自检：迁移时就断言安全属性，防止「以为收紧了其实没有」
-- ---------------------------------------------------------------------------
do $$
declare
  v_definer_count integer;
begin
  if has_table_privilege('app_user', 'auth.users', 'select') then
    raise exception '自检失败：app_user 仍能直读 auth.users（password_hash 泄露面未关闭）';
  end if;

  if has_table_privilege('app_user', 'auth.users', 'insert') then
    raise exception '自检失败：app_user 仍能直接往 auth.users 插账号';
  end if;

  if has_table_privilege('app_user', 'public.phone_verifications', 'select') then
    raise exception '自检失败：app_user 仍能直读 phone_verifications';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'auth.users'::regclass) then
    raise exception '自检失败：auth.users 的 RLS 未启用';
  end if;

  if not (select relrowsecurity from pg_class
           where oid = 'public.phone_verifications'::regclass) then
    raise exception '自检失败：phone_verifications 的 RLS 未启用';
  end if;

  if not has_function_privilege('app_user',
        'public.api_register_account(text, text, text, text)', 'execute') then
    raise exception '自检失败：app_user 无法调用 api_register_account';
  end if;

  -- 必须全部是 security definer，否则 app_user 身份下读不到 auth.users
  select count(*) into v_definer_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'api_register_account', 'api_find_credential', 'api_set_password',
       'api_create_phone_code', 'api_latest_phone_code', 'api_finish_phone_code'
     )
     and p.prosecdef;

  if v_definer_count <> 6 then
    raise exception '自检失败：应有 6 个 security definer 函数，实际 %', v_definer_count;
  end if;

  raise notice 'OK: 0013 鉴权支撑层自检通过（auth.users 已收紧，6 个 definer 函数就位）';
end;
$$;
