\encoding UTF8
-- ============================================================================
-- 工科影展 · 0039 教程文章允许用户自行投稿
--
-- 需求：学习板块不再只有预置的 12 篇虚拟文章，任何登录用户都能自己写文章、
--       支持存草稿与一键发布。
--
-- 三处旧约束挡住这个需求，必须一起改：
--
--   1) RLS 写策略 p_articles_write 只允许 editor/admin
--      （`using (public.is_editor_or_admin() and author_id = auth.uid())`）。
--      这是 0010 期的假设：文章是官方教程，只能编辑部写。
--      现在放开为「任何登录用户可写自己的文章」，但仍然只能写 author_id = 自己，
--      防止冒用他人署名。
--
--   2) 读取策略 p_articles_select 不覆盖「草稿只给作者」这一条的正确性：
--      原策略是 `status='published' or author_id=auth.uid() or is_editor_or_admin()`，
--      其实是对的。保留原样，不重复创建（幂等）。
--
--   3) 表级权限：app_user 只有 select，没有任何写权限（见 0019 的刻意收紧）。
--      所以写入必须走 SECURITY DEFINER 函数 —— 下面三个：
--        · api_create_article   建草稿 / 直接发布
--        · api_update_article   改自己的文章（含把草稿发布）
--        · api_delete_article   删自己的文章（真删除，文章没有「软删」语义）
--      与 photos 的 api_create_photo / api_update_photo / api_remove_photo 同一范式。
--
-- 几个刻意的设计：
--   · slug 由调用方给（前端从标题生成），函数里只做格式校验 + 唯一性冲突透传。
--     不在数据库里自动 slug 化：中文标题转拼音需要额外依赖，而项目不允许为此加库。
--   · published_at 只在「首次转 published」时写入，重复发布不改它 ——
--     否则改一次错别字就会把文章顶到列表最前面，等于给了刷榜能力。
--   · version 由 0007 的触发器 bump_article_version 维护，函数不碰。
--   · 任何人不能把 author_id 改成别人：update 的 where 恒带 author_id = auth.uid()。
--
-- 幂等：create or replace function / drop policy + create policy / 重复 grant。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. RLS：写策略放开为「登录用户可写自己的文章」
-- ----------------------------------------------------------------------------

drop policy if exists p_articles_write on public.articles;

create policy p_articles_write on public.articles
  for all
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

comment on policy p_articles_write on public.articles is
  '任何登录用户可增删改自己的文章；不能写他人署名（author_id 恒为 auth.uid()）';

-- 读策略保持 0010 的形状（草稿只有作者与编辑可见），这里显式重建以保证
-- 换到「用户可写」后草稿不会漏给他人。逻辑与原来逐字一致，只是重放一次。
drop policy if exists p_articles_select on public.articles;

create policy p_articles_select on public.articles
  for select
  using (
    status = 'published'
    or author_id = auth.uid()
    or public.is_editor_or_admin()
  );

-- ----------------------------------------------------------------------------
-- 2. 建文章（草稿或直接发布）
-- ----------------------------------------------------------------------------

create or replace function public.api_create_article(
  p_id              uuid,
  p_slug            text,
  p_topic_slug      text,
  p_title           text,
  p_summary         text,
  p_body_md         text,
  p_difficulty      text,
  p_reading_minutes integer,
  p_tags            text[],
  p_equipment       text[],
  p_related_photo_ids text[],
  p_publish         boolean
)
returns public.articles
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_row  public.articles;
  v_tags text[] := coalesce(p_tags, '{}');
  v_equip text[] := coalesce(p_equipment, '{}');
  v_related text[] := coalesce(p_related_photo_ids, '{}');
