-- ============================================================================
-- 应用角色授权（app_user）
--
-- 为什么需要：API 用 app_user 连数据库（不用 postgres，否则绕过 RLS）。
-- app_user 必须有表的读写权限，否则所有查询都会 42501 权限不足。
-- 注意：授予的是「表级权限」，具体能看到哪些行仍由 RLS 策略决定。
--       两者是两层：GRANT 决定「能否碰这张表」，RLS 决定「能碰哪些行」。
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
    raise notice '已创建角色 app_user';
  else
    raise notice '角色 app_user 已存在';
  end if;
end;
$$;

-- 设置密码（供 API 连接使用）
alter role app_user with login password 'appdev1234';

-- schema 使用权
grant usage on schema public to app_user;
grant usage on schema auth to app_user;

-- 表权限
grant select, insert, update, delete on all tables in schema public to app_user;
grant select on all tables in schema auth to app_user;

-- 序列权限（若将来有 serial 列）
grant usage, select on all sequences in schema public to app_user;

-- 函数执行权限（auth.uid / current_role_name / compute_weekly_ranking 等）
grant execute on all functions in schema public to app_user;
grant execute on all functions in schema auth to app_user;

-- 未来新增的表也自动授权
alter default privileges in schema public
  grant select, insert, update, delete on tables to app_user;
alter default privileges in schema public
  grant execute on functions to app_user;

-- 确认
\echo '=== app_user 权限确认 ==='
select
  r.rolname,
  r.rolsuper as 超级用户,
  r.rolcanlogin as 可登录,
  has_table_privilege('app_user', 'public.photos', 'select') as 可读photos,
  has_table_privilege('app_user', 'public.photos', 'insert') as 可写photos
from pg_roles r
where r.rolname in ('app_user', 'postgres')
order by r.rolname;
