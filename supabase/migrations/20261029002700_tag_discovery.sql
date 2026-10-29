\encoding UTF8
-- ============================================================================
-- 工科影展 · 0027 标签体系与发现（8.3a 后端）
-- 依据：.tmp/phase83a-freeze.md（绑定契约）
--       docs/暂定产品完善计划表.md P1-11 / P1-12 / P1-13 / P1-14 / P1-15
--
-- 本迁移只提供「浏览与发现」所需的服务端能力，收藏夹 / 服务端草稿 / 创作者
-- 统计 / 通知聚合 / 推荐精选全部留到 8.3b，不在这里预埋。
--
-- 为什么需要新函数，而不是让 server 直接查 public.photos：
--   1) 标签是 photos.tags 这个 text[] 里的元素，聚合只能 unnest（GIN 索引对
--      「按标签分组统计作者数」不适用）。这类扫描必须收口在 SQL 侧，否则
--      server 会先拉全表再在 Node 里 group by。
--   2) 三处统计口径（列表 / 详情 / 搜索建议）必须是同一份 SQL：一旦各写一遍，
--      「草稿算不算」「已删算不算」迟早会分叉，出现「热门标签点进去是空列表」。
--      所以统计口径只写在 tag_aggregate() 一处，其余函数复用它。
--   3) api_tag_photos 必须能按 (published_at,id) 与
--      (like_count+favorite_count, published_at, id) 两种键做游标分页 ——
--      复合键的 keyset 条件写在 plpgsql 里比在 server 拼字符串更不容易错。
--
-- 口径（全部函数一致）：只统计 status = 'published' and deleted_at is null
-- 且 published_at is not null 的作品。tags 由 0007/0009 的
-- normalize_photo_tags() 在写入时转小写去重，这里仍然 lower() 兜住历史数据。
--
-- 不做的事（有意为之，见报告「需要复核」）：
--   * 不在标签列表里排除「作者已注销」的作品：/api/photos 的发现流也没有排除，
--     两处口径必须一致，否则标签页的 photoCount 与点进去的列表条数会对不上。
--   * 不做拉黑互斥：/api/photos 同样没有（只有 /api/feed 有），标签页属于公共
--     发现流，跟随 /api/photos 的语义。
--
-- 幂等：每个函数先 drop function if exists 再 create；整文件可重复回放。
-- 含中文说明一律走 UTF-8 文件 + psql -f（首行 \encoding UTF8）。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. tag_aggregate：标签统计口径的唯一实现（内部函数）
--    只给上面 4 个 SECURITY DEFINER 函数在 definer 身份下调用，app_user
--    没有 execute 权限（见 §5 授权与文件末尾自检），所以它不是新的对外面。
--    p_prefix：前缀过滤；null/空串表示不过滤。LIKE 通配符会被转义，
--    否则 prefix='%' 会退化成「全部标签」。空串标签（历史脏数据）会被丢掉，
--    免得页面上出现一个点不进去的空标签。
-- ----------------------------------------------------------------------------
drop function if exists public.tag_aggregate(text);
create function public.tag_aggregate(p_prefix text default null)
returns table (
  tag text,
  photo_count integer,
  author_count integer,
  latest_published_at timestamptz
)
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_prefix text := nullif(lower(btrim(coalesce(p_prefix, ''))), '');
  v_pattern text;
