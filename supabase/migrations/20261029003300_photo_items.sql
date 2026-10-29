\encoding UTF8
-- ============================================================================
-- 工科影展 · 0033 多图作品（组照）
--
-- 冻结契约：.tmp/phase84c-freeze.md 第 2、3 节。要点：
--   1) 一件作品 0–9 张图；position 0 就是封面。
--   2) photos.image_key / thumb_key / width / height / blurhash 仍然表示「封面」，
--      由 api_replace_photo_items 在写入时同步为 position = 0 那张 —— 于是
--      /api/photos、搜索、标签、器材、地点、通知、OG 等**全部既有查询零改动**，
--      它们照旧只读 photos.image_key。绝不是「把查询改成 join photo_items」。
--   3) 单图作品 = photo_items 里没有行、photos.item_count = 0、photos.image_key 不变。
--      item_count = 0 与 item_count = 1 在语义上都按「单图」渲染，所以历史数据
--      （迁移前所有作品都是 0）不需要任何数据搬迁。
--   4) photo_items 只经 SECURITY DEFINER 函数访问：表本身对 app_user 完全收回，
--      避免绕过封面同步逻辑直接写条目造成 image_key 与 position 0 不一致。
--
-- 幂等：全部 create ... if not exists / create or replace / drop ... if exists。
-- ============================================================================

-- ============================================================================
-- 1. photo_items 表
-- ============================================================================
create table if not exists public.photo_items (
  id         uuid primary key default gen_random_uuid(),
  photo_id   uuid not null references public.photos (id) on delete cascade,
  position   integer not null,
  image_key  text not null,
  thumb_key  text not null,
  width      integer not null,
  height     integer not null,
  blurhash   text,
  caption    text not null default '',
  created_at timestamptz not null default now()
);

comment on table public.photo_items is
  '多图作品（组照）的条目：position 0 即封面；封面同时冗余在 photos.image_key，让所有既有读路径都不需要 join';

-- 约束用「先 drop 再 add」而不是内联：create table if not exists 在重放时整段跳过，
-- 只剩这条路能保证「表已存在但缺约束」（手工建表、旧版本）也被修正。校验成本可忽略
-- （每件作品最多 9 行）。
alter table public.photo_items drop constraint if exists ck_photo_items_position;
alter table public.photo_items add constraint ck_photo_items_position
  check (position between 0 and 8);

alter table public.photo_items drop constraint if exists ck_photo_items_keys;
alter table public.photo_items add constraint ck_photo_items_keys
  check (
    char_length(btrim(image_key)) between 1 and 512
    and char_length(btrim(thumb_key)) between 1 and 512
  );

alter table public.photo_items drop constraint if exists ck_photo_items_size;
alter table public.photo_items add constraint ck_photo_items_size
  check (width between 1 and 40000 and height between 1 and 40000);

alter table public.photo_items drop constraint if exists ck_photo_items_caption;
alter table public.photo_items add constraint ck_photo_items_caption
  check (char_length(caption) <= 200);

-- 同一作品内 position 唯一：整组替换时「删除后重建」依赖它兜住重复 position。
create unique index if not exists uq_photo_items_position
  on public.photo_items (photo_id, position);

-- 读路径只需要「某作品的条目按 position 排列」，它正好被上面的唯一索引
-- (photo_id, position) 的前缀覆盖，因此不再额外建索引（少一份写放大）。

alter table public.photo_items enable row level security;
-- 刻意不用 force row level security：函数是 security definer（以 owner 身份执行），
-- force 会把 owner 也挡在外面，导致 api_replace/api_list 读到空表。
revoke all on table public.photo_items from public, app_user;

-- ============================================================================
-- 2. photos.item_count（由触发器维护）
-- ============================================================================
alter table public.photos add column if not exists item_count integer not null default 0;

comment on column public.photos.item_count is
  '组照条目数（0 或 1 = 单图）。封面字段仍是 image_key/thumb_key，本列只用于 UI 判断是否渲染画廊';

