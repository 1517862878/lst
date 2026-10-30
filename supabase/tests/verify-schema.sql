-- 验证脚本：检查迁移后的数据库结构是否完整
-- 用法: psql -h 127.0.0.1 -U postgres -d gongke -f supabase/verify-schema.sql

\echo '=== 1. 表清单 ==='
select table_name,
       (select count(*) from information_schema.columns c
         where c.table_schema='public' and c.table_name=t.table_name) as 列数
  from information_schema.tables t
 where table_schema='public' and table_type='BASE TABLE'
 order by table_name;

\echo ''
\echo '=== 2. 索引数量 ==='
select tablename, count(*) as idx_count
  from pg_indexes
 where schemaname='public'
 group by tablename order by tablename;

\echo ''
\echo '=== 3. 触发器清单 ==='
select event_object_table as 表, trigger_name, event_manipulation as 事件
  from information_schema.triggers
 where trigger_schema='public'
 order by event_object_table, trigger_name;

\echo ''
\echo '=== 4. RLS 是否全部开启 ==='
select tablename, rowsecurity as rls_enabled
  from pg_tables where schemaname='public' order by tablename;

\echo ''
\echo '=== 5. RLS 策略数量 ==='
select tablename, count(*) as policy_count
  from pg_policies where schemaname='public'
 group by tablename order by tablename;

\echo ''
\echo '=== 6. 分类/主题种子数据 ==='
select 'categories' as 表, count(*) as 行数 from public.categories
union all
select 'article_topics', count(*) from public.article_topics;

\echo ''
\echo '=== 7. 辅助函数是否可用 ==='
select public.current_role_name() as 匿名角色,
       public.is_editor_or_admin() as is_editor;
