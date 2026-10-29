-- ============================================================================
-- 工科影展 · 0032 comment_control：评论区治理与作者控制（8.4b）
-- 依据：.tmp/phase84b-freeze.md §3（数据库部分由后端架构负责）
--
-- 本迁移只做四件事：
--   1) photos 增加 comments_locked（作者可关闭某件作品的评论）
--   2) api_set_comments_locked：作者本人开关；非作者 42501；作品不存在 P0002
--   3) api_delete_comment：评论作者**或**作品作者可软删；其余 42501；已删幂等
--   4) api_create_comment 加锁定闸门（23514 + 中文文案），
--      api_list_comments 支持 p_sort（latest / oldest），游标跟着排序走
--
-- 为什么删除他人评论**不写** moderation_actions：
--   那是作者对自己作品下评论区的管理权，不是站方治理。写进去会让审计表被
--   个人操作灌满，真正的站方处置（隐藏/封禁/申诉）在海量噪声里不可检索。
--   要追溯「作者删了谁的评论」时，comments.status='removed' + updated_at 已经足够。
--
-- 幂等约定（与 0031 一致）：
--   - 加列用 add column if not exists
--   - 改函数参数/返回列一律先 drop function if exists 再 create，
--     并紧跟 revoke + grant —— drop 会连带丢授权，漏了 grant 就是线上 42501
--   - 仅改函数体、签名不变的用 create or replace（授权自然保留）
--   - 末尾 DO 块自检：列、函数、授权、锁定闸门、排序参数都在
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. photos.comments_locked
--
-- 默认 false（允许评论）：既有作品在迁移后行为完全不变，前端拿到的也是
-- 同一个语义（只有 true 才隐藏输入框）。
-- ---------------------------------------------------------------------------
alter table public.photos add column if not exists comments_locked boolean not null default false;

comment on column public.photos.comments_locked is
  '作者是否关闭了这件作品的评论（8.4b）；true 时发评论一律 23514，已有评论仍可读';

-- ---------------------------------------------------------------------------
-- 2. api_set_comments_locked：作者开关
--
-- 为什么参数里既有 p_actor_id 又读 auth.uid()：
--   冻结契约把 p_actor_id 写进了签名（前端/服务端显式传操作者，便于日志与
--   未来审计）。但本函数是 security definer —— 若无条件信任入参，任何调用方
--   都能替作者解锁或锁死别人的作品，等于把授权判据交给客户端。
--   所以：auth.uid() 必须非空，且 p_actor_id 必须与它一致，否则 42501。
--   签名照契约保留，授权判据仍以数据库里的身份为准。
-- ---------------------------------------------------------------------------
drop function if exists public.api_set_comments_locked(uuid, uuid, boolean);
create function public.api_set_comments_locked(
  p_photo_id uuid,
  p_actor_id uuid,
  p_locked boolean
)
returns table(photo_id uuid, comments_locked boolean)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_author uuid;
  v_locked boolean;
begin
  if v_user is null then
    raise exception '请先登录' using errcode = '42501';
  end if;
  if p_actor_id is null or p_actor_id <> v_user then
    raise exception 'ACTOR_MISMATCH:身份与操作者不一致' using errcode = '42501';
  end if;
  if p_locked is null then
    raise exception '缺少锁定状态' using errcode = '22023';
  end if;

  -- 已软删的作品不给改：与「撤回后不能再 PATCH」保持一致（0017 的语义）。
  select p.author_id into v_author
    from public.photos p
   where p.id = p_photo_id
     and p.deleted_at is null;
  if not found then
    raise exception '作品不存在或已删除' using errcode = 'P0002';
  end if;
  if v_author <> v_user then
    raise exception '只有作品作者可以开关评论' using errcode = '42501';
  end if;

  update public.photos p
     set comments_locked = p_locked
   where p.id = p_photo_id
  returning p.comments_locked into v_locked;

  return query select p_photo_id, v_locked;
end;
$$;

comment on function public.api_set_comments_locked(uuid, uuid, boolean) is
  '8.4b 作者开关评论；非作者 42501；作品不存在/已删 P0002；返回落库后的状态';