begin
  if v_prefix is not null then
    -- 先转义 \ % _ 再拼 '%'：前缀里的 % 应当是普通字符。
    v_pattern := replace(replace(replace(v_prefix, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
    select lower(t.tag) as tag,
           count(*)::integer as photo_count,
           count(distinct p.author_id)::integer as author_count,
           max(p.published_at) as latest_published_at
      from public.photos p
      cross join lateral unnest(coalesce(p.tags, array[]::text[])) as t(tag)
     where p.status = 'published'
       and p.deleted_at is null
       and p.published_at is not null
       and coalesce(btrim(t.tag), '') <> ''
       and (v_pattern is null or lower(t.tag) like v_pattern escape '\')
     group by lower(t.tag);
end;
$$;

comment on function public.tag_aggregate(text) is
  '0027：标签统计口径的唯一实现（published + 未删除 + 有发布时间；prefix 前缀过滤，通配符已转义）。仅供 0027 的 SECURITY DEFINER 函数内部复用，app_user 无 execute 权限。';

-- ----------------------------------------------------------------------------
-- 1. api_list_tags：标签总览（热门 / 最新）
--    hot    ：photo_count desc, latest_published_at desc, tag asc
--    latest ：latest_published_at desc, photo_count desc, tag asc
--    末位都补 tag asc：热门页里 photo_count 并列的标签若没有稳定次序，
--    分页/刷新会看到同一批标签换位置（前端标签云的顺序抖动）。
--    p_sort 非法 → 22023（server 翻成 400 VALIDATION），不静默猜测。
-- ----------------------------------------------------------------------------
drop function if exists public.api_list_tags(text, integer, text);
create function public.api_list_tags(
  p_sort text default 'hot',
  p_limit integer default 20,
  p_prefix text default null
)
returns table (
  tag text,
  photo_count integer,
  author_count integer,
  latest_published_at timestamptz
)
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_sort text := lower(btrim(coalesce(p_sort, 'hot')));
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if v_sort not in ('hot', 'latest') then
    raise exception 'INVALID_SORT:%', coalesce(p_sort, '') using errcode = '22023';
  end if;

  if v_sort = 'hot' then
    return query
      select a.tag, a.photo_count, a.author_count, a.latest_published_at
        from public.tag_aggregate(p_prefix) a
       order by a.photo_count desc,
                a.latest_published_at desc nulls last,
                a.tag asc
       limit v_limit;
  else
    return query
      select a.tag, a.photo_count, a.author_count, a.latest_published_at
        from public.tag_aggregate(p_prefix) a
       order by a.latest_published_at desc nulls last,
                a.photo_count desc,
                a.tag asc
       limit v_limit;
  end if;
end;
$$;

comment on function public.api_list_tags(text, integer, text) is
  '0027：标签总览。hot 按作品数、latest 按最新发布时间；p_prefix 前缀过滤；limit 钳到 1..50。';

-- ----------------------------------------------------------------------------
-- 2. api_tag_detail：标签详情 + 相关标签
--    * 未知标签不抛错，返回 photoCount/authorCount = 0、latestPublishedAt = null、
--      relatedTags = []（标签页要能用空态，而不是 404/500）。
--    * relatedTags：与该标签「共现于同一作品」的其他标签，按共现作品数倒序，
--      最多 12 个；并列按 tag asc 保证稳定。
--    * 共现统计的扫描范围先用 p.tags @> array[tag] 命中 GIN 索引
--      （idx_photos_tags），只 unnest 命中作品，不扫全表。
-- ----------------------------------------------------------------------------
drop function if exists public.api_tag_detail(text);
create function public.api_tag_detail(p_tag text)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_tag text := lower(btrim(coalesce(p_tag, '')));
  v_photo_count integer := 0;
  v_author_count integer := 0;
  v_latest timestamptz;
  v_related jsonb := '[]'::jsonb;
begin
  select coalesce(a.photo_count, 0), coalesce(a.author_count, 0), a.latest_published_at
    into v_photo_count, v_author_count, v_latest
    from public.tag_aggregate(v_tag) a
   where a.tag = v_tag;

  -- 未知标签：SELECT INTO 零行会把目标置 NULL，这里再兜一次。
  v_photo_count := coalesce(v_photo_count, 0);
  v_author_count := coalesce(v_author_count, 0);

  if v_tag <> '' and v_photo_count > 0 then
    select coalesce(jsonb_agg(jsonb_build_object('tag', r.tag, 'count', r.cnt)), '[]'::jsonb)
      into v_related
      from (
        select lower(u.tag) as tag, count(distinct p.id)::integer as cnt
          from public.photos p
          cross join lateral unnest(coalesce(p.tags, array[]::text[])) as u(tag)
         where p.status = 'published'
           and p.deleted_at is null
           and p.published_at is not null
           and p.tags @> array[v_tag]
           and coalesce(btrim(u.tag), '') <> ''
           and lower(u.tag) <> v_tag
         group by lower(u.tag)
         order by count(distinct p.id) desc, lower(u.tag) asc
         limit 12
      ) r;
  end if;

  return jsonb_build_object(
    'tag', v_tag,
    'photoCount', v_photo_count,
    'authorCount', v_author_count,
    'latestPublishedAt', v_latest,
    'relatedTags', coalesce(v_related, '[]'::jsonb)
  );
end;
$$;

comment on function public.api_tag_detail(text) is
  '0027：标签详情（作品数、作者数、最新发布时间、最多 12 个相关标签）。未知标签返回空态而非报错。';

-- ----------------------------------------------------------------------------
-- 3. api_tag_photos：标签下的作品分页（形状与 api_feed 一致）
--    返回 jsonb：{ "items": [ <照片列...>, "photoId", "cursorAt", "cursorId",
--    "cursorScore" ], "total": int }。
--
--    为什么 items 就是「照片行 + 游标键」：
--      api_feed 的每一行就是照片列（snake_case）+ 作者三列，server 侧统一用
--      lib/mappers.ts 的 mapPhoto() 消费。这里保持同一套键名，server 的
--      tags 仓储可以原样 mapPhoto(row)，不必为标签页写第二种映射；
--      多出来的 photoId/cursorAt/cursorId/cursorScore 只是游标键，不进 Photo。
--      刻意不返回 nextCursor：分页边界由 server 取 limit+1 判断，与
--      repositories/social.ts 的 listFeed 完全一致（一条代码路径）。
--
--    游标 p_cursor（jsonb 数组，与 server 的 base64url 编码一一对应）：
--      latest  : ["latest", <published_at ISO>, <id>]
--      popular : ["popular", <score>, <published_at ISO>, <id>]
--      第一元素必须等于 p_sort；长度/类型不对 → 22023（server 翻成 400）。
--    popular 的 score = like_count + favorite_count（与 /api/photos 的热门口径
--    一致），排序键 (score desc, published_at desc, id desc) 全在游标里，
--    所以并列分数不会漏行或重行。
--    p_limit 钳到 1..51（多取一行用于判断 hasMore，与 api_feed 相同）。
-- ----------------------------------------------------------------------------
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

comment on function public.api_tag_photos(text, text, jsonb, integer) is
  '0027：标签下的作品分页。items 的形状与 api_feed 返回列一致（照片列 + author_* 三列 + photoId/cursorAt/cursorId/cursorScore）；latest 按 (published_at,id)，popular 按 (like+favorite, published_at,id)，游标互不混用。';

-- ----------------------------------------------------------------------------
-- 4. api_search_tags：搜索建议 / 标签 Tab 所需的「前缀 + 热度」能力
--    p_query 为 null/空 时返回热门标签（搜索框聚焦但还没输入时的默认建议）。
--    前缀匹配与排序口径完全复用 tag_aggregate()，所以建议里的数字与
--    /api/tags 上的数字不会互相打架。
--    去掉用户可能输入的前导 '#'（"#cat" 与 "cat" 等价）。
-- ----------------------------------------------------------------------------
drop function if exists public.api_search_tags(text, integer);
create function public.api_search_tags(
  p_query text default null,
  p_limit integer default 10
)
returns table (
  tag text,
  photo_count integer
)
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_query text := ltrim(lower(btrim(coalesce(p_query, ''))), '#');
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 50);
begin
  v_query := btrim(v_query);

  return query
    select a.tag, a.photo_count
      from public.tag_aggregate(nullif(v_query, '')) a
     order by a.photo_count desc, a.tag asc
     limit v_limit;
end;
$$;

comment on function public.api_search_tags(text, integer) is
  '0027：标签前缀建议（去掉前导 #），按作品数倒序；空查询返回热门标签。';

-- ----------------------------------------------------------------------------
-- 5. 权限收口
--    * tag_aggregate 只给 definer 身份内部调用：public 与 app_user 都收回。
--    * 4 个对外函数：先 revoke 掉 public（PostgreSQL 默认给 PUBLIC execute，
--      不收口等于任何角色都能调），再逐个 grant 给 app_user。
-- ----------------------------------------------------------------------------
revoke all on function public.tag_aggregate(text) from public, app_user;

revoke all on function public.api_list_tags(text, integer, text) from public, app_user;
grant execute on function public.api_list_tags(text, integer, text) to app_user;

revoke all on function public.api_tag_detail(text) from public, app_user;
grant execute on function public.api_tag_detail(text) to app_user;

revoke all on function public.api_tag_photos(text, text, jsonb, integer) from public, app_user;
grant execute on function public.api_tag_photos(text, text, jsonb, integer) to app_user;

revoke all on function public.api_search_tags(text, integer) from public, app_user;
grant execute on function public.api_search_tags(text, integer) to app_user;

-- ----------------------------------------------------------------------------
-- 6. 自检：函数存在 / 是 security definer / 固定 search_path /
--    app_user 可执行 / PUBLIC 不可执行（tag_aggregate 反过来：app_user 不可执行）
--    放在迁移末尾，任何一条不满足就让整次迁移失败 —— 宁可部署失败，
--    也不要出现「路由能调、权限其实没配」的半成品。
-- ----------------------------------------------------------------------------
do $$
declare
  v_sig text;
  v_oid oid;
  v_definer boolean;
  v_has_path boolean;
  v_public_can_execute boolean;
begin
  foreach v_sig in array array[
    'api_list_tags(text,integer,text)',
    'api_tag_detail(text)',
    'api_tag_photos(text,text,jsonb,integer)',
    'api_search_tags(text,integer)'
  ] loop
    v_oid := to_regprocedure('public.' || v_sig);
    if v_oid is null then
      raise exception '0027 自检失败：函数 public.% 不存在', v_sig;
    end if;

    select p.prosecdef,
           exists (
             select 1
               from unnest(coalesce(p.proconfig, array[]::text[])) as c
              where c like 'search_path=%'
           )
      into v_definer, v_has_path
      from pg_proc p
     where p.oid = v_oid;

    if not coalesce(v_definer, false) then
      raise exception '0027 自检失败：public.% 不是 security definer', v_sig;
    end if;
    if not coalesce(v_has_path, false) then
      raise exception '0027 自检失败：public.% 没有固定 search_path', v_sig;
    end if;
    if not has_function_privilege('app_user', v_oid, 'execute') then
      raise exception '0027 自检失败：app_user 不能执行 public.%', v_sig;
    end if;

    select exists (
             select 1
               from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as a
              where a.grantee = 0
                and a.privilege_type = 'EXECUTE'
           )
      into v_public_can_execute
      from pg_proc p
     where p.oid = v_oid;

    if coalesce(v_public_can_execute, false) then
      raise exception '0027 自检失败：PUBLIC 仍然可以执行 public.%（revoke 没生效）', v_sig;
    end if;
  end loop;

  -- 内部聚合函数：不能被 app_user 直接调用（否则 client 绕过 4 个对外的校验层）
  if to_regprocedure('public.tag_aggregate(text)') is null then
    raise exception '0027 自检失败：函数 public.tag_aggregate(text) 不存在';
  end if;
  if has_function_privilege('app_user', 'public.tag_aggregate(text)', 'execute') then
    raise exception '0027 自检失败：app_user 不应能直接执行 public.tag_aggregate';
  end if;

  raise notice 'OK: 0027 标签发现迁移自检通过（4 个对外函数 definer+search_path+app_user 可执行+PUBLIC 已收口）';
end;
$$;
