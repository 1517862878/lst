-- ============================================================================
-- RLS 行为验证（修正版）
--
-- ⚠️ 2026-10-31 重要警示：**本脚本会给 app_user 授予全表 select/insert/update/delete**
--    （见下方第 27–30 行的 grant 段）。它会推翻后续迁移「逐条收回过宽权限」的结果，
--    因此：
--      · 只在**独立的临时库**上跑，不要在生产库 / CI 的迁移链库上跑；
--      · **不要**把它加进 CI 的「权限边界 SQL 回归」步骤 ——
--        实测会连带让 account-center.integration 与 background-photo.integration
--        的权限断言失败（曾真实发生，见 .github/workflows/verify-server.yml 的注释）。
--    本脚本是早期自测，保留它用于手工排查 RLS 行为，不作为门禁。
--
-- 上一版失败原因（重要教训）：
--   1) `SET LOCAL` 只能在事务块内使用；在 psql 脚本里单独执行只报 WARNING 然后无效，
--      于是全程以 postgres（superuser）身份运行 —— 而 superuser 永远绕过 RLS。
--   2) 所以上一版所有"越权成功"的结果都是假象，不能说明策略有漏洞。
--
-- 正确做法：以【非超级用户】身份连接，才能真正触发 RLS。
--   创建一个 application 角色，授予必要权限，然后 SET ROLE 切换过去。
--
-- 用法: psql -h 127.0.0.1 -U postgres -d gongke -f supabase/test-rls.sql
-- ============================================================================

\set ON_ERROR_STOP off
\echo '=== 0. 准备应用角色（非超级用户，才会受 RLS 约束）==='

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
  end if;
end;
$$;

grant usage on schema public to app_user;
grant usage on schema auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public to app_user;
grant execute on all functions in schema auth to app_user;

\echo '--- app_user 是否超级用户（必须是 f）---'
select rolname, rolsuper from pg_roles where rolname in ('app_user','postgres');

\echo ''
\echo '=== 1. 清理旧测试数据（以超管身份，绕过 RLS）==='
delete from public.comments;
delete from public.likes;
delete from public.favorites;
delete from public.photos;
delete from public.profiles where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222');
delete from auth.users where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222');

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.local', '{"display_name":"爱丽丝"}'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.local',   '{"display_name":"鲍勃"}');

insert into public.photos (author_id, title, category_slug, image_key, thumb_key, width, height, status, published_at)
values
  ('11111111-1111-1111-1111-111111111111', '爱丽丝的已发布作品', 'landscape', 'k/d.webp', 'k/t.webp', 1200, 800, 'published', now()),
  ('11111111-1111-1111-1111-111111111111', '爱丽丝的草稿',       'landscape', 'k/d2.webp','k/t2.webp',1200, 800, 'draft', null);

\echo '--- profiles 自动创建结果 ---'
select username, display_name, role from public.profiles order by username;

\echo ''
\echo '=== 2. 场景：匿名（app_user 身份 + 未设置 app.user_id）==='
set role app_user;
select current_setting('app.user_id', true) as 当前身份;
\echo '--- 匿名看到的作品（预期只有 1 条 published）---'
select title, status from public.photos order by title;

\echo ''
\echo '=== 3. 场景：Bob 登录（不应看到 Alice 的草稿）==='
set role postgres;
select set_config('app.user_id', '22222222-2222-2222-2222-222222222222', false);
set role app_user;
select current_setting('app.user_id', true) as 当前身份;
select username as 我是 from public.profiles where id = auth.uid();
\echo '--- Bob 看到的作品（预期只有 published，看不到草稿）---'
select title, status from public.photos order by title;

\echo ''
\echo '=== 4. 场景：Bob 替 Alice 点赞（预期被 RLS 拒绝）==='
insert into public.likes (user_id, photo_id)
select '11111111-1111-1111-1111-111111111111', id
  from public.photos where title='爱丽丝的已发布作品';

\echo ''
\echo '=== 5. 场景：Bob 给自己点赞（预期成功）==='
insert into public.likes (user_id, photo_id)
select '22222222-2222-2222-2222-222222222222', id
  from public.photos where title='爱丽丝的已发布作品';

\echo '--- 计数是否由触发器更新 ---'
select title, like_count from public.photos where title='爱丽丝的已发布作品';

\echo ''
\echo '=== 6. 场景：Bob 自提为 admin（预期被 WITH CHECK 拒绝）==='
update public.profiles set role='admin'
 where id='22222222-2222-2222-2222-222222222222';

select username, role from public.profiles where id='22222222-2222-2222-2222-222222222222';

\echo ''
\echo '=== 7. 场景：Bob 删 Alice 的作品（预期被拒）==='
delete from public.photos where title='爱丽丝的已发布作品';

\echo ''
\echo '=== 8. 场景：软删评论对他人不可见 ==='
set role postgres;
select set_config('app.user_id', '11111111-1111-1111-1111-111111111111', false);
set role app_user;
insert into public.comments (photo_id, author_id, body)
select id, '11111111-1111-1111-1111-111111111111', '将被软删的评论'
  from public.photos where title='爱丽丝的已发布作品';

select count(*) as alice看到 from public.comments;

set role postgres;
select set_config('app.user_id', '11111111-1111-1111-1111-111111111111', false);
set role app_user;
update public.comments set status='removed' where body='将被软删的评论';
select body, status, deleted_at is not null as 自动补删除时间 from public.comments;

set role postgres;
select set_config('app.user_id', '22222222-2222-2222-2222-222222222222', false);
set role app_user;
\echo '--- Bob 看到的评论数（预期 0，已软删对他人不可见）---'
select count(*) as bob看到 from public.comments;

\echo ''
\echo '=== 9. 恢复身份 ==='
reset role;