-- ---------------------------------------------------------------------------
-- 3. api_delete_comment：作者删他人评论（软删）
--
-- 与 0014 的 api_remove_comment 的分工：
--   api_remove_comment  —— 只允许**评论作者本人**删自己的（保留不动，兼容既有调用）
--   api_delete_comment  —— 本人 **或** 作品作者都能删；其余 42501；
--                          已删除的再删一次直接返回原 deleted_at（重试幂等，不报错）
--
-- 为什么不用一律 RLS：p_comments_update 只放行 author_id = auth.uid()，
-- 作品作者要删别人的评论在任何 RLS 策略下都会被拒，必须走 security definer
-- 且自己把「作者身份」判清楚。
-- ---------------------------------------------------------------------------
drop function if exists public.api_delete_comment(uuid, uuid);
create function public.api_delete_comment(
  p_comment_id uuid,
  p_actor_id uuid
)
returns table(comment_id uuid, deleted_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_comment public.comments;
  v_photo_author uuid;
  v_deleted_at timestamptz;
begin
  if v_user is null then
    raise exception '请先登录' using errcode = '42501';
  end if;
  if p_actor_id is null or p_actor_id <> v_user then
    raise exception 'ACTOR_MISMATCH:身份与操作者不一致' using errcode = '42501';
  end if;

  select * into v_comment from public.comments c where c.id = p_comment_id;
  if not found then
    raise exception '评论不存在' using errcode = 'P0002';
  end if;

  -- 作品可能本身已被作者撤回；撤回的作品下仍允许作者清理历史评论，
  -- 所以这里不过滤 deleted_at（评论的作者本人也同理）。
  select p.author_id into v_photo_author from public.photos p where p.id = v_comment.photo_id;

  if v_user <> v_comment.author_id and v_user is distinct from v_photo_author then
    raise exception '只能删除自己的评论或自己作品下的评论' using errcode = '42501';
  end if;

  -- 幂等：已删过就返回原来的时间戳，不刷新（刷新会让「删除时间」失去审计意义）。
  if v_comment.deleted_at is not null then
    return query select v_comment.id, v_comment.deleted_at;
    return;
  end if;

  update public.comments c
     set status = 'removed',
         deleted_at = now()
   where c.id = p_comment_id
  returning c.deleted_at into v_deleted_at;

  -- comment_count 由 0006 的触发器按 visible 重算，这里不需要手动减。
  return query select p_comment_id, v_deleted_at;
end;
$$;

comment on function public.api_delete_comment(uuid, uuid) is
  '8.4b 软删评论；评论作者或作品作者可删，其余 42501；已删幂等返回原 deleted_at';

-- ---------------------------------------------------------------------------
-- 4. api_create_comment 加锁定闸门
--
-- 签名与返回类型都不变（returns public.comments），所以用 create or replace，
-- 0014 授予 app_user 的 execute 权限自然保留。
--
-- 闸门放在「拉黑检查」之后、「父评论校验」之前：
--   拉黑是更强的拒绝（403），锁定是状态冲突（409）——先判身份关系再判状态，
--   与 0024 的既有顺序一致。放在父评论校验之前，是为了让「锁定」成为
--   唯一原因，而不是先报「父评论不存在」这类误导信息。
--
-- detail 标记 'COMMENTS_LOCKED' 的作用：23514 也用于表约束与其它参数校验，
-- 服务端据此把这一条翻译成 409 CONFLICT，而不是笼统的 400 VALIDATION。
-- ---------------------------------------------------------------------------
create or replace function public.api_create_comment(
  p_photo_id uuid,
  p_parent_id uuid,
  p_body text
)
returns public.comments
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_row public.comments;
  v_parent public.comments;
  v_author uuid;
  v_locked boolean;
begin
  if v_user is null then raise exception '请先登录' using errcode = '42501'; end if;
  perform public.api_assert_interactable_photo(p_photo_id);

  select p.author_id, p.comments_locked into v_author, v_locked
    from public.photos p where p.id = p_photo_id;
  if public.blocks_between(v_user, v_author) then
    raise exception 'BLOCKED_BY_RELATION:对方已拉黑你或你已拉黑对方，无法互动' using errcode = '42501';
  end if;

  if coalesce(v_locked, false) then
    raise exception '作者已关闭这件作品的评论'
      using errcode = '23514', detail = 'COMMENTS_LOCKED';
  end if;

  if p_parent_id is not null then
    select * into v_parent from public.comments
     where id = p_parent_id and photo_id = p_photo_id
       and parent_id is null and status = 'visible' and deleted_at is null;
    if not found then
      raise exception '父评论不存在、已删除或不是顶层评论' using errcode = '23514';
    end if;
  end if;

  insert into public.comments(photo_id, author_id, parent_id, body)
  values (p_photo_id, v_user, p_parent_id, btrim(p_body))
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. api_list_comments：评论列表 + p_sort
--
-- 现状：评论列表原来由 server/src/repositories/comments.ts 直接写 SQL
-- （order by created_at desc, id desc），数据库里没有对应的列表函数。
-- 8.4b 要求「评论列表函数支持 p_sort」且「游标跟着排序走」，把排序下沉到
-- 数据库函数里：两种排序各有自己的比较方向，写在一处才不会出现
-- 「首页 oldest、第二页 latest」这类翻页错位。
--
-- 为什么 security invoker（而不是 definer）：
--   现有列表查询就是在 app_user + RLS 上下文里跑的（withRls），
--   可见性完全由 p_comments_select 决定（visible / 本人 / 编辑）。
--   invoker 函数保持同一套判据，迁移前后同一请求的可见集合逐行相同；
--   改成 definer 反而会把「已删评论占位仅本人可见」这条 RLS 规则绕掉。
--
-- 返回 old 的列与 public.comments 对齐（服务端 mapComment 直接复用）。
-- 删掉 4 参数旧签名（历史版本若有）再建，避免调用方绑定到旧函数。
-- ---------------------------------------------------------------------------
drop function if exists public.api_list_comments(uuid, integer, timestamptz, uuid);
drop function if exists public.api_list_comments(uuid, text, integer, timestamptz, uuid);
create function public.api_list_comments(
  p_photo_id uuid,
  p_sort text default 'latest',
  p_limit integer default 20,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table(
  id uuid,
  photo_id uuid,
  author_id uuid,
  parent_id uuid,
  body text,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_sort text := lower(btrim(coalesce(p_sort, 'latest')));
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  if v_sort not in ('latest', 'oldest') then
    -- 22023 ⇒ 服务端翻成 400（translateDbError），不能变成 500。
    raise exception '评论排序只能是 latest 或 oldest' using errcode = '22023';
  end if;

  -- 游标与本页排序必须同向：latest 取更早的（<），oldest 取更晚的（>）。
  -- 只给一半游标（at 有、id 空）时按「无游标」处理：宁可重发第一页，
  -- 也不要生成一个方向混乱的中间页。
  if v_sort = 'latest' then
    return query
      select c.id, c.photo_id, c.author_id, c.parent_id, c.body, c.status,
             c.created_at, c.updated_at, c.deleted_at
        from public.comments c
       where c.photo_id = p_photo_id
         and (
           p_cursor_at is null or p_cursor_id is null
           or (c.created_at, c.id) < (p_cursor_at, p_cursor_id)
         )
       order by c.created_at desc, c.id desc
       limit v_limit;
  else
    return query
      select c.id, c.photo_id, c.author_id, c.parent_id, c.body, c.status,
             c.created_at, c.updated_at, c.deleted_at
        from public.comments c
       where c.photo_id = p_photo_id
         and (
           p_cursor_at is null or p_cursor_id is null
           or (c.created_at, c.id) > (p_cursor_at, p_cursor_id)
         )
       order by c.created_at asc, c.id asc
       limit v_limit;
  end if;
end;
$$;

comment on function public.api_list_comments(uuid, text, integer, timestamptz, uuid) is
  '8.4b 评论列表：p_sort=latest|oldest，游标 (created_at,id) 与排序同向；可见性沿用 RLS';

-- ---------------------------------------------------------------------------
-- 6. 作品投影：给「显式列举作品列」的 SQL 函数补 comments_locked
--
-- 服务端 mapPhoto 读 row.comments_locked 输出 commentsLocked。
-- repositories 里大多数查询是 `select p.*`（列存在即自动带出），但下面这些
-- 函数把作品列**逐个写死**在 returns table / jsonb_build_object 里，
-- 不补的话同一条作品在不同端点会得到不同形状（动态流/个人主页/标签页/器材页
-- 缺字段 = 前端把已锁定作品当成可评论）。逐段重写保留原有谓词与排序，
-- 只在 comment_count 之后插入 comments_locked。
--
-- 这些函数返回列变了 ⇒ 必须 drop + create，并在每段之后 revoke + grant。
-- ---------------------------------------------------------------------------

-- ---- api_feed（源：20261028002400_blocks_and_user_search.sql）----
-- 逐字沿用原函数体，仅在 comment_count 之后插入 comments_locked；改动返回列 ⇒ drop + create。
drop function if exists public.api_feed(integer, timestamptz, uuid);
create function public.api_feed(
  p_limit integer default 20,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid,
  author_id uuid,
  title text,
  description text,
  category_slug text,
  tags text[],
  location_name text,
  location_lat numeric,
  location_lng numeric,
  location_precision text,
  shot_at timestamptz,
  exif jsonb,
  image_key text,
  thumb_key text,
  width integer,
  height integer,
  blurhash text,
  license text,
  credit text,
  status text,
  like_count integer,
  favorite_count integer,
  comment_count integer,
  comments_locked boolean,
  view_count integer,
  published_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz,
  author_username text,
  author_display_name text,
  author_avatar_key text
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
    select p.id, p.author_id, p.title, p.description, p.category_slug, p.tags,
           p.location_name, p.location_lat, p.location_lng, p.location_precision,
           p.shot_at, p.exif, p.image_key, p.thumb_key, p.width, p.height,
           p.blurhash, p.license, p.credit, p.status,
           p.like_count, p.favorite_count, p.comment_count, p.comments_locked, p.view_count,
           p.published_at, p.created_at, p.updated_at, p.deleted_at,
           a.username::text, a.display_name, a.avatar_key
      from public.follows f
      join public.photos p on p.author_id = f.followee_id
      join public.profiles a on a.id = p.author_id
     where f.follower_id = v_uid
       and p.status = 'published'
       and p.deleted_at is null
       and a.deleted_at is null
       -- 0024：与我存在任一方向拉黑的人，作品不进我的动态流
       and not public.blocks_between(v_uid, p.author_id)
       and (
         p_cursor_at is null or p_cursor_id is null
         or (p.published_at, p.id) < (p_cursor_at, p_cursor_id)
       )
     order by p.published_at desc, p.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 51);
end;
$$;

revoke all on function public.api_feed(integer, timestamptz, uuid) from public, app_user;
grant execute on function public.api_feed(integer, timestamptz, uuid) to app_user;

-- ---- api_list_profile_interactions（源：20261028002400_blocks_and_user_search.sql）----
-- 逐字沿用原函数体，仅在 comment_count 之后插入 comments_locked；改动返回列 ⇒ drop + create。
drop function if exists public.api_list_profile_interactions(text, text, integer, timestamptz, uuid);
create function public.api_list_profile_interactions(
  p_username text,
  p_kind text,
  p_limit integer default 20,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid,
  author_id uuid,
  title text,
  description text,
  category_slug text,
  tags text[],
  location_name text,
  location_lat numeric,
  location_lng numeric,
  location_precision text,
  shot_at timestamptz,
  exif jsonb,
  image_key text,
  thumb_key text,
  width integer,
  height integer,
  blurhash text,
  license text,
  credit text,
  status text,
  like_count integer,
  favorite_count integer,
  comment_count integer,
  comments_locked boolean,
  view_count integer,
  published_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz,
  interacted_at timestamptz
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_target_id uuid;
  v_visibility text;
  v_show_likes boolean;
  v_show_favorites boolean;
  v_table text;
  v_limit integer;
begin
  -- 一次性取出目标资料的可见性与两个开关；不存在的 username 在这里就断了。
  select p.id, p.visibility, p.show_likes, p.show_favorites
    into v_target_id, v_visibility, v_show_likes, v_show_favorites
    from public.profiles p
   where lower(p.username::text) = lower(btrim(coalesce(p_username, '')))
     and p.deleted_at is null
   limit 1;

  -- 「不存在」与「不可见」必须是同一种错误：能区分就等于泄漏了私密账号的存在。
  if v_target_id is null
     or (v_visibility = 'private' and v_target_id is distinct from v_uid) then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 0024：被对方拉黑 ⇒ 同一种 P0002（与资料直达接口一致）。
  if v_uid is not null and exists (
    select 1 from public.blocks b
     where b.blocker_id = v_target_id and b.blocked_id = v_uid
  ) then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- 0024：我拉黑了对方 ⇒ 这类内容不可见（空集），资料本身仍可见。
  if v_uid is not null and public.blocks_between(v_uid, v_target_id) then
    return;
  end if;

  -- kind 白名单同时决定下面动态 SQL 的表名：外部字符串永远进不了 SQL 文本，
  -- 只有 %I 引用一个由 case 产出的常量标识符。
  v_table := case p_kind
               when 'likes' then 'likes'
               when 'favorites' then 'favorites'
               else null
             end;
  if v_table is null then
    raise exception 'KIND_INVALID' using errcode = '22023';
  end if;

  -- 开关关闭时本人以外返回空集：资料本身是可见的，404 会把「没公开互动」
  -- 说成「用户不存在」，前端无法区分，也会让私密开关看起来像隐私事故。
  if v_target_id is distinct from v_uid then
    if p_kind = 'likes' and not coalesce(v_show_likes, false) then
      return;
    end if;
    if p_kind = 'favorites' and not coalesce(v_show_favorites, false) then
      return;
    end if;
  end if;

  -- 服务端会传 limit+1（多取一行判断有没有下一页），这里再钳一道到 51。
  v_limit := least(greatest(coalesce(p_limit, 20), 1), 51);

  return query execute format($q$
    select p.id, p.author_id, p.title, p.description, p.category_slug, p.tags,
           p.location_name, p.location_lat, p.location_lng, p.location_precision,
           p.shot_at, p.exif, p.image_key, p.thumb_key, p.width, p.height,
           p.blurhash, p.license, p.credit, p.status,
           p.like_count, p.favorite_count, p.comment_count, p.comments_locked, p.view_count,
           p.published_at, p.created_at, p.updated_at, p.deleted_at,
           i.created_at
      from public.%I i
      join public.photos p on p.id = i.photo_id
      join public.profiles a on a.id = p.author_id
     where i.user_id = $1
       -- SECURITY DEFINER 绕过 RLS，下面四条可见性条件必须显式重申：
       and p.status = 'published'
       and p.deleted_at is null
       and a.deleted_at is null
       and (
         $2::timestamptz is null or $3::uuid is null
         or (i.created_at, p.id) < ($2::timestamptz, $3::uuid)
       )
     order by i.created_at desc, p.id desc
     limit $4
  $q$, v_table)
  using v_target_id, p_cursor_at, p_cursor_id, v_limit;
end;
$$;

revoke all on function public.api_list_profile_interactions(text, text, integer, timestamptz, uuid) from public, app_user;
grant execute on function public.api_list_profile_interactions(text, text, integer, timestamptz, uuid) to app_user;

-- ---- api_tag_photos（源：20261029002700_tag_discovery.sql）----
-- 逐字沿用原函数体，仅在 comment_count 之后插入 comments_locked；改动返回列 ⇒ drop + create。
drop function if exists public.api_tag_photos(text, text, jsonb, integer);
create function public.api_tag_photos(
  p_tag text,
  p_sort text default 'latest',
  p_cursor jsonb default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_tag text := lower(btrim(coalesce(p_tag, '')));
  v_sort text := lower(btrim(coalesce(p_sort, 'latest')));
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 51);
  v_total integer := 0;
  v_items jsonb := '[]'::jsonb;
  v_cursor_kind text;
  v_cursor_at timestamptz;
  v_cursor_id uuid;
  v_cursor_score integer;
begin
  if v_sort not in ('latest', 'popular') then
    raise exception 'INVALID_SORT:%', coalesce(p_sort, '') using errcode = '22023';
  end if;

  -- 空标签当作「没有这类作品」，不报错（server 侧已拦 400，这里是纵深防御）。
  if v_tag = '' then
    return jsonb_build_object('items', '[]'::jsonb, 'total', 0);
  end if;

  if p_cursor is not null and jsonb_typeof(p_cursor) <> 'null' then
    if jsonb_typeof(p_cursor) <> 'array' then
      raise exception 'INVALID_CURSOR' using errcode = '22023';
    end if;

    v_cursor_kind := p_cursor ->> 0;
    -- 排序方式变了却沿用旧游标 ⇒ 直接拒绝，否则会出现「热门的分页条件
    -- 套在最新的排序键上」这种悄悄错位的列表。
    if v_cursor_kind is distinct from v_sort then
      raise exception 'INVALID_CURSOR' using errcode = '22023';
    end if;

    if v_sort = 'latest' then
      if jsonb_array_length(p_cursor) <> 3 then
        raise exception 'INVALID_CURSOR' using errcode = '22023';
      end if;
      v_cursor_at := (p_cursor ->> 1)::timestamptz;
      v_cursor_id := (p_cursor ->> 2)::uuid;
    else
      if jsonb_array_length(p_cursor) <> 4 then
        raise exception 'INVALID_CURSOR' using errcode = '22023';
      end if;
      v_cursor_score := (p_cursor ->> 1)::integer;
      v_cursor_at := (p_cursor ->> 2)::timestamptz;
      v_cursor_id := (p_cursor ->> 3)::uuid;
    end if;

    if v_cursor_id is null or v_cursor_at is null then
      raise exception 'INVALID_CURSOR' using errcode = '22023';
    end if;
  end if;

  -- total 不受游标影响（与 /api/photos 的 total 语义一致：标签下的作品总数）。
  select count(*)::integer
    into v_total
    from public.photos p
   where p.status = 'published'
     and p.deleted_at is null
     and p.published_at is not null
     and p.tags @> array[v_tag];

  select coalesce(jsonb_agg(r.item), '[]'::jsonb)
    into v_items
    from (
      select jsonb_build_object(
               -- 照片列：与 0024 的 api_feed 返回列逐一对齐
               'id', p.id,
               'author_id', p.author_id,
               'title', p.title,
               'description', p.description,
               'category_slug', p.category_slug,
               'tags', p.tags,
               'location_name', p.location_name,
               'location_lat', p.location_lat,
               'location_lng', p.location_lng,
               'location_precision', p.location_precision,
               'shot_at', p.shot_at,
               'exif', p.exif,
               'image_key', p.image_key,
               'thumb_key', p.thumb_key,
               'width', p.width,
               'height', p.height,
               'blurhash', p.blurhash,
               'license', p.license,
               'credit', p.credit,
               'status', p.status,
               'like_count', p.like_count,
               'favorite_count', p.favorite_count,
               'comment_count', p.comment_count,
               'comments_locked', p.comments_locked,
               'view_count', p.view_count,
               'published_at', p.published_at,
               'created_at', p.created_at,
               'updated_at', p.updated_at,
               'deleted_at', p.deleted_at,
               -- 作者列：与 api_feed 的 author_* 三列同名
               'author_username', a.username::text,
               'author_display_name', a.display_name,
               'author_avatar_key', a.avatar_key,
               -- 游标键（只用于翻页，不进入 Photo）
               'photoId', p.id,
               'cursorAt', p.published_at,
               'cursorId', p.id,
               'cursorScore', p.like_count + p.favorite_count
             ) as item
        from public.photos p
        join public.profiles a on a.id = p.author_id
       where p.status = 'published'
         and p.deleted_at is null
         and p.published_at is not null
         and p.tags @> array[v_tag]
         -- keyset：两种排序各有自己的复合键，互不冒充
         and (
           v_cursor_at is null
           or v_cursor_id is null
           or (v_sort = 'latest'
               and (p.published_at, p.id) < (v_cursor_at, v_cursor_id))
           or (v_sort = 'popular'
               and ((p.like_count + p.favorite_count), p.published_at, p.id)
                   < (v_cursor_score, v_cursor_at, v_cursor_id))
         )
       order by
         case when v_sort = 'latest' then p.published_at end desc,
         case when v_sort = 'latest' then p.id end desc,
         case when v_sort = 'popular' then p.like_count + p.favorite_count end desc,
         case when v_sort = 'popular' then p.published_at end desc,
         case when v_sort = 'popular' then p.id end desc
       limit v_limit
    ) r;

  return jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'total', coalesce(v_total, 0)
  );
end;
$$;

revoke all on function public.api_tag_photos(text, text, jsonb, integer) from public, app_user;
grant execute on function public.api_tag_photos(text, text, jsonb, integer) to app_user;

-- ---- api_gear_photos（源：20261029003100_photography_privacy.sql）----
-- 逐字沿用原函数体，仅在 comment_count 之后插入 comments_locked；改动返回列 ⇒ drop + create。
drop function if exists public.api_gear_photos(text, text, integer, jsonb);
create function public.api_gear_photos(
  p_kind text,
  p_label text,
  p_limit integer default 24,
  p_cursor jsonb default null
)
returns table(
  id uuid,
  author_id uuid,
  title text,
  description text,
  category_slug text,
  tags text[],
  location_name text,
  location_lat numeric,
  location_lng numeric,
  location_precision text,
  shot_at timestamptz,
  exif jsonb,
  exif_hidden boolean,
  image_key text,
  thumb_key text,
  width integer,
  height integer,
  blurhash text,
  license text,
  credit text,
  status text,
  like_count integer,
  favorite_count integer,
  comment_count integer,
  comments_locked boolean,
  view_count integer,
  published_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz,
  featured_at timestamptz,
  author_username text,
  author_display_name text,
  author_avatar_key text,
  author_exif_visibility text
)
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_key text := lower(btrim(coalesce(p_label, '')));
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 51);
  v_cursor_at timestamptz;
  v_cursor_id uuid;
begin
  if v_kind not in ('body', 'lens') then
    raise exception '器材类型只能是 body 或 lens' using errcode = '22023';
  end if;
  if v_key = '' then
    raise exception '缺少器材名称' using errcode = '22023';
  end if;
  if char_length(v_key) > 80 then
    raise exception '器材名称过长' using errcode = '22023';
  end if;

  -- 游标沿用项目既有形状（0027 api_tag_photos）：base64url(JSON) 解码后是
  -- ['latest', published_at, id] 三元素数组，首元素是排序标记。
  -- 形状/类型不对一律 22023（server 翻成 400），不能让它变成 500。
  if p_cursor is not null and jsonb_typeof(p_cursor) <> 'null' then
    if jsonb_typeof(p_cursor) <> 'array'
       or jsonb_array_length(p_cursor) <> 3
       or coalesce(p_cursor ->> 0, '') <> 'latest' then
      raise exception '游标格式无效' using errcode = '22023';
    end if;
    begin
      v_cursor_at := (p_cursor ->> 1)::timestamptz;
      v_cursor_id := (p_cursor ->> 2)::uuid;
    exception when others then
      raise exception '游标格式无效' using errcode = '22023';
    end;
    if v_cursor_at is null or v_cursor_id is null then
      raise exception '游标格式无效' using errcode = '22023';
    end if;
  end if;

  return query
    select p.id,
             p.author_id,
             p.title,
             p.description,
             p.category_slug,
             p.tags,
             p.location_name,
             p.location_lat,
             p.location_lng,
             p.location_precision,
             p.shot_at,
             case
               when p.exif_hidden or a.exif_visibility = 'hidden' then '{}'::jsonb
               else p.exif
             end as exif,
             (p.exif_hidden or a.exif_visibility = 'hidden') as exif_hidden,
             p.image_key,
             p.thumb_key,
             p.width,
             p.height,
             p.blurhash,
             p.license,
             p.credit,
             p.status,
             p.like_count,
             p.favorite_count,
             p.comment_count,
             p.comments_locked,
             p.view_count,
             p.published_at,
             p.created_at,
             p.updated_at,
             p.deleted_at,
             p.featured_at,
             a.username::text as author_username,
             a.display_name as author_display_name,
             a.avatar_key as author_avatar_key,
             a.exif_visibility as author_exif_visibility
        from public.photos p
        join public.profiles a on a.id = p.author_id
     where p.status = 'published'
       and p.deleted_at is null
       and p.published_at is not null
       and p.exif_hidden = false
       and a.exif_visibility <> 'hidden'
       and (v_kind <> 'body'
            or lower(btrim(coalesce(p.exif ->> 'Make', '') || ' ' || coalesce(p.exif ->> 'Model', ''))) = v_key)
       and (v_kind <> 'lens'
            or lower(btrim(coalesce(p.exif ->> 'LensModel', ''))) = v_key)
       and (v_cursor_at is null or (p.published_at, p.id) < (v_cursor_at, v_cursor_id))
     order by p.published_at desc, p.id desc
     limit v_limit;
end;
$fn$;

revoke all on function public.api_gear_photos(text, text, integer, jsonb) from public, app_user;
grant execute on function public.api_gear_photos(text, text, integer, jsonb) to app_user;

-- ---- api_place_photos（源：20261029003100_photography_privacy.sql）----
-- 逐字沿用原函数体，仅在 comment_count 之后插入 comments_locked；改动返回列 ⇒ drop + create。
drop function if exists public.api_place_photos(text, integer, jsonb);
create function public.api_place_photos(
  p_label text,
  p_limit integer default 24,
  p_cursor jsonb default null
)
returns table(
  id uuid,
  author_id uuid,
  title text,
  description text,
  category_slug text,
  tags text[],
  location_name text,
  location_lat numeric,
  location_lng numeric,
  location_precision text,
  shot_at timestamptz,
  exif jsonb,
  exif_hidden boolean,
  image_key text,
  thumb_key text,
  width integer,
  height integer,
  blurhash text,
  license text,
  credit text,
  status text,
  like_count integer,
  favorite_count integer,
  comment_count integer,
  comments_locked boolean,
  view_count integer,
  published_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz,
  featured_at timestamptz,
  author_username text,
  author_display_name text,
  author_avatar_key text,
  author_exif_visibility text
)
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_key text := lower(btrim(coalesce(p_label, '')));
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 51);
  v_cursor_at timestamptz;
  v_cursor_id uuid;
begin
  if v_key = '' then
    raise exception '缺少地点名称' using errcode = '22023';
  end if;
  if char_length(v_key) > 80 then
    raise exception '地点名称过长' using errcode = '22023';
  end if;

  if p_cursor is not null and jsonb_typeof(p_cursor) <> 'null' then
    if jsonb_typeof(p_cursor) <> 'array'
       or jsonb_array_length(p_cursor) <> 3
       or coalesce(p_cursor ->> 0, '') <> 'latest' then
      raise exception '游标格式无效' using errcode = '22023';
    end if;
    begin
      v_cursor_at := (p_cursor ->> 1)::timestamptz;
      v_cursor_id := (p_cursor ->> 2)::uuid;
    exception when others then
      raise exception '游标格式无效' using errcode = '22023';
    end;
    if v_cursor_at is null or v_cursor_id is null then
      raise exception '游标格式无效' using errcode = '22023';
    end if;
  end if;

  return query
    select p.id,
             p.author_id,
             p.title,
             p.description,
             p.category_slug,
             p.tags,
             p.location_name,
             p.location_lat,
             p.location_lng,
             p.location_precision,
             p.shot_at,
             case
               when p.exif_hidden or a.exif_visibility = 'hidden' then '{}'::jsonb
               else p.exif
             end as exif,
             (p.exif_hidden or a.exif_visibility = 'hidden') as exif_hidden,
             p.image_key,
             p.thumb_key,
             p.width,
             p.height,
             p.blurhash,
             p.license,
             p.credit,
             p.status,
             p.like_count,
             p.favorite_count,
             p.comment_count,
             p.comments_locked,
             p.view_count,
             p.published_at,
             p.created_at,
             p.updated_at,
             p.deleted_at,
             p.featured_at,
             a.username::text as author_username,
             a.display_name as author_display_name,
             a.avatar_key as author_avatar_key,
             a.exif_visibility as author_exif_visibility
        from public.photos p
        join public.profiles a on a.id = p.author_id
     where p.status = 'published'
       and p.deleted_at is null
       and p.published_at is not null
       and p.location_precision <> 'hidden'
       and lower(btrim(p.location_name)) = v_key
       and (v_cursor_at is null or (p.published_at, p.id) < (v_cursor_at, v_cursor_id))
     order by p.published_at desc, p.id desc
     limit v_limit;
end;
$fn$;

revoke all on function public.api_place_photos(text, integer, jsonb) from public, app_user;
grant execute on function public.api_place_photos(text, integer, jsonb) to app_user;

-- 7. 授权：drop 过的函数要重新给 app_user execute，且不对 public 开放
-- ---------------------------------------------------------------------------
revoke all on function public.api_set_comments_locked(uuid, uuid, boolean) from public, app_user;
revoke all on function public.api_delete_comment(uuid, uuid) from public, app_user;
revoke all on function public.api_list_comments(uuid, text, integer, timestamptz, uuid) from public, app_user;

grant execute on function public.api_set_comments_locked(uuid, uuid, boolean) to app_user;
grant execute on function public.api_delete_comment(uuid, uuid) to app_user;
grant execute on function public.api_list_comments(uuid, text, integer, timestamptz, uuid) to app_user;

-- api_create_comment 是 create or replace（签名没变），0014 的 grant 仍在；
-- 这里重放一次同样的语句是幂等的，并且能在「有人手工 revoke 过」的库上自愈。
revoke all on function public.api_create_comment(uuid, uuid, text) from public;
grant execute on function public.api_create_comment(uuid, uuid, text) to app_user;

-- ---------------------------------------------------------------------------
-- 8. 自检：迁移成功但契约没落地时，让它在迁移阶段就炸，而不是线上 500
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text[] := array[]::text[];
  v_def text;
  v_fn text;
  v_body text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'photos'
       and column_name = 'comments_locked'
       and data_type = 'boolean' and is_nullable = 'NO'
  ) then
    v_missing := array_append(v_missing, 'photos.comments_locked 缺失或不是 not null boolean');
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'api_set_comments_locked'
  ) then
    v_missing := array_append(v_missing, 'api_set_comments_locked 不存在');
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'api_delete_comment'
  ) then
    v_missing := array_append(v_missing, 'api_delete_comment 不存在');
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'api_list_comments'
  ) then
    v_missing := array_append(v_missing, 'api_list_comments 不存在');
  end if;

  -- 三个新函数必须 app_user 可执行、public 不可执行
  if not (
    has_function_privilege('app_user', 'public.api_set_comments_locked(uuid,uuid,boolean)', 'execute')
    and has_function_privilege('app_user', 'public.api_delete_comment(uuid,uuid)', 'execute')
    and has_function_privilege('app_user', 'public.api_list_comments(uuid,text,integer,timestamptz,uuid)', 'execute')
  ) then
    v_missing := array_append(v_missing, '新函数缺少 app_user execute 授权');
  end if;

  -- 锁定闸门必须真的在函数体里（只改路由层不算「挡住」）
  select p.prosrc into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'api_create_comment';
  if v_def is null or position('comments_locked' in v_def) = 0
     or position('COMMENTS_LOCKED' in v_def) = 0 then
    v_missing := array_append(v_missing, 'api_create_comment 缺少 comments_locked 闸门');
  end if;

  -- 排序参数与两向游标比较必须在
  select p.prosrc into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'api_list_comments';
  if v_def is null or position('p_sort' in v_def) = 0
     or position('oldest' in v_def) = 0 then
    v_missing := array_append(v_missing, 'api_list_comments 缺少 p_sort 支持');
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'api_list_comments'
       and pg_get_function_arguments(p.oid) like '%p_sort text%'
  ) then
    v_missing := array_append(v_missing, 'api_list_comments 的 p_sort 参数缺失');
  end if;

  -- 显式列举列的投影函数必须带上 comments_locked
  foreach v_fn in array array['api_feed', 'api_list_profile_interactions', 'api_gear_photos', 'api_place_photos', 'api_tag_photos']
  loop
    select p.prosrc into v_body from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_body is null then
      v_missing := array_append(v_missing, '投影函数不存在：' || v_fn);
    elsif position('comments_locked' in v_body) = 0 then
      v_missing := array_append(v_missing, '投影函数缺少 comments_locked：' || v_fn);
    end if;
  end loop;

  if array_length(v_missing, 1) is not null then
    raise exception '0032 自检失败：%', array_to_string(v_missing, '；');
  end if;
end;
$$;
