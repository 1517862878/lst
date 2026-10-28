-- ============================================================================
-- 创建 / 对齐应用角色 app_user —— 迁移链的前置条件
--
-- 为什么需要这个文件：
--   迁移链里的每一个文件都**假设 app_user 已经存在**（它们 grant/revoke 到这个角色，
--   自检里还用 has_table_privilege('app_user', ...)，角色不存在会直接报错）。
--   但仓库里**没有任何迁移创建它**：本机是手工建好的一次性状态，所以「全新集群」
--   （CI、换电脑、以后的云服务器）跑迁移第一步就会失败，或者在自检处神秘报错。
--
-- 与 supabase/grant-app-role.sql 的区别（不要用那个文件做引导）：
--   那个文件是自托管初期的「一把梭」授权，会给 app_user 授予全表 select/insert/
--   update/delete。而后续迁移（0013 auth.users、0014 写接口、0015 治理表、0017 photos、
--   0020 清理队列、0022 社交表）正在逐条**收回**这些过宽的权限，并各自带自检。
--   本文件因此只做两件事：建角色、把安全属性对齐到「不能越权」的那一档；
--   表/函数权限完全交给迁移链里那些带自检的精确授权。
--
-- 用法（口令不进仓库，从命令行传入）：
--   psql -X -h <host> -U postgres -d <db> -v ON_ERROR_STOP=1 \
--        -v app_password='<口令>' -f supabase/create-app-role.sql
--
-- ⚠️ app_user 是**集群级共享角色**，不属于任何一个库。本文件会覆盖它的口令，
--    因此在「已经跑着服务的机器」上，必须传入该机文档里的现有口令
--    （本机是 appdev1234），否则正在运行的服务会在连接池重连时抛 28P01，
--    表现为「登录点了没反应」。CI/云服务器这类一次性集群才可以用临时口令。
--
-- 幂等：角色已存在时只覆盖口令与属性，不重复创建，也不撤销任何已授予的权限。
-- ============================================================================

\encoding UTF8
\set ON_ERROR_STOP on

-- 少了口令就直接失败。注意 psql 未定义变量会展开成空串，那会静默把口令设成空，
-- 所以这里必须显式拦住；DO 块是普通 SQL 语句，ON_ERROR_STOP 会把它变成非零退出码。
\if :{?app_password}
\else
  do $$ begin
    raise exception '必须通过 -v app_password=<口令> 传入 app_user 的口令';
  end $$;
\endif

-- 不存在才创建；\gexec 把 select 出来的那一行当成 SQL 执行
select format('create role app_user login password %L', :'app_password')
where not exists (select 1 from pg_roles where rolname = 'app_user')
\gexec

-- 已存在也统一到同一档属性：可登录、非超管、不能建库建角色、不能绕过 RLS。
-- rolbypassrls 尤其关键 —— 一旦为真，所有 RLS 策略形同虚设。
alter role app_user with
  login
  password :'app_password'
  nosuperuser
  nocreatedb
  nocreaterole
  nobypassrls;

-- 自检 1：角色必须真的建出来了（否则后续迁移会在更远、更难懂的地方炸）
select format('do $$ begin raise exception %L; end $$;',
              'app_user 未创建：确认已传入 -v app_password=<口令>')
where not exists (select 1 from pg_roles where rolname = 'app_user')
\gexec

-- 自检 2：属性必须是「可登录、非超管、不绕 RLS」
select format('do $$ begin raise exception %L; end $$;',
              'app_user 属性不正确：rolsuper=' || rolsuper
              || ' rolcanlogin=' || rolcanlogin
              || ' rolbypassrls=' || rolbypassrls)
from pg_roles
where rolname = 'app_user'
  and (rolsuper or not rolcanlogin or rolbypassrls)
\gexec

\echo '=== app_user 就绪（下表 4 列必须依次为 app_user / f / t / f）==='
select
  rolname,
  rolsuper as 超级用户,
  rolcanlogin as 可登录,
  rolbypassrls as 绕过RLS
from pg_roles
where rolname = 'app_user';