begin
  if v_user is null then
    raise exception '请先登录' using errcode = '42501';
  end if;

  -- 格式校验与表约束同源（这里先挡一道，报错文案才对用户友好）
  if p_slug is null or p_slug !~ '^[a-z0-9-]{1,80}$' then
    raise exception 'slug 只能是小写字母、数字和连字符，1–80 位' using errcode = '23514';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 80 then
    raise exception '标题需 1–80 个字符' using errcode = '23514';
  end if;
  if p_summary is not null and char_length(p_summary) > 140 then
    raise exception '摘要最多 140 个字符' using errcode = '23514';
  end if;
  if p_difficulty not in ('beginner', 'intermediate', 'advanced') then
    raise exception '难度取值不合法' using errcode = '23514';
  end if;
  if array_length(v_tags, 1) > 6 or array_length(v_equip, 1) > 6
     or array_length(v_related, 1) > 6 then
    raise exception '标签/器材/关联作品各最多 6 条' using errcode = '23514';
  end if;

  insert into public.articles (
    id, slug, topic_slug, title, summary, body_md, cover_key, author_id,
    difficulty, reading_minutes, tags, equipment, related_photo_ids,
    status, published_at
  )
  values (
    p_id, p_slug, p_topic_slug, btrim(p_title), coalesce(p_summary, ''),
    coalesce(p_body_md, ''), null, v_user,
    p_difficulty, greatest(coalesce(p_reading_minutes, 1), 1),
    v_tags, v_equip, v_related,
    case when p_publish then 'published' else 'draft' end,
    case when p_publish then clock_timestamp() else null end
  )
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.api_create_article is
  '创建教程文章（草稿或直接发布）；作者恒为当前登录用户';

-- ----------------------------------------------------------------------------
-- 3. 更新自己的文章（含草稿 → 发布）
-- ----------------------------------------------------------------------------

create or replace function public.api_update_article(
  p_id              uuid,
  p_title           text,
  p_summary         text,
  p_body_md         text,
  p_topic_slug      text,
  p_difficulty      text,
  p_reading_minutes integer,
  p_tags            text[],
  p_equipment       text[],
  p_related_photo_ids text[],
  p_publish         boolean
)
returns public.articles
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_row  public.articles;
begin
  if v_user is null then
    raise exception '请先登录' using errcode = '42501';
  end if;

  if p_title is null or char_length(btrim(p_title)) not between 1 and 80 then
    raise exception '标题需 1–80 个字符' using errcode = '23514';
  end if;
  if p_summary is not null and char_length(p_summary) > 140 then
    raise exception '摘要最多 140 个字符' using errcode = '23514';
  end if;
  if p_difficulty not in ('beginner', 'intermediate', 'advanced') then
    raise exception '难度取值不合法' using errcode = '23514';
  end if;

  -- where 恒带 author_id = auth.uid()：改不到别人的文章，也挡不住就直接静默 0 行
  update public.articles a
     set title = btrim(p_title),
         summary = coalesce(p_summary, ''),
         body_md = coalesce(p_body_md, ''),
         topic_slug = coalesce(p_topic_slug, a.topic_slug),
         difficulty = p_difficulty,
         reading_minutes = greatest(coalesce(p_reading_minutes, 1), 1),
         tags = coalesce(p_tags, '{}'),
         equipment = coalesce(p_equipment, '{}'),
         related_photo_ids = coalesce(p_related_photo_ids, '{}'),
         status = case when p_publish then 'published' else a.status end,
         -- 只在首次发布时写 published_at；重复发布不刷新，避免改错别字就顶到列表最前
         published_at = case
           when p_publish and a.published_at is null then clock_timestamp()
           else a.published_at
         end
   where a.id = p_id
     and a.author_id = v_user
  returning * into v_row;

  if not found then
    raise exception '文章不存在或无权修改' using errcode = '42501';
  end if;

  return v_row;
end;
$$;

comment on function public.api_update_article is
  '更新自己的文章；p_publish=true 把草稿转为已发布（只在首次发布时写 published_at）';

-- ----------------------------------------------------------------------------
-- 4. 删除自己的文章
-- ----------------------------------------------------------------------------

