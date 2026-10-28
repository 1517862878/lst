-- ============================================================================
-- 0019 app_user 基础读权限
--
-- RLS 只负责“哪些行可见”，不能替代表级 SELECT 权限。此前 fresh database
-- 没有给 app_user 授予 profiles 等公开查询表的 SELECT，真实 API 因此在解析
-- Cookie 会话后的 profile 查询阶段报 42501；浏览、搜索、评论与榜单也会失败。
-- 写权限仍只通过既有 SECURITY DEFINER API 开放，本迁移不授予表级写权限。
-- ============================================================================

grant select on public.profiles to app_user;
grant select on public.categories to app_user;
grant select on public.article_topics to app_user;
grant select on public.photos to app_user;
grant select on public.likes to app_user;
grant select on public.favorites to app_user;
grant select on public.comments to app_user;
grant select on public.articles to app_user;
grant select on public.weekly_rank_snapshots to app_user;
grant select on public.weekly_rank_entries to app_user;
grant select on public.reports to app_user;

-- 防止后续误将安全修复扩大成表级写入授权。
do $$
begin
  if not has_table_privilege('app_user', 'public.profiles', 'select')
     or not has_table_privilege('app_user', 'public.photos', 'select')
     or not has_table_privilege('app_user', 'public.comments', 'select') then
    raise exception '0019 自检失败：app_user 缺少核心读权限';
  end if;
  if has_table_privilege('app_user', 'public.photos', 'update')
     or has_table_privilege('app_user', 'public.photos', 'delete') then
    raise exception '0019 自检失败：app_user 获得了 photos 表级写权限';
  end if;
end;
$$;
