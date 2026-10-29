-- ============================================================================
-- 工科影展 · 0026 受限账号的可用性与申诉闭环（8.2 补口后端）
-- 依据：.tmp/phase82-addendum.md（绑定契约）
--       docs/暂定产品完善计划表.md §5.2（P0-18 处罚透明 / P0-19 申诉与复核）
--
-- 要解决的问题（契约 §为什么做）：
--   0015 的 api_create_session 在存在生效中的 suspension/ban 时直接 42501 拒绝登录，
--   于是被封禁/暂停的用户根本进不了站内，也就无法提交申诉 —— P0-18/P0-19 对这两类
--   处罚永远无法闭环。本轮把「处罚」从登录环节挪到**服务端写接口守卫**：
--   受限账号能登录、能浏览、能看自己的处罚与申诉、能举报与申诉，
--   只是不能发布内容 / 互动 / 标记通知已读（分级见 server/src/lib/restrictions.ts）。
--
-- 本迁移只做补齐，不改历史迁移、不改 user_sanctions 结构与既有裁定/撤销语义：
--   1) 重建 api_create_session：去掉 sanction 拒绝，其余（注销拒绝、过期、UA/IP 截断、
--      返回结构）与 0015 完全一致；返回类型未变，但按契约先 drop 再建（最稳）。
--   2) 新增 api_my_active_restriction()：auth.uid() 生效中的处罚里取最严重一条
--      （ban > suspension > content_restriction > warning），无则空集，供写守卫分级。
--   3) 重建 api_session_is_active：去掉 sanction 门禁。**这是契约遗漏但必须修的一处**：
--      0015 的实现把 allowed 与 session 有效性绑在一起，只要处罚生效，已登录的会话
--      会被判成 inactive，服务端 resolveSession 直接把它当游客 —— 那样"能登录"也只是
--      拿到一个 cookie 而每个请求都退化成匿名，登录态、申诉入口、举报入口全部失效。
--   4) 权限收口（先 revoke 再最小化 grant）+ 自检 DO 块。
--
-- 幂等：drop ... if exists 后再建 / create or replace，可整文件重复回放。
-- 含中文说明一律走文件 + psql -f，不进 psql -c。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 重建 api_create_session：受限账号可以登录
--    唯一保留的拒绝条件是「账号已注销」，语义与 0015 的 allowed=false 一致；
--    处罚不再在这里拒绝（改由 server 的 onRequest 写守卫在分级维度上拦截）。
--    返回类型保持不变，但按契约先 drop 再建，避免将来扩列时 CREATE OR REPLACE 报错。
-- ----------------------------------------------------------------------------
drop function if exists public.api_create_session(uuid, text, timestamptz, text, text);
create function public.api_create_session(
  p_user_id uuid,
  p_refresh_token_hash text,
  p_expires_at timestamptz,
  p_user_agent text default null,
  p_ip_hash text default null
)
returns table(session_id uuid, family_id uuid, expires_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted timestamptz;
  v_id uuid;
  v_family uuid;
  v_exp timestamptz;
begin
  -- 注销账号仍然不能登录（与 0015 一致）；不存在的账号给同一条文案，
  -- 避免"这个 id 存不存在"从错误信息里被区分出来。
  select p.deleted_at into v_deleted from public.profiles p where p.id = p_user_id;
  if not found or v_deleted is not null then
    raise exception '账号当前不可登录' using errcode = '42501';
  end if;

  if p_expires_at <= now() then
    raise exception '会话有效期不合法' using errcode = '23514';
  end if;

  insert into public.security_sessions(user_id, refresh_token_hash, expires_at, user_agent, ip_hash)
  values (p_user_id, p_refresh_token_hash, p_expires_at, left(p_user_agent, 512), left(p_ip_hash, 128))
  returning id, security_sessions.family_id, security_sessions.expires_at
       into v_id, v_family, v_exp;

  return query select v_id, v_family, v_exp;
end;
$$;

comment on function public.api_create_session(uuid, text, timestamptz, text, text) is
  '0026：受限账号（suspension/ban）也可以登录；仅注销账号被拒绝。写权限由服务端按处罚分级守卫。';

-- ----------------------------------------------------------------------------
-- 2. api_my_active_restriction：当前生效处罚里最严重的一条
--    服务端写守卫只需要 (kind, endsAt)：kind 决定拦截哪些写类别，endsAt 进 403 details
--    供前端展示"限制到什么时候"。reasonCode/reasonDetail 让前端能说明原因，
--    与 /api/auth/session 的 restriction 字段一一对应。
--    严重度：ban > suspension > content_restriction > warning（同级别取最近一条）。
--    ends_at is null 视为长期有效。
-- ----------------------------------------------------------------------------
drop function if exists public.api_my_active_restriction();
create function public.api_my_active_restriction()
returns table (
  kind text,
  reason_code text,
  reason_detail text,
  ends_at timestamptz,
  created_at timestamptz
)
language plpgsql security definer stable
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  return query
    select s.kind,
           s.reason_code,
           s.reason_detail,
           s.ends_at,
           s.created_at
      from public.user_sanctions s
     where s.user_id = v_uid
       and s.status = 'active'
       and s.starts_at <= now()
       and (s.ends_at is null or s.ends_at > now())
     order by case s.kind
                when 'ban' then 0
                when 'suspension' then 1
                when 'content_restriction' then 2
                else 3
              end,
              s.created_at desc,
              s.id desc
     limit 1;
end;
$$;

comment on function public.api_my_active_restriction() is
  '0026：本人当前生效的处罚中取最严重一条（ban>suspension>content_restriction>warning）；无则返回空集。';

-- ----------------------------------------------------------------------------
-- 3. 重建 api_session_is_active：会话有效性与处罚解耦
--    0015 把 "session 行有效" 与 "账号 allowed" 写在同一句里，处罚一生效就把所有
--    已登录会话判成 inactive。既然本轮改成"受限可登录"，这里必须只判会话本身：
--    撤销/过期/不属于该用户仍然失效，处罚不再参与判定。
--    签名与返回类型不变（boolean），故用 create or replace，权限不需要重建。
-- ----------------------------------------------------------------------------
create or replace function public.api_session_is_active(p_session_id uuid, p_user_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists(
    select 1 from public.security_sessions s
     where s.id = p_session_id
       and s.user_id = p_user_id
       and s.revoked_at is null
       and s.expires_at > now()
  );
$$;

comment on function public.api_session_is_active(uuid, uuid) is
  '0026：只判会话本身（未撤销、未过期、属于该用户）；处罚不再让已登录会话失效。';

-- ----------------------------------------------------------------------------
-- 4. 权限收口：先 revoke 再最小化 grant（app_user 之外一律不给）
--    api_create_session 被 drop 过，grant 随函数一起消失，必须重新授予。
-- ----------------------------------------------------------------------------
revoke all on function public.api_create_session(uuid, text, timestamptz, text, text) from public, app_user;
grant execute on function public.api_create_session(uuid, text, timestamptz, text, text) to app_user;

revoke all on function public.api_my_active_restriction() from public, app_user;
grant execute on function public.api_my_active_restriction() to app_user;

revoke all on function public.api_session_is_active(uuid, uuid) from public, app_user;
grant execute on function public.api_session_is_active(uuid, uuid) to app_user;

-- ----------------------------------------------------------------------------
-- 5. 自检：迁移必须把"受限可登录"真正落地，而不是只写了注释
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
  v_expected text[] := array['api_create_session', 'api_my_active_restriction', 'api_session_is_active'];
begin
  -- 5.1 三个函数：security definer + 固定 search_path + PUBLIC 不可执行 + app_user 可执行
  for r in
    select p.oid, p.proname, p.prosecdef, coalesce(p.proconfig, array[]::text[]) as config
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (v_expected)
  loop
    if not r.prosecdef then
      raise exception '0026 自检失败：% 不是 security definer', r.proname;
    end if;
    if not exists (select 1 from unnest(r.config) c where c like 'search_path=%') then
      raise exception '0026 自检失败：% 未固定 search_path', r.proname;
    end if;
    if has_function_privilege('public', r.oid, 'execute') then
      raise exception '0026 自检失败：PUBLIC 不应能执行 %', r.proname;
    end if;
    if not has_function_privilege('app_user', r.oid, 'execute') then
      raise exception '0026 自检失败：app_user 无法执行 %', r.proname;
    end if;
  end loop;

  -- 5.2 三个函数都必须真的存在（foreach 只能查权限，不能证明存在）
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any (v_expected)) <> 3 then
    raise exception '0026 自检失败：函数数量不符（期望 3）';
  end if;

  -- 5.3 处罚拒绝逻辑必须真的消失：两个函数体里都不许再出现 access_state
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('api_create_session', 'api_session_is_active')
       and p.prosrc like '%api_account_access_state%'
  ) then
    raise exception '0026 自检失败：登录/会话判定仍在引用 api_account_access_state';
  end if;

  -- 5.4 新函数的返回列必须覆盖服务端守卫依赖的字段
  if (select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'api_my_active_restriction') not like '%ends_at%' then
    raise exception '0026 自检失败：api_my_active_restriction 未返回 ends_at';
  end if;
end;
$$;