create or replace function public.api_delete_article(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_deleted integer;
begin
  if v_user is null then
    raise exception '请先登录' using errcode = '42501';
  end if;

  delete from public.articles a
   where a.id = p_id
     and a.author_id = v_user;

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

comment on function public.api_delete_article is '删除自己的文章；返回是否真的删到';

-- ----------------------------------------------------------------------------
-- 5. 权限：函数只给 app_user，撤销 public
-- ----------------------------------------------------------------------------

-- 5a. 收回 articles 的表级写权限（纵深防御）
--
-- 实测本地库 app_user 对 articles 持有 INSERT/UPDATE/DELETE —— 这是自托管初期
-- `supabase/grant-app-role.sql` 的「一把梭」授权留下的，0019 只检查了 photos，
-- 漏掉了文章表。虽然 RLS 仍在生效（app_user 不是表 owner），但项目铁律是
-- 「写入只能走 SECURITY DEFINER 函数」，表级写权限等于把这条防线拆掉半边：
-- 任何一处裸 pool.query 误用都会直接绕过函数里的作者校验。
revoke insert, update, delete on public.articles from app_user;

-- 5b. 同批「一把梭」残留：字典表与榜单表也只该经函数写
--
-- 复查 app_user 的全库表权限时发现的同类问题（与本需求的表结构改动无关，
-- 但同一次审计一并收口，避免下次又只修一半）：
--   · article_topics / categories —— 字典表，由种子与迁移写入，应用不写；
--   · weekly_rank_snapshots / weekly_rank_entries —— 0008 就写明「写入只允许
--     service_role / security definer 函数」，实际却还留着表级写权限。
-- reports 的 delete 保留：举报人撤销自己的举报走的是表级 delete（见 0015 RLS）。
revoke insert, update, delete on public.article_topics from app_user;
revoke insert, update, delete on public.categories from app_user;
revoke insert, update, delete on public.weekly_rank_snapshots from app_user;
revoke insert, update, delete on public.weekly_rank_entries from app_user;
-- profiles 的写同样只该经 api_update_own_profile 等 definer 函数（0018 起就没有裸写路径）
revoke insert, update, delete on public.profiles from app_user;

revoke all on function public.api_create_article(uuid,text,text,text,text,text,text,integer,text[],text[],text[],boolean) from public, app_user;
revoke all on function public.api_update_article(uuid,text,text,text,text,text,integer,text[],text[],text[],boolean) from public, app_user;
revoke all on function public.api_delete_article(uuid) from public, app_user;

grant execute on function public.api_create_article(uuid,text,text,text,text,text,text,integer,text[],text[],text[],boolean) to app_user;
grant execute on function public.api_update_article(uuid,text,text,text,text,text,integer,text[],text[],text[],boolean) to app_user;
grant execute on function public.api_delete_article(uuid) to app_user;

-- ----------------------------------------------------------------------------
-- 6. 自检：表级写权限必须仍然没有（写入只能走上面的 definer 函数）
-- ----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  if has_table_privilege('app_user', 'public.articles', 'insert')
     or has_table_privilege('app_user', 'public.articles', 'update')
     or has_table_privilege('app_user', 'public.articles', 'delete') then
    raise exception '0039 自检失败：app_user 不应获得 articles 表级写权限';
  end if;

  -- 5b 收口过的表逐个复查：任何一张漏掉都会让「写入只走函数」这条铁律名存实亡
  foreach t in array array[
    'public.article_topics', 'public.categories', 'public.weekly_rank_snapshots',
    'public.weekly_rank_entries', 'public.profiles'
  ] loop
    if has_table_privilege('app_user', t, 'insert')
       or has_table_privilege('app_user', t, 'update')
       or has_table_privilege('app_user', t, 'delete') then
      raise exception '0039 自检失败：app_user 仍持有 % 的表级写权限', t;
    end if;
  end loop;

  if not has_function_privilege('app_user', 'public.api_create_article(uuid,text,text,text,text,text,text,integer,text[],text[],text[],boolean)', 'execute')
     or not has_function_privilege('app_user', 'public.api_update_article(uuid,text,text,text,text,text,integer,text[],text[],text[],boolean)', 'execute')
     or not has_function_privilege('app_user', 'public.api_delete_article(uuid)', 'execute') then
    raise exception '0039 自检失败：app_user 缺少文章写入函数执行权限';
  end if;
end;
$$;