alter table public.photos drop constraint if exists ck_photos_item_count;
alter table public.photos add constraint ck_photos_item_count
  check (item_count between 0 and 9);

create or replace function public.photo_items_after_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_photo_id uuid;
begin
  -- 计数只依赖 photo_id；改 position/caption 不改变行数，所以触发器只挂在
  -- insert / delete / update of photo_id 上（避免每次改说明都全表重算）。
  if tg_op = 'DELETE' then
    v_photo_id := old.photo_id;
  else
    v_photo_id := new.photo_id;
  end if;

  update public.photos p
     set item_count = (
       select count(*)::integer from public.photo_items i where i.photo_id = v_photo_id
     )
   where p.id = v_photo_id;

  -- 条目被挪到另一件作品（理论上只有运维会这么做）：两侧都要重算。
  if tg_op = 'UPDATE' and old.photo_id is distinct from new.photo_id then
    update public.photos p
       set item_count = (
         select count(*)::integer from public.photo_items i where i.photo_id = old.photo_id
       )
     where p.id = old.photo_id;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_photo_items_count on public.photo_items;
create trigger trg_photo_items_count
  after insert or update of photo_id or delete on public.photo_items
  for each row execute function public.photo_items_after_change();

-- 自愈：把 item_count 与真实条目数对齐（迁移可重放，也顺手修历史脏数据）。
update public.photos p
   set item_count = counts.n
  from (
    select p2.id, (select count(*)::integer from public.photo_items i where i.photo_id = p2.id) as n
    from public.photos p2
  ) as counts
 where counts.id = p.id
   and p.item_count is distinct from counts.n;

-- ============================================================================
-- 3. 读：某作品的条目（公开；只在架时返回）
-- ============================================================================
create or replace function public.api_list_photo_items(p_photo_id uuid)
returns table(
  id uuid,
  -- position 是 SQL 关键字（POSITION(...) 函数名），作为返回列名必须加引号，
  -- 否则 returns table 的列定义会语法错误；对外的列名仍然叫 position。
  "position" integer,
  image_key text,
  thumb_key text,
  width integer,
  height integer,
  blurhash text,
  caption text
)
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  -- 可见性判据与 0010 的 p_photos_select 保持一致（在架 / 作者本人 / 编辑管理员）。
  -- 函数是 definer，RLS 不会替我们兜底，所以这里显式写一遍。
  select i.id, i."position", i.image_key, i.thumb_key, i.width, i.height, i.blurhash, i.caption
  from public.photo_items i
  join public.photos p on p.id = i.photo_id
  where i.photo_id = p_photo_id
    and (
      (p.status = 'published' and p.deleted_at is null)
      or (auth.uid() is not null and p.author_id = auth.uid())
      or public.is_editor_or_admin()
    )
  order by i."position";
$$;

comment on function public.api_list_photo_items(uuid) is
  '组照条目（按 position 升序）；不在架的作品只对作者/编辑可见';

-- ============================================================================
-- 4. 写：整组替换（作者本人；原子地清空重建 + 同步封面 + 重算 item_count）
-- ============================================================================
create or replace function public.api_replace_photo_items(
  p_photo_id uuid,
  p_actor_id uuid,
  p_items jsonb
)
returns table(photo_id uuid, item_count integer)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_photo public.photos;
  v_prefix text;
  v_total integer;
  v_index integer;
  v_item jsonb;
  v_image_key text;
  v_thumb_key text;
  v_slot text;
  v_caption text;
  v_count integer;
