-- ============================================================================
-- 工科影展 · 0031 摄影专业化第一组（8.4a）：EXIF 隐私 · 器材浏览 · 地点与季节 · 主页代表作
-- 契约：.tmp/phase84a-freeze.md 第 2 节（数据库）与第 3 节（后端接口）
--
-- 本次只做「能以现有数据派生」的四项，不建新表：
--   1) EXIF 隐私：提出「有效可见性」= photos.exif_hidden or profiles.exif_visibility='hidden'
--   2) 器材：从 photos.exif 的 Make/Model/LensModel 派生，用表达式索引 + 聚合函数
--   3) 地点：沿用 location_name + location_precision，'hidden' 精度不进聚合
--   4) 代表作：profiles.pinned_photo_ids（≤3），公开资料投影里以作品摘要返回
--
-- 幂等约定（本文件逐条遵守，重放不会失败）：
--   * 加列一律 `add column if not exists`；约束无法 add constraint if not exists，
--     所以用 pg_constraint 判定后再 add（见 §1 的 DO 块）
--   * 每个函数先 `drop function if exists <签名>` 再 `create function`
--     （table-returning 的行型无法用 CREATE OR REPLACE 改，0018 已有同样的注释）
--   * drop 会连带丢掉函数上的授权，所以授权统一放在所有函数之后重做一遍（§7）
--   * 本迁移不创建触发器，因此没有「drop trigger 在 drop function 之前」的负担；
--     若将来给本组加触发器，务必先 drop trigger 再 drop function（否则 drop 会因依赖失败）
--   * 末尾 §8 的自检 DO 块：函数存在 / security definer / 固定 search_path /
--     app_user 可执行 / PUBLIC 已收口 / 列与索引存在，任何一条不满足就让整次迁移失败
--   * 文件含中文，必须按 UTF-8 保存与读取（PGCLIENTENCODING=UTF8）
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 列：账户级 EXIF 开关、逐张覆盖、代表作
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists exif_visibility text not null default 'public';
alter table public.profiles add column if not exists pinned_photo_ids uuid[] not null default '{}';
alter table public.photos add column if not exists exif_hidden boolean not null default false;

comment on column public.profiles.exif_visibility is
  '账户级拍摄参数公开范围：public | hidden。作为发布时的初始值与未逐张设置时的兜底；'
  '有效可见性 = photos.exif_hidden or profiles.exif_visibility = ''hidden''。';
comment on column public.profiles.pinned_photo_ids is
  '主页代表作（置顶）作品 id，最多 3 件，顺序即展示顺序；空数组 = 未设置。'
  '只允许走 api_set_pinned_photos 修改（校验归属/状态/上限）。';
comment on column public.photos.exif_hidden is
  '逐张覆盖：true = 这张不公开拍摄参数。与作者 exif_visibility 任一为隐藏即视为隐藏。';

