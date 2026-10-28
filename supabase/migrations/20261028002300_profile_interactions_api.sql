\encoding UTF8
-- ============================================================================
-- 工科影展 · 0023 按 username 读取用户内容：作品列表 + 公开的喜欢/收藏
--
-- 背景（0018 的最小投影把 API 模式的个人主页逼进了死胡同）：
--   * 0018 之后公开资料接口不再返回稳定 user UUID，前端个人主页手里只有 username；
--   * 而 /api/photos 当时只能按 categorySlug 过滤，喜欢/收藏只有「本人 + userId」
--     的 /api/interactions。于是 API 模式按用户名拉作品/喜欢/收藏全部拿不到数据。
--   本迁移补两条按 username 进入的读取路径，仍然不给 app_user 任何新的表权限。
--
-- 安全边界（务必与实现一起读）：
--   1) 用户名解析一律走 SECURITY DEFINER 函数：签名固定、search_path 固定
--      = pg_catalog, public，函数体内不拼外部字符串（唯一的动态表名来自白名单）；
--   2) 喜欢/收藏列表在函数里显式重申可见性：visibility='private' 仅本人可见；
--      show_likes / show_favorites 关闭时，本人以外拿到空集（资料可见，只是这类
--      互动不公开）；
--   3) 「资料不存在」与「资料对当前用户不可见」统一抛 PROFILE_NOT_FOUND(P0002)，
--      由服务端翻成 404。两者必须无法区分 —— 否则可以拿这个接口探测私密账号是否存在
--      （0018 的 api_get_profile_by_username 与 0022 的 social_target_profile 同理）；
--   4) discoverable 沿用 0018 的既有语义：只影响发现/搜索过滤，**不**阻止按已知
--      username 直达。本迁移不改变这条语义（api_get_profile_by_username 的注释是同一句）；
--   5) 函数是 SECURITY DEFINER，执行时以属主身份运行、会**绕过** photos/likes/
--      favorites 的 RLS，所以 published / deleted_at 这些可见性条件在 SQL 里全部
--      显式重申，不依赖 RLS 兜底（与 0022 api_feed 的写法一致）。
--
-- 幂等：本文件全部采用 drop function if exists + create function，
--       可重复执行（supabase/run-migrations.ps1 会重放整个目录）。
-- 注意：drop function 会一并丢掉旧授权，所以 grant 必须写在 create 之后。
-- ============================================================================

-- ============================================================================
-- 1. api_profile_id_by_username：username → profiles.id
--
--    只供服务端内部做过滤（GET /api/photos?authorUsername=…），**不对外返回 UUID**：
--    路由响应里没有任何字段来自这个函数，用户名进、UUID 只落在 SQL 的 where 里。
--
--    刻意 **不** 加 visibility 过滤：按作者列作品的既有语义是「该作者对匿名可见的
--    已发布作品」（0010 的 p_photos_select：status='published' and deleted_at is null，
--    与作者资料的 visibility 无关）。私密账号的已发布作品在现有 RLS 下本来就是
--    公开可读的，本迁移不改变这一点，只是让「按用户名过滤」能用上这条既有语义。
--
--    username 是 citext，但这里照 0018/0022 的写法显式 lower(...::text)：
--      * 语义与 citext 的「大小写不敏感」完全一致；
--      * 正好命中 0003 建的 uq_profiles_username_lower 唯一索引，不必额外建索引。
--
--    用户名不存在 / 资料已注销 ⇒ 返回 null ⇒ 调用方得到空列表（不是 500）。
-- ============================================================================

drop function if exists public.api_profile_id_by_username(text);
create function public.api_profile_id_by_username(p_username text)
returns uuid
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select p.id
    from public.profiles p
   where lower(p.username::text) = lower(btrim(coalesce(p_username, '')))
     and p.deleted_at is null
   limit 1
$$;

comment on function public.api_profile_id_by_username(text) is
  '按 citext username（大小写不敏感）解析 profiles.id，供服务端内部过滤；不返回给客户端';

