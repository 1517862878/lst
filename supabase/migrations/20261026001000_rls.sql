-- ============================================================================
-- 工科影展 · 0010 RLS 行级安全策略
-- 依据：ROADMAP D5 安全基线 / DATA-MODEL §0
-- 设计原则：
--   1) 默认拒绝：所有表先 enable row level security，未写策略即不可访问
--   2) 读公开、写受限：匿名可读已发布内容；写入必须登录且只能碰自己的数据
--   3) 计数列禁止直接写：用触发器维护，应用层 UPDATE 会被下面的策略挡住
--   4) 越权用例（D5 验收 12 条）应全部被拒
-- ============================================================================

-- 先把所有表开启 RLS
alter table public.profiles            enable row level security;
alter table public.categories          enable row level security;
alter table public.article_topics      enable row level security;
alter table public.photos              enable row level security;
alter table public.likes               enable row level security;
alter table public.favorites           enable row level security;
alter table public.comments            enable row level security;
alter table public.articles            enable row level security;
alter table public.weekly_rank_snapshots enable row level security;
alter table public.weekly_rank_entries   enable row level security;
alter table public.reports             enable row level security;

-- ============================================================================
-- profiles
-- 读：任何已登录用户可读未删除资料；匿名也可读（作品详情页要显示作者名）
-- 写：只能改自己的行，且不能自提 role（防越权升管理员）
-- ============================================================================

drop policy if exists p_profiles_select on public.profiles;
create policy p_profiles_select on public.profiles
  for select
  using (deleted_at is null or id = auth.uid() or public.is_editor_or_admin());

drop policy if exists p_profiles_insert on public.profiles;
create policy p_profiles_insert on public.profiles
  for insert
  with check (id = auth.uid());

drop policy if exists p_profiles_update on public.profiles;
create policy p_profiles_update on public.profiles
  for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    -- 普通用户不得修改自己的 role；编辑/管理员可改
    and (
      role = (select role from public.profiles where id = auth.uid())
      or public.is_editor_or_admin()
    )
  );

-- ============================================================================
-- categories / article_topics：公开只读，仅管理员可写
-- ============================================================================

drop policy if exists p_categories_select on public.categories;
create policy p_categories_select on public.categories
  for select using (true);

drop policy if exists p_categories_write on public.categories;
create policy p_categories_write on public.categories
  for all
  using (public.current_role_name() = 'admin')
  with check (public.current_role_name() = 'admin');

drop policy if exists p_article_topics_select on public.article_topics;
create policy p_article_topics_select on public.article_topics
  for select using (true);

drop policy if exists p_article_topics_write on public.article_topics;
create policy p_article_topics_write on public.article_topics
  for all
  using (public.current_role_name() = 'admin')
  with check (public.current_role_name() = 'admin');

-- ============================================================================
-- photos
-- 读：已发布且未删 → 所有人可读；草稿/隐藏 → 仅作者本人与编辑
-- 写：只能操作自己的作品
-- ============================================================================

drop policy if exists p_photos_select on public.photos;
create policy p_photos_select on public.photos
  for select
  using (
    (status = 'published' and deleted_at is null)
    or author_id = auth.uid()
    or public.is_editor_or_admin()
  );

drop policy if exists p_photos_insert on public.photos;
create policy p_photos_insert on public.photos
  for insert
  with check (author_id = auth.uid());

drop policy if exists p_photos_update on public.photos;
create policy p_photos_update on public.photos
  for update
  using (author_id = auth.uid() or public.is_editor_or_admin())
  with check (author_id = auth.uid() or public.is_editor_or_admin());

drop policy if exists p_photos_delete on public.photos;
create policy p_photos_delete on public.photos
  for delete
  using (author_id = auth.uid() or public.current_role_name() = 'admin');

-- ============================================================================
-- likes / favorites
-- 读：公开（详情页要显示计数与状态，但当前用户状态由自己查自己的行）
-- 写：只能增删自己的行；不能替别人点赞
-- ============================================================================

drop policy if exists p_likes_select on public.likes;
create policy p_likes_select on public.likes
  for select using (true);

drop policy if exists p_likes_insert on public.likes;
create policy p_likes_insert on public.likes
  for insert with check (user_id = auth.uid());

drop policy if exists p_likes_delete on public.likes;
create policy p_likes_delete on public.likes
  for delete using (user_id = auth.uid());

drop policy if exists p_favorites_select on public.favorites;
create policy p_favorites_select on public.favorites
  for select using (true);

drop policy if exists p_favorites_insert on public.favorites;
create policy p_favorites_insert on public.favorites
  for insert with check (user_id = auth.uid());

drop policy if exists p_favorites_delete on public.favorites;
create policy p_favorites_delete on public.favorites
  for delete using (user_id = auth.uid());

-- ============================================================================
-- comments
-- 读：可见评论公开；已删除评论（removed）仅在作者本人查询自己作品时可见占位
-- 写：登录后发评论；只能软删自己的评论；编辑可治理
-- ============================================================================

drop policy if exists p_comments_select on public.comments;
create policy p_comments_select on public.comments
  for select
  using (
    status = 'visible'
    or author_id = auth.uid()
    or public.is_editor_or_admin()
  );

drop policy if exists p_comments_insert on public.comments;
create policy p_comments_insert on public.comments
  for insert with check (author_id = auth.uid());

drop policy if exists p_comments_update on public.comments;
create policy p_comments_update on public.comments
  for update
  using (author_id = auth.uid() or public.is_editor_or_admin())
  with check (author_id = auth.uid() or public.is_editor_or_admin());

drop policy if exists p_comments_delete on public.comments;
create policy p_comments_delete on public.comments
  for delete using (public.current_role_name() = 'admin');

-- ============================================================================
-- articles
-- 读：已发布公开；草稿仅作者与编辑
-- 写：编辑/管理员可写（单人项目里作者=编辑）
-- ============================================================================

drop policy if exists p_articles_select on public.articles;
create policy p_articles_select on public.articles
  for select
  using (
    status = 'published'
    or author_id = auth.uid()
    or public.is_editor_or_admin()
  );

drop policy if exists p_articles_write on public.articles;
create policy p_articles_write on public.articles
  for all
  using (public.is_editor_or_admin() and author_id = auth.uid())
  with check (public.is_editor_or_admin() and author_id = auth.uid());

-- ============================================================================
-- 榜单：只读（写入只允许 service_role / security definer 函数）
-- ============================================================================

drop policy if exists p_rank_snapshots_select on public.weekly_rank_snapshots;
create policy p_rank_snapshots_select on public.weekly_rank_snapshots
  for select using (true);

drop policy if exists p_rank_entries_select on public.weekly_rank_entries;
create policy p_rank_entries_select on public.weekly_rank_entries
  for select using (true);

-- ============================================================================
-- reports
-- 读：本人可看自己提交的；编辑/管理员可看全部
-- 写：任何人（含匿名）可提交；状态流转仅编辑/管理员
-- ============================================================================

drop policy if exists p_reports_select on public.reports;
create policy p_reports_select on public.reports
  for select
  using (reporter_id = auth.uid() or public.is_editor_or_admin());

drop policy if exists p_reports_insert on public.reports;
create policy p_reports_insert on public.reports
  for insert
  with check (reporter_id is null or reporter_id = auth.uid());

drop policy if exists p_reports_update on public.reports;
create policy p_reports_update on public.reports
  for update
  using (public.is_editor_or_admin())
  with check (public.is_editor_or_admin());