begin
  if v_uid is null then
    raise exception '必须登录后修改组照' using errcode = '42501';
  end if;
  -- p_actor_id 只用于与 auth.uid() 交叉校验；授权判据永远是会话身份，
  -- 不能让调用方自称是作者（与 0032 的 api_set_comments_locked 同款）。
  if p_actor_id is null or p_actor_id <> v_uid then
    raise exception '不能替他人修改作品组照' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items 必须是数组' using errcode = '22023';
  end if;

  select * into v_photo
  from public.photos p
  where p.id = p_photo_id
  for update;
  if not found then
    raise exception '作品不存在' using errcode = 'P0002';
  end if;
  if v_photo.author_id <> v_uid then
    -- 他人的作品一律 42501（与 0020 的 api_remove_photo 同款：不暴露存在性以外的信息，
    -- 但路由层已经把「作品不存在」变成 404，这里只可能是别人的作品）。
    raise exception '无权修改该作品的组照' using errcode = '42501';
  end if;
  if v_photo.deleted_at is not null or v_photo.status = 'removed' then
    raise exception '作品已撤回，不能再修改组照' using errcode = 'P0002';
  end if;

  v_total := jsonb_array_length(p_items);
  if v_total > 9 then
    raise exception '一件作品最多 9 张图' using errcode = '23514';
  end if;

  v_prefix := 'photos/' || v_uid::text || '/' || p_photo_id::text || '/';

  -- 第一轮：全量校验，一行都不写。任何一条不合法都整体失败，
  -- 不允许「改了 3 条再报错」这种半成品状态（整组替换必须是原子的）。
  for v_index in 0 .. v_total - 1 loop
    v_item := p_items -> v_index;
    if v_item is null or jsonb_typeof(v_item) <> 'object' then
      raise exception '第 % 张图的数据格式不正确', v_index + 1 using errcode = '22023';
    end if;
    if jsonb_typeof(v_item -> 'imageKey') is distinct from 'string'
       or jsonb_typeof(v_item -> 'thumbKey') is distinct from 'string'
       or jsonb_typeof(v_item -> 'width') is distinct from 'number'
       or jsonb_typeof(v_item -> 'height') is distinct from 'number' then
      raise exception '第 % 张图缺少 imageKey/thumbKey/width/height', v_index + 1 using errcode = '22023';
    end if;

    v_image_key := btrim(v_item ->> 'imageKey');
    v_thumb_key := btrim(v_item ->> 'thumbKey');

    -- 键必须落在「本人 / 本作品」目录内，且 display 与 thumb 指向同一个槽位。
    -- 槽位 = 旧的封面位置（/display.webp）或组照槽位（/items/{0-8}/display.webp）；
    -- 后者要支持，是因为 0033 之后的感觉流是「先 PUT 到 items 槽位，再创建作品」。
    if v_image_key !~ ('^' || v_prefix || '(items/[0-8]/)?display\.webp$')
       or v_thumb_key !~ ('^' || v_prefix || '(items/[0-8]/)?thumb\.webp$') then
      raise exception '第 % 张图的图片键不属于当前作品的条目槽位', v_index + 1 using errcode = '42501';
    end if;
    v_slot := replace(v_image_key, '/display.webp', '');
    if v_slot <> replace(v_thumb_key, '/thumb.webp', '') then
      raise exception '第 % 张图的封面键与缩略图键不匹配', v_index + 1 using errcode = '22023';
    end if;

    if (v_item ->> 'width')::numeric < 1 or (v_item ->> 'width')::numeric > 40000
       or (v_item ->> 'height')::numeric < 1 or (v_item ->> 'height')::numeric > 40000
       or (v_item ->> 'width')::numeric <> trunc((v_item ->> 'width')::numeric)
       or (v_item ->> 'height')::numeric <> trunc((v_item ->> 'height')::numeric) then
      raise exception '第 % 张图的宽高必须是正整数', v_index + 1 using errcode = '22023';
    end if;

    if v_item -> 'blurhash' is not null
       and jsonb_typeof(v_item -> 'blurhash') <> 'null'
       and jsonb_typeof(v_item -> 'blurhash') <> 'string' then
      raise exception '第 % 张图的 blurhash 必须是字符串或 null', v_index + 1 using errcode = '22023';
    end if;

    if v_item -> 'caption' is not null
       and jsonb_typeof(v_item -> 'caption') <> 'null'
       and jsonb_typeof(v_item -> 'caption') <> 'string' then
      raise exception '第 % 张图的说明必须是字符串', v_index + 1 using errcode = '22023';
    end if;
    v_caption := btrim(coalesce(v_item ->> 'caption', ''));
    if char_length(v_caption) > 200 then
      raise exception '第 % 张图的说明最多 200 字', v_index + 1 using errcode = '23514';
    end if;
  end loop;

  -- 第二轮：清空重建。
  delete from public.photo_items where photo_items.photo_id = p_photo_id;

  for v_index in 0 .. v_total - 1 loop
    v_item := p_items -> v_index;
    insert into public.photo_items (
      photo_id, position, image_key, thumb_key, width, height, blurhash, caption
    ) values (
      p_photo_id,
      v_index,
      btrim(v_item ->> 'imageKey'),
      btrim(v_item ->> 'thumbKey'),
      (v_item ->> 'width')::integer,
      (v_item ->> 'height')::integer,
      nullif(btrim(coalesce(v_item ->> 'blurhash', '')), ''),
      btrim(coalesce(v_item ->> 'caption', ''))
    );
  end loop;

  -- 封面同步：photos.image_key 等继续表示 position 0 那张（所有既有查询零改动）。
  -- 空数组 = 退回单图：刻意不动 image_key —— 上一轮的封面文件还在，仍然有效，
  -- 前端也因此不会出现「图片变空」的瞬间。
  if v_total > 0 then
    update public.photos p
       set image_key = i.image_key,
           thumb_key = i.thumb_key,
           width = i.width,
           height = i.height,
           blurhash = i.blurhash
      from public.photo_items i
     where i.photo_id = p_photo_id
       and i.position = 0
       and p.id = p_photo_id;
  end if;

  select count(*)::integer into v_count from public.photo_items i where i.photo_id = p_photo_id;

  return query select p_photo_id, v_count;