-- ============================================================================
-- 2. api_list_profile_interactions：某用户公开的喜欢 / 收藏
--
--    返回「该用户点赞/收藏过、且仍对匿名可见的作品」（published + 未删除 + 作者未注销），
--    按互动时间倒序。游标 (互动时间, photo id) 与 0022 的列表接口同一套排序键，
--    服务端用 base64url 的 [iso, id] 编码，多取一行判断 hasMore。
--
--    返回空集的三种情况（都是 200 + items:[]，不是 404）：
--      * show_likes / show_favorites 关闭且调用者不是本人；
--      * 该用户没有公开的喜欢/收藏；
--      * 翻到最后一页之后。
--    抛 PROFILE_NOT_FOUND(P0002) ⇒ 服务端 404 的两种情况：
--      * username 不存在或资料已注销；
--      * visibility='private' 且调用者不是本人。
-- ============================================================================

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
           p.like_count, p.favorite_count, p.comment_count, p.view_count,
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

comment on function public.api_list_profile_interactions(text, text, integer, timestamptz, uuid) is
  '按 username 读取该用户公开的喜欢/收藏（仅已发布作品）；private 仅本人，'
  'show_likes/show_favorites 关闭时本人以外返回空集；不存在与不可见统一 404';

-- ============================================================================
-- 3. 权限：只开放这两个函数，绝不动表级权限
--    （app_user 对 profiles/photos/likes/favorites 的 select 由 0019 提供，
--      本迁移不新增任何表级 grant —— 这是需求里的硬约束）
-- ============================================================================

revoke all on function public.api_profile_id_by_username(text) from public, app_user;
grant execute on function public.api_profile_id_by_username(text) to app_user;

revoke all on function public.api_list_profile_interactions(text, text, integer, timestamptz, uuid)
  from public, app_user;
grant execute on function public.api_list_profile_interactions(text, text, integer, timestamptz, uuid)
  to app_user;

-- ============================================================================
-- 4. 自检：迁移必须把上面的安全边界真正落地，而不是只写在注释里
-- ============================================================================

do $$
declare
  v_priv text;
begin
  -- 4.1 两个新函数必须是「固定 search_path 的 SECURITY DEFINER」
  if not exists (
    select 1
      from pg_proc pr
     where pr.oid = 'public.api_profile_id_by_username(text)'::regprocedure
       and pr.prosecdef
       and exists (
         select 1 from unnest(coalesce(pr.proconfig, array[]::text[])) c
          where c like 'search_path=%'
       )
  ) then
    raise exception '0023 自检失败：api_profile_id_by_username 不是固定 search_path 的 SECURITY DEFINER 函数';
  end if;

  if not exists (
    select 1
      from pg_proc pr
     where pr.oid = 'public.api_list_profile_interactions(text,text,integer,timestamptz,uuid)'::regprocedure
       and pr.prosecdef
       and exists (
         select 1 from unnest(coalesce(pr.proconfig, array[]::text[])) c
          where c like 'search_path=%'
       )
  ) then
    raise exception '0023 自检失败：api_list_profile_interactions 不是固定 search_path 的 SECURITY DEFINER 函数';
  end if;

  -- 4.2 公开 API 必须对 app_user 可用，否则服务端必然 42501
  if not has_function_privilege('app_user', 'public.api_profile_id_by_username(text)', 'execute') then
    raise exception '0023 自检失败：app_user 无法执行 api_profile_id_by_username';
  end if;
  if not has_function_privilege(
       'app_user',
       'public.api_list_profile_interactions(text,text,integer,timestamptz,uuid)',
       'execute'
     ) then
    raise exception '0023 自检失败：app_user 无法执行 api_list_profile_interactions';
  end if;

  -- 4.3 本迁移不得顺手放开任何表级写权限：likes / favorites 必须保持「只读」
  --     （app_user 只有一个 select，这是 0019 给的最小集）。
  --     刻意不检查 photos / profiles：那两张表上的 insert/update/delete 是 0013/0014
  --     的既有写入 API 留下的授权，属于别的迁移的边界，0023 既不依赖也不改动它。
  foreach v_priv in array array['insert', 'update', 'delete'] loop
    if has_table_privilege('app_user', 'public.likes', v_priv)
       or has_table_privilege('app_user', 'public.favorites', v_priv) then
      raise exception '0023 自检失败：app_user 拥有 likes/favorites 的 % 权限', v_priv;
    end if;
  end loop;

  -- 4.4 私密可见性所依赖的列/约束必须还在（0018 的 ck_profiles_visibility）
  if not exists (
    select 1 from pg_constraint
     where conname = 'ck_profiles_visibility'
       and conrelid = 'public.profiles'::regclass
  ) then
    raise exception '0023 自检失败：profiles.visibility 约束缺失，可见性语义没有保障';
  end if;
end;
$$;