-- 约束：PostgreSQL 没有 `add constraint if not exists`，用 pg_constraint 判定后补。
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname = 'ck_profiles_exif_visibility'
  ) then
    alter table public.profiles
      add constraint ck_profiles_exif_visibility
      check (exif_visibility in ('public', 'hidden'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname = 'ck_profiles_pinned_photo_ids'
  ) then
    alter table public.profiles
      add constraint ck_profiles_pinned_photo_ids
      check (cardinality(pinned_photo_ids) <= 3);
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. 表达式索引
--
-- 为什么要有第二组「label」索引：聚合与按 label 过滤都发生在
-- lower(btrim(<表达式>)) 上，只有索引表达式与查询表达式逐字一致时
-- planner 才会用上它；契约里列出的 (exif->>'Make', exif->>'Model') 双列索引
-- 只服务「按品牌/型号原值精确匹配」的访问路径，两者互补，都保留。
--
-- 部分索引条件里带上 exif_hidden = false：隐藏了拍摄参数的作品本来就不该
-- 出现在器材聚合里，写进索引谓词可以让索引更小。
-- ----------------------------------------------------------------------------
create index if not exists idx_photos_gear on public.photos
  (((exif ->> 'Make')), ((exif ->> 'Model')))
  where status = 'published' and deleted_at is null;

create index if not exists idx_photos_gear_body_label on public.photos
  (lower(btrim(coalesce(exif ->> 'Make', '') || ' ' || coalesce(exif ->> 'Model', ''))),
   published_at desc, id desc)
  where status = 'published' and deleted_at is null and exif_hidden = false;

create index if not exists idx_photos_gear_lens_label on public.photos
  (lower(btrim(coalesce(exif ->> 'LensModel', ''))), published_at desc, id desc)
  where status = 'published' and deleted_at is null and exif_hidden = false;

create index if not exists idx_photos_location on public.photos (location_name)
  where status = 'published' and deleted_at is null;

-- location_precision 的取值域是 exact | district | city | hidden（0004 的 check）。
-- 契约文档里写的 approximate 在库里不存在，这里按库的真实取值：!= 'hidden' 即可见。
create index if not exists idx_photos_place_label on public.photos
  (lower(btrim(location_name)), published_at desc, id desc)
  where status = 'published' and deleted_at is null and location_precision <> 'hidden';

-- ----------------------------------------------------------------------------
-- 3. 内部助手：代表作摘要
--
-- 为什么单独成一个函数：三个资料投影（公开资料 / 本人资料 / 账户设置）都要
-- 把 pinned_photo_ids 变成作品摘要，重复三段 jsonb 子查询必然漂移。
-- 这是内部函数：不给 app_user 执行权（见 §7），只由 definer 函数调用。
-- 顺序按传入数组（用户排的顺序），已下架/已删除的作品静默丢弃（不再 500）。
-- ----------------------------------------------------------------------------
drop function if exists public.profile_pinned_summaries(uuid[]);
create function public.profile_pinned_summaries(p_ids uuid[])
returns jsonb
language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(jsonb_agg(item order by ord), '[]'::jsonb)
    from (
      select want.ord,
             jsonb_build_object(
               'id', ph.id,
               'title', ph.title,
               'thumbKey', ph.thumb_key
             ) as item
        from unnest(coalesce(p_ids, '{}'::uuid[])) with ordinality as want(id, ord)
        join public.photos ph on ph.id = want.id
       where ph.status = 'published'
         and ph.deleted_at is null
    ) s;
$$;

comment on function public.profile_pinned_summaries(uuid[]) is
  '0031：把代表作 id 数组转成作品摘要（id/title/thumbKey），保持用户排序，丢弃已下架作品。内部函数，不授予 app_user。';

-- ----------------------------------------------------------------------------
-- 4. 器材：总览 + 分页作品流
--
-- 「有效可见性」在聚合与作品流里都生效：
--   不显示 EXIF 的作品既不计入器材统计，也不出现在该器材的作品列表里
--   （否则点进「Canon EOS R5」会看到一堆没公开参数的图，与统计口径自相矛盾）。
--
-- 只统计在架作品：status='published' and deleted_at is null and published_at is not null
-- （与 0027 标签聚合、/api/photos 的口径一致）。
-- 公开接口不返回用户 UUID：这里只给 photo_count / author_count 两个数字。
-- ----------------------------------------------------------------------------
drop function if exists public.api_list_gear(integer);
create function public.api_list_gear(p_limit integer default 30)
returns table(
  kind text,
  label text,
  photo_count integer,
  author_count integer
)
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  return query
    select g.kind, g.label, g.photo_count, g.author_count
      from (
        -- 机身：label = "Make Model"；按归一化键分组，展示取组内最小原始写法
        select 'body'::text as kind,
               min(btrim(coalesce(p.exif ->> 'Make', '') || ' ' || coalesce(p.exif ->> 'Model', ''))) as label,
               count(*)::integer as photo_count,
               count(distinct p.author_id)::integer as author_count
          from public.photos p
          join public.profiles a on a.id = p.author_id
         where p.status = 'published'
           and p.deleted_at is null
           and p.published_at is not null
           and p.exif_hidden = false
           and a.exif_visibility <> 'hidden'
           and btrim(coalesce(p.exif ->> 'Make', '') || ' ' || coalesce(p.exif ->> 'Model', '')) <> ''
         group by lower(btrim(coalesce(p.exif ->> 'Make', '') || ' ' || coalesce(p.exif ->> 'Model', '')))

        union all

        -- 镜头：label = LensModel
        select 'lens'::text as kind,
               min(btrim(coalesce(p.exif ->> 'LensModel', ''))) as label,
               count(*)::integer as photo_count,
               count(distinct p.author_id)::integer as author_count
          from public.photos p
          join public.profiles a on a.id = p.author_id
         where p.status = 'published'
           and p.deleted_at is null
           and p.published_at is not null
           and p.exif_hidden = false
           and a.exif_visibility <> 'hidden'
           and btrim(coalesce(p.exif ->> 'LensModel', '')) <> ''
         group by lower(btrim(coalesce(p.exif ->> 'LensModel', '')))
      ) g
     order by g.photo_count desc, g.kind asc, g.label asc
     limit v_limit;
end;
$$;

comment on function public.api_list_gear(integer) is
  '0031：器材总览（kind=body：Make Model；kind=lens：LensModel），按作品数倒序。只统计在架且 EXIF 公开的作品；不返回作者 UUID。';

-- 作品页投影（jsonb item）与 api_tag_photos / api_feed 的键名保持一致，
-- server 侧可以原样 mapPhoto() —— 多两个 0031 的键：
--   exif_hidden      ：有效可见性（逐张 or 账户级），前端据此显示「作者未公开拍摄参数」
--   author_exif_visibility ：作者账户级开关，供前端做解释性文案
-- exif 在隐藏时返回 '{}'（而不是 null）：契约要求 exifHidden=true 时 exif 为空对象，
-- 前端不必处理第三种「null」形态。
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
comment on function public.api_gear_photos(text, text, integer, jsonb) is
  '0031：某个器材下的作品流（latest，published_at+id keyset）。items 键名与 api_feed 一致并多 exif_hidden / author_exif_visibility；p_limit 钳到 1..51（server 取 limit+1 判断 hasMore）。';

-- ----------------------------------------------------------------------------
-- 5. 地点：总览 + 分页作品流
--
-- 排除 location_precision='hidden'（作者选择了不公开地点）与空名。
-- 注意 0004 的取值域是 exact | district | city | hidden，没有 approximate —— 
-- 契约里写的 approximate 在库里不存在，这里以库为准。
-- 名字里的「大概位置」语义仍由前端按精度展示，后端不额外加工（mappers 已处理坐标）。
-- ----------------------------------------------------------------------------
drop function if exists public.api_list_places(integer);
create function public.api_list_places(p_limit integer default 30)
returns table(
  label text,
  photo_count integer,
  author_count integer,
  latest_published_at timestamptz
)
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  return query
    select min(btrim(p.location_name)) as label,
           count(*)::integer as photo_count,
           count(distinct p.author_id)::integer as author_count,
           max(p.published_at) as latest_published_at
      from public.photos p
     where p.status = 'published'
       and p.deleted_at is null
       and p.published_at is not null
       and p.location_precision <> 'hidden'
       and btrim(p.location_name) <> ''
     group by lower(btrim(p.location_name))
     order by photo_count desc, label asc
     limit v_limit;
end;
$$;

comment on function public.api_list_places(integer) is
  '0031：地点总览（按 location_name 归一化聚合），按作品数倒序；排除 location_precision=hidden 与空名；不返回作者 UUID。';

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
comment on function public.api_place_photos(text, integer, jsonb) is
  '0031：某个地点下的作品流（latest，published_at+id keyset），items 与 api_gear_photos 同投影；排除 location_precision=hidden。';

-- ----------------------------------------------------------------------------
-- 6. 季节（按 shot_at 的月划分）
--
-- 四季恒返回 4 行（计数为 0 也返回）：前端 chips 需要稳定的四项，
-- 缺行会让「冬季」这种当前没有作品的季节从筛选器里消失。
-- 月份用 extract(month from shot_at)，即会话时区下的月份；server 侧统一 UTC。
-- ----------------------------------------------------------------------------
drop function if exists public.api_list_seasons();
create function public.api_list_seasons()
returns table(
  season text,
  photo_count integer
)
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  return query
    select s.season, coalesce(c.photo_count, 0)::integer
      from (values ('spring', 1), ('summer', 2), ('autumn', 3), ('winter', 4)) as s(season, ord)
      left join (
        select case
                 when extract(month from p.shot_at) between 3 and 5 then 'spring'
                 when extract(month from p.shot_at) between 6 and 8 then 'summer'
                 when extract(month from p.shot_at) between 9 and 11 then 'autumn'
                 else 'winter'
               end as season,
               count(*) as photo_count
          from public.photos p
         where p.status = 'published'
           and p.deleted_at is null
           and p.published_at is not null
           and p.shot_at is not null
         group by 1
      ) c on c.season = s.season
     order by s.ord;
end;
$$;

comment on function public.api_list_seasons() is
  '0031：按拍摄月份的四季作品数（3–5 春 / 6–8 夏 / 9–11 秋 / 12–2 冬），四季恒返回 4 行。';

-- ----------------------------------------------------------------------------
-- 7. 本人设置写入口：EXIF 可见性 / 代表作
-- ----------------------------------------------------------------------------
drop function if exists public.api_set_exif_visibility(text);
create function public.api_set_exif_visibility(p_visibility text)
returns text
language plpgsql volatile security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_value text := lower(btrim(coalesce(p_visibility, '')));
begin
  if v_uid is null then
    raise exception '必须登录后修改拍摄参数设置' using errcode = '42501';
  end if;
  if v_value not in ('public', 'hidden') then
    raise exception 'exif_visibility 只能是 public 或 hidden' using errcode = '22023';
  end if;

  update public.profiles
     set exif_visibility = v_value,
         updated_at = now()
   where id = v_uid;

  if not found then
    raise exception '账号不存在' using errcode = 'P0002';
  end if;

  return v_value;
end;
$$;

comment on function public.api_set_exif_visibility(text) is
  '0031：设置本人账户级 EXIF 可见性（public|hidden），非法取值 22023；返回生效值。';

drop function if exists public.api_set_pinned_photos(uuid, uuid[]);
create function public.api_set_pinned_photos(p_user_id uuid, p_photo_ids uuid[])
returns table(pinned_photo_ids uuid[])
language plpgsql volatile security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[] := coalesce(p_photo_ids, '{}'::uuid[]);
  v_dedup uuid[] := '{}'::uuid[];
  v_id uuid;
  v_bad integer := 0;
begin
  if v_uid is null then
    raise exception '必须登录后设置代表作' using errcode = '42501';
  end if;
  -- user id 只接受本人：不接受「帮别人设置」的调用形态，避免留一条提权入口。
  if p_user_id is null or p_user_id <> v_uid then
    raise exception '只能设置自己的代表作' using errcode = '42501';
  end if;

  -- 去重但保留用户给的顺序（代表作的顺序是作品集叙事的一部分）
  foreach v_id in array v_ids loop
    if v_id is not null and not (v_id = any(v_dedup)) then
      v_dedup := v_dedup || v_id;
    end if;
  end loop;

  if cardinality(v_dedup) > 3 then
    raise exception '代表作最多 3 件' using errcode = '23514';
  end if;

  if cardinality(v_dedup) > 0 then
    select count(*)
      into v_bad
      from unnest(v_dedup) as want(id)
     where not exists (
       select 1
         from public.photos ph
        where ph.id = want.id
          and ph.author_id = v_uid
          and ph.status = 'published'
          and ph.deleted_at is null
     );
    if v_bad > 0 then
      raise exception '代表作必须是自己已发布且未删除的作品' using errcode = '23514';
    end if;
  end if;

  update public.profiles
     set pinned_photo_ids = v_dedup,
         updated_at = now()
   where id = v_uid;

  if not found then
    raise exception '账号不存在' using errcode = 'P0002';
  end if;

  return query select v_dedup;
end;
$$;

comment on function public.api_set_pinned_photos(uuid, uuid[]) is
  '0031：设置主页代表作（≤3、仅本人、必须 published 且未删除，否则 23514 中文文案）；传空数组即清空；顺序即展示顺序。';

-- 读回当前代表作：PUT 之后前端需要「摘要」而不是只有 id 数组，
-- 单独一个只读函数比让 server 再拉一次整份账户设置更省。
drop function if exists public.api_get_own_pinned();
create function public.api_get_own_pinned()
returns table(
  pinned_photo_ids uuid[],
  pinned jsonb
)
language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select p.pinned_photo_ids,
         public.profile_pinned_summaries(p.pinned_photo_ids)
    from public.profiles p
   where p.id = auth.uid()
     and p.deleted_at is null;
$$;

comment on function public.api_get_own_pinned() is
  '0031：本人代表作（id 数组 + 作品摘要），未登录返回 0 行。';

-- ----------------------------------------------------------------------------
-- 8. 资料投影补 exifVisibility 与 pinned
--
-- 三个函数都改行型（多一列/两列），只能 drop + create；授权在 §9 重做。
-- 公开资料：exif_visibility + pinned（作品摘要，不含 UUID 以外的用户标识）
-- 本人资料 / 账户设置：同上，另外账户设置还要带 pinned_photo_ids 供 /me 编辑
-- ----------------------------------------------------------------------------
drop function if exists public.api_get_profile_by_username(text);
create function public.api_get_profile_by_username(p_username text)
returns table(
  username text, display_name text, avatar_key text, bio text, role text, links jsonb,
  license_preference text, visibility text, show_likes boolean, show_favorites boolean,
  discoverable boolean, created_at timestamptz, is_owner boolean, is_blocked boolean,
  exif_visibility text, pinned jsonb
)
language plpgsql security definer stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_target public.profiles;
begin
  select * into v_target
    from public.profiles p
   where lower(p.username::text) = lower(btrim(coalesce(p_username, '')))
     and p.deleted_at is null
     and (p.visibility = 'public' or v_uid = p.id)
   limit 1;

  if not found then
    return;
  end if;

  -- 0024：被目标拉黑 ⇒ 与「用户不存在」完全同一种错误（HTTP 都是 404）。
  if v_uid is not null and exists (
    select 1 from public.blocks b
     where b.blocker_id = v_target.id and b.blocked_id = v_uid
  ) then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
    select v_target.username::text,
           v_target.display_name,
           v_target.avatar_key,
           v_target.bio,
           v_target.role,
           v_target.links,
           v_target.license_preference,
           v_target.visibility,
           v_target.show_likes,
           v_target.show_favorites,
           v_target.discoverable,
           v_target.created_at,
           v_uid = v_target.id,
           (v_uid is not null and public.blocks_between(v_uid, v_target.id)),
           v_target.exif_visibility,
           public.profile_pinned_summaries(v_target.pinned_photo_ids);
end;
$$;

comment on function public.api_get_profile_by_username(text) is
  '直达公开资料；不返回 user UUID；被对方拉黑时抛 P0002（与不存在不可区分）；'
  '0031 起带 exif_visibility 与代表作摘要 pinned（[{id,title,thumbKey}]，已丢弃下架作品）。';

drop function if exists public.api_get_own_profile();
create function public.api_get_own_profile()
returns table(
  id uuid, username text, display_name text, avatar_key text, bio text, role text, links jsonb,
  license_preference text, created_at timestamptz, updated_at timestamptz, deleted_at timestamptz,
  exif_visibility text, pinned jsonb
)
language sql security definer stable
set search_path = pg_catalog, public, pg_temp
as $$
  select p.id, p.username::text, p.display_name, p.avatar_key, p.bio, p.role, p.links,
         p.license_preference, p.created_at, p.updated_at, p.deleted_at,
         p.exif_visibility,
         public.profile_pinned_summaries(p.pinned_photo_ids)
  from public.profiles p
  where p.id = auth.uid() and p.deleted_at is null;
$$;

drop function if exists public.api_get_own_account_settings();
create function public.api_get_own_account_settings()
returns table(
  id uuid, username text, display_name text, avatar_key text, bio text, role text, phone text,
  links jsonb, license_preference text, visibility text, show_likes boolean, show_favorites boolean,
  discoverable boolean, notification_preferences jsonb, created_at timestamptz, updated_at timestamptz,
  exif_visibility text, pinned_photo_ids uuid[], pinned jsonb
)
language sql security definer stable
set search_path = pg_catalog, public, pg_temp
as $$
  select p.id, p.username::text, p.display_name, p.avatar_key, p.bio, p.role, p.phone,
         p.links, p.license_preference, p.visibility, p.show_likes, p.show_favorites,
         p.discoverable, p.notification_preferences, p.created_at, p.updated_at,
         p.exif_visibility, p.pinned_photo_ids,
         public.profile_pinned_summaries(p.pinned_photo_ids)
  from public.profiles p
  where p.id = auth.uid() and p.deleted_at is null;
$$;

comment on function public.api_get_own_account_settings() is
  '0031 起带 exif_visibility / pinned_photo_ids / pinned 摘要，供设置页与 /me 代表作编辑读取。';

-- ----------------------------------------------------------------------------
-- 9. api_update_photo 支持 exifHidden（逐张开关）
--
-- 迁移前该函数白名单只有 title/description/categorySlug/tags/locationName/license/status。
-- 0031 增加 'exifHidden'（布尔）。仍然只允许作者本人改、仍然只接受白名单键。
-- 行型是 public.photos（未变），但按项目约定一律 drop + create，授权随后重做。
-- ----------------------------------------------------------------------------
drop function if exists public.api_update_photo(uuid, jsonb);
create function public.api_update_photo(p_photo_id uuid, p_patch jsonb)
returns public.photos
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.photos;
  v_allowed_keys constant text[] := array[
    'title','description','categorySlug','tags','locationName','license','status','exifHidden'
  ];
  v_unknown text[];
  v_status text;
  v_title text;
  v_description text;
  v_category_slug text;
  v_location_name text;
  v_license text;
  v_exif_hidden boolean;
begin
  if v_uid is null then
    raise exception '必须登录后修改作品' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception '修改内容不能为空' using errcode = '22023';
  end if;

  select array_agg(key order by key) into v_unknown
  from jsonb_object_keys(p_patch) as key
  where key <> all(v_allowed_keys);
  if v_unknown is not null then
    raise exception '包含不可修改的字段: %', array_to_string(v_unknown, ',') using errcode = '22023';
  end if;

  select * into v_row
  from public.photos
  where id = p_photo_id and author_id = v_uid
  for update;
  if not found then
    raise exception '作品不存在' using errcode = 'P0002';
  end if;
  if v_row.deleted_at is not null or v_row.status = 'removed' then
    raise exception '已撤回作品不可修改' using errcode = 'P0002';
  end if;

  v_status := coalesce(p_patch->>'status', v_row.status);
  if p_patch ? 'status' and v_status <> 'removed' then
    raise exception 'status 只能用于撤回作品' using errcode = '22023';
  end if;
  if v_row.status = 'hidden' and v_status <> 'removed' then
    raise exception '审核隐藏作品只能撤回' using errcode = '22023';
  end if;

  v_title := case when p_patch ? 'title' then btrim(p_patch->>'title') else v_row.title end;
  v_description := case when p_patch ? 'description' then btrim(p_patch->>'description') else v_row.description end;
  v_category_slug := case when p_patch ? 'categorySlug' then btrim(p_patch->>'categorySlug') else v_row.category_slug end;
  v_location_name := case when p_patch ? 'locationName' then btrim(p_patch->>'locationName') else v_row.location_name end;
  v_license := case when p_patch ? 'license' then p_patch->>'license' else v_row.license end;

  -- exifHidden：必须是 JSON 布尔。传 "true"（字符串）或 1 都不算 —— 静默纠正会把
  -- 「隐藏」写成「公开」，隐私开关上的模糊语义代价太大，所以直接 22023。
  if p_patch ? 'exifHidden' then
    if jsonb_typeof(p_patch->'exifHidden') <> 'boolean' then
      raise exception 'exifHidden 必须是布尔值' using errcode = '22023';
    end if;
    v_exif_hidden := (p_patch->>'exifHidden')::boolean;
  else
    v_exif_hidden := v_row.exif_hidden;
  end if;

  if v_title is null or char_length(v_title) not between 1 and 60 then
    raise exception '标题不合法' using errcode = '22023';
  end if;
  if v_description is null or char_length(v_description) > 2000 then
    raise exception '描述不合法' using errcode = '22023';
  end if;
  if v_category_slug is null or char_length(v_category_slug) not between 1 and 80 then
    raise exception '分类不合法' using errcode = '22023';
  end if;
  if v_location_name is null or char_length(v_location_name) > 80 then
    raise exception '地点名称不合法' using errcode = '22023';
  end if;
  if v_license not in ('all_rights_reserved','cc_by','cc_by_nc','cc_by_nc_nd','cc0') then
    raise exception '许可类型无效' using errcode = '22023';
  end if;
  if p_patch ? 'tags' and (
    jsonb_typeof(p_patch->'tags') <> 'array'
    or jsonb_array_length(p_patch->'tags') > 5
    or exists (
      select 1 from jsonb_array_elements(p_patch->'tags') as tag(value)
      where jsonb_typeof(tag.value) <> 'string'
         or char_length(btrim(tag.value #>> '{}')) < 1
         or char_length(btrim(tag.value #>> '{}')) > 20
         or btrim(tag.value #>> '{}') ~ '[[:cntrl:]]'
    )
  ) then
    raise exception '标签不合法' using errcode = '22023';
  end if;

  update public.photos
  set title = v_title,
      description = v_description,
      category_slug = v_category_slug,
      tags = case when p_patch ? 'tags' then array(
        select distinct lower(btrim(value #>> '{}'))
        from jsonb_array_elements(p_patch->'tags') as tag(value)
        order by lower(btrim(value #>> '{}'))
      ) else tags end,
      location_name = v_location_name,
      license = v_license,
      status = v_status,
      exif_hidden = v_exif_hidden,
      deleted_at = case when v_status = 'removed' then coalesce(deleted_at, clock_timestamp()) else deleted_at end
  where id = p_photo_id
    and author_id = v_uid
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.api_update_photo(uuid, jsonb) is
  '0031 起白名单增加 exifHidden（布尔，逐张隐藏拍摄参数）；其余字段与校验沿用 0017。';

-- ----------------------------------------------------------------------------
-- 10. 权限收口
--
-- drop function 会连带丢掉旧授权，所以这里必须把「本迁移动过的每个函数」重做一遍：
-- 先 revoke 掉 public（PostgreSQL 默认给 PUBLIC execute），再按需 grant 给 app_user。
-- 内部函数（profile_pinned_summaries）两边都收，只让 definer 身份内部调用。
-- ----------------------------------------------------------------------------
revoke all on function public.profile_pinned_summaries(uuid[]) from public, app_user;

revoke all on function public.api_list_gear(integer) from public, app_user;
grant execute on function public.api_list_gear(integer) to app_user;

revoke all on function public.api_gear_photos(text, text, integer, jsonb) from public, app_user;
grant execute on function public.api_gear_photos(text, text, integer, jsonb) to app_user;

revoke all on function public.api_list_places(integer) from public, app_user;
grant execute on function public.api_list_places(integer) to app_user;

revoke all on function public.api_place_photos(text, integer, jsonb) from public, app_user;
grant execute on function public.api_place_photos(text, integer, jsonb) to app_user;

revoke all on function public.api_list_seasons() from public, app_user;
grant execute on function public.api_list_seasons() to app_user;

revoke all on function public.api_set_exif_visibility(text) from public, app_user;
grant execute on function public.api_set_exif_visibility(text) to app_user;

revoke all on function public.api_set_pinned_photos(uuid, uuid[]) from public, app_user;
grant execute on function public.api_set_pinned_photos(uuid, uuid[]) to app_user;

revoke all on function public.api_get_own_pinned() from public, app_user;
grant execute on function public.api_get_own_pinned() to app_user;

revoke all on function public.api_get_profile_by_username(text) from public, app_user;
grant execute on function public.api_get_profile_by_username(text) to app_user;

revoke all on function public.api_get_own_profile() from public, app_user;
grant execute on function public.api_get_own_profile() to app_user;

revoke all on function public.api_get_own_account_settings() from public, app_user;
grant execute on function public.api_get_own_account_settings() to app_user;

revoke all on function public.api_update_photo(uuid, jsonb) from public, app_user;
grant execute on function public.api_update_photo(uuid, jsonb) to app_user;

-- ----------------------------------------------------------------------------
-- 10.5 修复 0029 的迁移顺序缺陷：moderation_actions 词表丢了 'review_appeal'
--
--     0025 把 'review_appeal' 加进 action_type 白名单；0029 为了补 feature/unfeature
--     重建了同一条约束，但重建时复制的是 0025 **之前**的 12 项词表，于是从零迁移的
--     库里申诉复核写审计必然撞 23514（实测：moderation 申诉套件两条用例全红）。
--     这里做前向修补而不改 0029：已部署的库靠 0031 补回，历史审计行不受影响。
--     判定条件用「约束定义里是否已含 review_appeal」，重复执行无副作用。
-- ----------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = 'public.moderation_actions'::regclass
     and c.conname in ('ck_moderation_actions_action_type', 'moderation_actions_action_type_check')
   limit 1;

  if v_def is null then
    raise exception '0031 失败：找不到 moderation_actions 的 action_type 检查约束';
  end if;

  if v_def not like '%review_appeal%' then
    alter table public.moderation_actions drop constraint if exists moderation_actions_action_type_check;
    alter table public.moderation_actions drop constraint if exists ck_moderation_actions_action_type;
    alter table public.moderation_actions
      add constraint ck_moderation_actions_action_type check (action_type = any (array[
        'claim_report','uphold_report','reject_report',
        'hide_photo','restore_photo','hide_comment','restore_comment',
        'warn_user','restrict_user','suspend_user','ban_user','revoke_sanction',
        'review_appeal','feature','unfeature'
      ]));
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 11. 自检
--     任何一条不满足就让整次迁移失败 —— 宁可部署失败，也不要出现
--     「路由能调、权限其实没配」的半成品。
-- ----------------------------------------------------------------------------
do $$
declare
  v_sig text;
  v_oid oid;
  v_definer boolean;
  v_has_path boolean;
  v_public_can_execute boolean;
begin
  -- 列
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'exif_visibility'
  ) then
    raise exception '0031 自检失败：profiles.exif_visibility 不存在';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'pinned_photo_ids'
  ) then
    raise exception '0031 自检失败：profiles.pinned_photo_ids 不存在';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'photos' and column_name = 'exif_hidden'
  ) then
    raise exception '0031 自检失败：photos.exif_hidden 不存在';
  end if;

  -- 约束
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.profiles'::regclass and conname = 'ck_profiles_exif_visibility'
  ) then
    raise exception '0031 自检失败：profiles 缺少 exif_visibility 约束';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.profiles'::regclass and conname = 'ck_profiles_pinned_photo_ids'
  ) then
    raise exception '0031 自检失败：profiles 缺少代表作上限约束';
  end if;

  -- 索引（器材/地点表达式索引）
  foreach v_sig in array array[
    'idx_photos_gear',
    'idx_photos_gear_body_label',
    'idx_photos_gear_lens_label',
    'idx_photos_location',
    'idx_photos_place_label'
  ] loop
    if not exists (
      select 1 from pg_indexes
       where schemaname = 'public' and indexname = v_sig
    ) then
      raise exception '0031 自检失败：索引 % 不存在', v_sig;
    end if;
  end loop;

  -- 对外函数：存在 / definer / 固定 search_path / app_user 可执行 / PUBLIC 不可执行
  foreach v_sig in array array[
    'api_list_gear(integer)',
    'api_gear_photos(text,text,integer,jsonb)',
    'api_list_places(integer)',
    'api_place_photos(text,integer,jsonb)',
    'api_list_seasons()',
    'api_set_exif_visibility(text)',
    'api_set_pinned_photos(uuid,uuid[])',
    'api_get_own_pinned()',
    'api_get_profile_by_username(text)',
    'api_get_own_profile()',
    'api_get_own_account_settings()',
    'api_update_photo(uuid,jsonb)'
  ] loop
    v_oid := to_regprocedure('public.' || v_sig);
    if v_oid is null then
      raise exception '0031 自检失败：函数 public.% 不存在', v_sig;
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
      raise exception '0031 自检失败：public.% 不是 security definer', v_sig;
    end if;
    if not coalesce(v_has_path, false) then
      raise exception '0031 自检失败：public.% 没有固定 search_path', v_sig;
    end if;
    if not has_function_privilege('app_user', v_oid, 'execute') then
      raise exception '0031 自检失败：app_user 不能执行 public.%', v_sig;
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
      raise exception '0031 自检失败：PUBLIC 仍然可以执行 public.%（revoke 没生效）', v_sig;
    end if;
  end loop;

  -- 内部助手不能被 app_user 直接调用（否则 client 绕过校验层）
  if to_regprocedure('public.profile_pinned_summaries(uuid[])') is null then
    raise exception '0031 自检失败：函数 public.profile_pinned_summaries(uuid[]) 不存在';
  end if;
  if has_function_privilege('app_user', 'public.profile_pinned_summaries(uuid[])', 'execute') then
    raise exception '0031 自检失败：app_user 不应能直接执行 public.profile_pinned_summaries';
  end if;

  -- 10.5 的修补必须真的生效：申诉复核要能写审计
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.moderation_actions'::regclass
       and pg_get_constraintdef(c.oid) like '%review_appeal%'
  ) then
    raise exception '0031 自检失败：moderation_actions.action_type 白名单缺少 review_appeal';
  end if;

  raise notice 'OK: 0031 摄影隐私迁移自检通过（列/约束/5 个索引/12 个对外函数 definer+search_path+app_user 可执行+PUBLIC 已收口 + review_appeal 词表已修复）';
end;
$$;