end;
$$;

comment on function public.api_replace_photo_items(uuid, uuid, jsonb) is
  '作者整组替换组照条目；同步 photos 封面字段并重算 item_count；空数组 = 退回单图';

-- ============================================================================
-- 5. 撤回清理：把 items 的 key 也入队
-- ============================================================================
create or replace function public.enqueue_photo_storage_cleanup(
  p_photo_id uuid,
  p_available_at timestamptz default clock_timestamp() + interval '30 days'
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer := 0;
begin
  -- 0033：除封面/缩略图外，组照里每一张的 image_key 与 thumb_key 各入队一行。
  -- 任务表一行只放一个 key（0020 的既有形状），所以这里用 union 展开成多行；
  -- (photo_id, object_key) 唯一约束让重复撤回、重复迁移都不会制造重复任务。
  -- 注意：photo_items 上的 on delete cascade 只在**硬删除**时带走行，
  -- 软撤回（本函数的前提）之后条目仍在，因此这里一定读得到。
  insert into public.photo_storage_cleanup_jobs (photo_id, object_key, available_at)
  select p.id, keys.object_key, p_available_at
  from public.photos p
  cross join lateral (
    select p.image_key as object_key
    union
    select p.thumb_key as object_key
    union
    select i.image_key from public.photo_items i where i.photo_id = p.id
    union
    select i.thumb_key from public.photo_items i where i.photo_id = p.id
  ) as keys
  where p.id = p_photo_id
    and p.status = 'removed'
    and p.deleted_at is not null
  on conflict (photo_id, object_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/**
 * 撤回即入队：PATCH /api/photos/:id 把 status 改成 removed 时也走这条路
 * （0020 只覆盖了 DELETE 端点，走 PATCH 撤回的作品此前会漏掉图片清理）。
 * 触发条件是「变成 removed 且 deleted_at 有值」，与 0020 的 backfill 同款判据，
 * 重复入队由唯一约束吞掉。
 */
create or replace function public.photos_enqueue_cleanup_on_revoke()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.enqueue_photo_storage_cleanup(new.id, new.deleted_at + interval '30 days');
  return null;
end;
$$;

drop trigger if exists trg_photos_enqueue_cleanup_on_revoke on public.photos;
create trigger trg_photos_enqueue_cleanup_on_revoke
  after update of status, deleted_at on public.photos
  for each row
  when (new.status = 'removed' and new.deleted_at is not null)
  execute function public.photos_enqueue_cleanup_on_revoke();

-- 为迁移前已经撤回、且当时还没有条目清理的作品补 items 任务（可安全重放）。
select public.enqueue_photo_storage_cleanup(
  p.id,
  p.deleted_at + interval '30 days'
)
from public.photos p
where p.status = 'removed'
  and p.deleted_at is not null
  and exists (select 1 from public.photo_items i where i.photo_id = p.id);

-- ============================================================================
-- 6. api_create_photo：允许封面直接指向 items/0 槽位
-- ============================================================================
-- 为什么改：8.4c 契约的上传顺序是「先逐张 PUT 到 items 槽位，再创建作品并提交 items」。
-- 0017 的校验要求 imageKey 恰好是 photos/{uid}/{pid}/display.webp，会把组照封面
-- 挡在门外（前端只能把封面再传一份到旧路径，白花流量，且中间态封面可能是 404）。
-- 这里只是**放宽**：旧的 /display.webp 仍然完全等价通过（单图作品零回归），
-- 新增接受 /items/{0-8}/display.webp，并且 display 与 thumb 必须同一槽位。
-- 签名不变 ⇒ create or replace 保留既有授权，不需要 drop。
create or replace function public.api_create_photo(
  p_id uuid,
  p_title text,
  p_description text,
  p_category_slug text,
  p_tags text[],
  p_location_name text,
  p_location_lat numeric,
  p_location_lng numeric,
  p_location_precision text,
  p_shot_at timestamptz,
  p_exif jsonb,
  p_image_key text,
  p_thumb_key text,
  p_width integer,
  p_height integer,
  p_blurhash text,
  p_license text,
  p_credit text
)
returns public.photos
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.photos;
  v_prefix text;
  v_location_name text := btrim(coalesce(p_location_name, ''));
  v_location_lat numeric := p_location_lat;
  v_location_lng numeric := p_location_lng;
begin
  if v_uid is null then
    raise exception '必须登录后创建作品' using errcode = '42501';
  end if;
  if p_id is null then
    raise exception '作品 id 不能为空' using errcode = '22023';
  end if;
  v_prefix := 'photos/' || v_uid::text || '/' || p_id::text || '/';
  if p_image_key !~ ('^' || v_prefix || '(items/[0-8]/)?display\.webp$')
     or p_thumb_key !~ ('^' || v_prefix || '(items/[0-8]/)?thumb\.webp$')
     or replace(p_image_key, '/display.webp', '') <> replace(p_thumb_key, '/thumb.webp', '') then
    raise exception '图片键不属于当前用户或作品' using errcode = '42501';
  end if;
  if p_license not in ('all_rights_reserved','cc_by','cc_by_nc','cc_by_nc_nd','cc0') then
    raise exception '许可类型无效' using errcode = '22023';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 60
     or p_description is null or char_length(p_description) > 2000
     or p_category_slug is null or char_length(btrim(p_category_slug)) not between 1 and 80
     or char_length(v_location_name) > 80 then
    raise exception '作品字段长度无效' using errcode = '22023';
  end if;
  if coalesce(array_length(p_tags, 1), 0) > 5
     or exists (
       select 1 from unnest(coalesce(p_tags, '{}'::text[])) as tag
       where char_length(btrim(tag)) < 1
          or char_length(btrim(tag)) > 20
          or btrim(tag) ~ '[[:cntrl:]]'
     ) then
    raise exception '标签不合法' using errcode = '22023';
  end if;
  if p_location_precision not in ('exact','district','city','hidden') then
    raise exception '地点精度无效' using errcode = '22023';
  end if;
  if not public.is_allowed_photo_exif(p_exif) then
    raise exception 'EXIF 含不允许的字段' using errcode = '23514';
  end if;
  if p_location_precision = 'hidden' then
    v_location_name := '';
    v_location_lat := null;
    v_location_lng := null;
  elsif p_location_precision in ('city','district') then
    v_location_lat := null;
    v_location_lng := null;
  end if;

  insert into public.photos(
    id, author_id, title, description, category_slug, tags,
    location_name, location_lat, location_lng, location_precision,
    shot_at, exif, image_key, thumb_key, width, height, blurhash, license, credit, status
  ) values (
    p_id, v_uid, trim(p_title), coalesce(p_description, ''), p_category_slug,
    coalesce(p_tags, '{}'::text[]), v_location_name, v_location_lat, v_location_lng,
    p_location_precision, p_shot_at, p_exif, p_image_key, p_thumb_key,
    p_width, p_height, p_blurhash, p_license, p_credit, 'draft'
  ) returning * into v_row;

  return v_row;
end;
$$;

-- ============================================================================
-- 7. 授权与自检
-- ============================================================================
revoke all on function public.api_list_photo_items(uuid) from public, app_user;
revoke all on function public.api_replace_photo_items(uuid, uuid, jsonb) from public, app_user;
revoke all on function public.enqueue_photo_storage_cleanup(uuid, timestamptz) from public, app_user;

grant execute on function public.api_list_photo_items(uuid) to app_user;
grant execute on function public.api_replace_photo_items(uuid, uuid, jsonb) to app_user;

do $$
begin
  if has_table_privilege('app_user', 'public.photo_items', 'select')
     or has_table_privilege('app_user', 'public.photo_items', 'insert')
     or has_table_privilege('app_user', 'public.photo_items', 'update')
     or has_table_privilege('app_user', 'public.photo_items', 'delete') then
    raise exception '0033 自检失败：app_user 不应直接读写 photo_items（必须走函数以保证封面同步）';
  end if;

  if not exists (
    select 1 from pg_class c where c.oid = 'public.photo_items'::regclass and c.relrowsecurity
  ) then
    raise exception '0033 自检失败：photo_items 必须开启 RLS';
  end if;

  if not has_function_privilege('app_user', 'public.api_list_photo_items(uuid)', 'execute')
     or not has_function_privilege('app_user', 'public.api_replace_photo_items(uuid,uuid,jsonb)', 'execute') then
    raise exception '0033 自检失败：app_user 必须能执行组照读写函数';
  end if;

  if has_function_privilege('app_user', 'public.enqueue_photo_storage_cleanup(uuid,timestamptz)', 'execute') then
    raise exception '0033 自检失败：app_user 不应直接入队图片清理任务';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'photos' and column_name = 'item_count'
  ) then
    raise exception '0033 自检失败：photos.item_count 缺失';
  end if;

  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.photo_items'::regclass
      and t.tgname = 'trg_photo_items_count'
      and not t.tgisinternal
  ) then
    raise exception '0033 自检失败：item_count 维护触发器缺失';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'uq_photo_items_position'
  ) then
    raise exception '0033 自检失败：(photo_id, position) 唯一索引缺失';
  end if;

  if exists (
    select 1 from public.photo_items i
    join public.photos p on p.id = i.photo_id
    where p.item_count <> (select count(*)::integer from public.photo_items j where j.photo_id = i.photo_id)
  ) then
    raise exception '0033 自检失败：photos.item_count 与 photo_items 行数不一致';
  end if;
end;
$$;
