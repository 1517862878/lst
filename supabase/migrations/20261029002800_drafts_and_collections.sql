\encoding UTF8
-- ============================================================================
-- 工科影展 · 0028 服务端草稿 + 收藏夹 / 公开相册（8.3b 后端）
--
-- 补什么：
--   1) publish_drafts        —— 跨设备的「未提交发布表单」草稿。
--   2) collections           —— 收藏夹（相册）本体。
--   3) collection_items      —— 收藏夹条目（多对多 + 排序位）。
--   4) 11 个 security definer API 函数（草稿 3 个、收藏夹 8 个）。
--   5) 重建 api_delete_own_account：注销时连带清理草稿与收藏夹。
--
-- 为什么：草稿此前只存在浏览器 localStorage（src/pages/PublishPage.tsx 的
--   DRAFT_KEY = 'gy:draft:publish'），换设备/换浏览器就丢；而「收藏夹/相册」
--   在库里完全不存在（favorites 是点赞式收藏一件作品，与相册是两件事，不合并）。
--
-- 权限模型（与 0025/0026/0027 一致，自查见 §8）：
--   * 三张新表全部 enable row level security，**且不建任何 policy**，
--     再 revoke all from public, app_user —— app_user 连直读都不行。
--     所有读写只能经 security definer 函数，函数内部逐条做「本人 / 可见性」判定。
--     这样即使将来有人误加明文查询，也拿不到跨用户数据。
--   * 每个 API 函数都 set search_path = pg_catalog, public，防 search_path 劫持。
--   * 内部辅助（触发器函数）revoke 到底，app_user 不可执行。
--
-- 幂等：create table / index / trigger 全部 if not exists；约束用
--   drop constraint if exists + add constraint；函数一律 drop function if exists
--   再 create（返回列变化时 create or replace 不允许改列名/列数，drop 最稳）；
--   授权每次重新 revoke + grant（drop function 会连带丢掉旧授权）。
--   整个文件可以原样重复回放。
--
-- 注意：本文件含大量中文，必须写成 UTF-8 并用 psql -f 执行
--   （psql -c 走 Windows 控制台代码页，中文会被折成 GBK 而乱码）。
-- ============================================================================

-- ============================================================================
-- §1 表结构
-- ============================================================================

-- --- 1.1 服务端草稿 ---------------------------------------------------------
-- user_id 直接做主键：一个用户一份草稿（发布页只有一个），upsert 天然幂等。
create table if not exists public.publish_drafts (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  payload    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.publish_drafts is
  '发布页表单草稿（一份/用户）。payload 由前端定义，服务端只做形状与大小护栏。';

-- 护栏用命名约束，方便回放时 drop + add（create table if not exists 不会补约束）
alter table public.publish_drafts drop constraint if exists publish_drafts_payload_is_object;
alter table public.publish_drafts add constraint publish_drafts_payload_is_object
  check (jsonb_typeof(payload) = 'object');

alter table public.publish_drafts drop constraint if exists publish_drafts_payload_size;
alter table public.publish_drafts add constraint publish_drafts_payload_size
  check (pg_column_size(payload) <= 65536);

-- --- 1.2 收藏夹 -------------------------------------------------------------
create table if not exists public.collections (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  description text not null default '',
  visibility  text not null default 'private',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

comment on table public.collections is
  '收藏夹（相册）。软删（deleted_at）；visibility: private 仅本人 / unlisted 不列出但凭 id 可读 / public 任何人可读。';

alter table public.collections drop constraint if exists collections_title_length;
alter table public.collections add constraint collections_title_length
  check (char_length(title) between 1 and 40);

alter table public.collections drop constraint if exists collections_description_length;
alter table public.collections add constraint collections_description_length
  check (char_length(description) <= 200);

alter table public.collections drop constraint if exists collections_visibility_check;
alter table public.collections add constraint collections_visibility_check
  check (visibility in ('private', 'unlisted', 'public'));

-- 列表按 updated_at 倒序（最近有增删的夹靠前），并带上 id 做稳定的键集分页兜底
create index if not exists idx_collections_owner_updated
  on public.collections (owner_id, updated_at desc, id desc)
  where deleted_at is null;

-- --- 1.3 收藏夹条目 ---------------------------------------------------------
create table if not exists public.collection_items (
  collection_id uuid not null references public.collections (id) on delete cascade,
  photo_id      uuid not null references public.photos (id) on delete cascade,
  position      integer not null default 0,
  added_at      timestamptz not null default now(),
  primary key (collection_id, photo_id)
);

comment on table public.collection_items is
  '收藏夹条目。主键 (collection_id, photo_id) 让重复添加天然幂等。';

alter table public.collection_items drop constraint if exists collection_items_position_check;
alter table public.collection_items add constraint collection_items_position_check
  check (position >= 0);

-- 排序键（position asc, added_at desc, photo_id desc）必须有完全对应的索引，
-- 否则游标分页每翻一页都要排序全表条目。
create index if not exists idx_collection_items_order
  on public.collection_items (collection_id, position asc, added_at desc, photo_id desc);

-- 反向查询（「这个作品被谁收藏了」/ 删除作品时的级联探测）
create index if not exists idx_collection_items_photo
  on public.collection_items (photo_id);

-- ============================================================================
-- §2 触发器
-- ============================================================================

-- --- 2.1 updated_at 维护（与全库一致，复用 0025 已有的 set_updated_at）-------
drop trigger if exists trg_collections_updated_at on public.collections;
create trigger trg_collections_updated_at
  before update on public.collections
  for each row execute function public.set_updated_at();

-- --- 2.2 条目增删/移位时把所属收藏夹的 updated_at 顶起来 ----------------------
-- 为什么：列表按 updated_at 倒序，「刚加过作品的夹」应该排前面；封面也是
-- 实时从条目里取的，顶起 updated_at 让前端缓存自然失效。
-- 非 definer：它只会以调用者身份执行，而 app_user 对本表没有任何写权限，
-- 条目改动全部发生在 definer 函数内（以 owner 身份），因此不会出现越权。
-- 先摘触发器再 drop 函数：回放时旧触发器仍依赖该函数，
-- 直接 drop function 会报「有其它对象倚赖它」（42501/2BP01），整文件就不幂等了。
drop trigger if exists trg_collection_items_touch on public.collection_items;
drop function if exists public.touch_collection_updated_at();
create function public.touch_collection_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  -- DELETE 触发器里不能读 NEW（记录未赋值，直接访问会抛 55000）
  if tg_op = 'DELETE' then
    v_id := old.collection_id;
  else
    v_id := new.collection_id;
  end if;

  update public.collections
     set updated_at = clock_timestamp()
   where id = v_id;

  return null;
end;
$$;

drop trigger if exists trg_collection_items_touch on public.collection_items;
create trigger trg_collection_items_touch
  after insert or delete or update of position on public.collection_items
  for each row execute function public.touch_collection_updated_at();

-- ============================================================================
-- §3 表级权限：开 RLS + 不建 policy + 收干净 app_user 的表权限
--     没有 policy 的 RLS 表 = 任何非 owner 角色读不到任何行；
--     再 revoke 掉表权限，连「表存在」这件事都不会被复用成探测面。
--     所有访问都必须经过下面 §4/§5 的 definer 函数。
-- ============================================================================

alter table public.publish_drafts   enable row level security;
alter table public.collections      enable row level security;
alter table public.collection_items enable row level security;

revoke all on public.publish_drafts   from public, app_user;
revoke all on public.collections      from public, app_user;
revoke all on public.collection_items from public, app_user;

-- ============================================================================
-- §4 草稿函数（3 个）
-- ============================================================================

-- --- 4.1 读草稿 ------------------------------------------------------------
-- 无草稿时返回空集（路由翻成 {payload: null, updatedAt: null}）。
drop function if exists public.api_get_publish_draft();
create function public.api_get_publish_draft()
returns table (payload jsonb, updated_at timestamptz)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  -- 显式限定 d.updated_at：OUT 参数同名，不加限定会被当成参数
  return query
    select d.payload, d.updated_at
      from public.publish_drafts d
     where d.user_id = v_uid;
end;
$$;

comment on function public.api_get_publish_draft() is
  '读本人发布草稿；无草稿返回空集。';

-- --- 4.2 存草稿（upsert）---------------------------------------------------
drop function if exists public.api_save_publish_draft(jsonb);
create function public.api_save_publish_draft(p_payload jsonb)
returns table (updated_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_updated_at timestamptz;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception '草稿内容必须是 JSON 对象' using errcode = '23514';
  end if;

  if pg_column_size(p_payload) > 65536 then
    raise exception '草稿内容超过 64KB 上限' using errcode = '23514';
  end if;

  insert into public.publish_drafts (user_id, payload, updated_at)
  values (v_uid, p_payload, clock_timestamp())
  on conflict (user_id) do update
     set payload    = excluded.payload,
         updated_at = excluded.updated_at;

  select d.updated_at into v_updated_at
    from public.publish_drafts d
   where d.user_id = v_uid;

  return query select v_updated_at;
end;
$$;

comment on function public.api_save_publish_draft(jsonb) is
  '保存（upsert）本人发布草稿；payload 必须是对象且 ≤64KB。';

-- --- 4.3 删草稿（幂等）-----------------------------------------------------
drop function if exists public.api_delete_publish_draft();
create function public.api_delete_publish_draft()
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  delete from public.publish_drafts where user_id = v_uid;
end;
$$;

comment on function public.api_delete_publish_draft() is
  '删除本人发布草稿；本来没有草稿也算成功（幂等）。';

-- ============================================================================
-- §5 收藏夹函数（8 个）
-- ============================================================================

-- --- 5.1 某人的收藏夹列表 --------------------------------------------------
-- p_include_private 只有「目标就是调用者本人」时才生效，
-- 前端传 true 也拿不到别人的私密夹（这条是 8.3b 的硬安全要求）。
drop function if exists public.api_list_collections(text, boolean);
create function public.api_list_collections(p_owner_username text, p_include_private boolean default false)
returns table (
  id uuid,
  title text,
  description text,
  visibility text,
  item_count integer,
  cover_photo_id uuid,
  owner_username text,
  owner_display_name text,
  updated_at timestamptz
)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_username text := btrim(coalesce(p_owner_username, ''));
  v_owner_id uuid;
  v_owner_username text;
  v_owner_display_name text;
  v_profile_visibility text;
  v_profile_deleted timestamptz;
  v_include_private boolean;
begin
  if v_username = '' then
    raise exception 'USERNAME_REQUIRED' using errcode = '22023';
  end if;

  select p.id, p.username::text, p.display_name, p.visibility, p.deleted_at
    into v_owner_id, v_owner_username, v_owner_display_name, v_profile_visibility, v_profile_deleted
    from public.profiles p
   where p.username = v_username::citext;

  if v_owner_id is null or v_profile_deleted is not null then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 私密资料页连收藏夹列表都不暴露（与 0023 的 likes/favorites 语义一致，防账号探测）
  if v_profile_visibility = 'private' and v_owner_id is distinct from v_uid then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_include_private := coalesce(p_include_private, false) and v_owner_id is not distinct from v_uid;

  return query
    select c.id,
           c.title,
           c.description,
           c.visibility,
           st.item_count,
           st.cover_photo_id,
           v_owner_username,
           v_owner_display_name,
           c.updated_at
      from public.collections c
      -- item_count 与封面必须用同一个「可见作品」谓词，否则会出现
      -- 「数量 5、封面却是第 1 个已删除作品」这种自相矛盾
      cross join lateral (
        select count(*)::integer as item_count,
               (array_agg(ci.photo_id order by ci.position asc, ci.added_at desc, ci.photo_id desc))[1] as cover_photo_id
          from public.collection_items ci
          join public.photos ph on ph.id = ci.photo_id
         where ci.collection_id = c.id
           and ph.status = 'published'
           and ph.deleted_at is null
      ) st
     where c.owner_id = v_owner_id
       and c.deleted_at is null
       and (c.visibility = 'public' or v_include_private)
     order by c.updated_at desc, c.id desc;
end;
$$;

comment on function public.api_list_collections(text, boolean) is
  '列某人的收藏夹。他人只见 public；本人额外可见 unlisted/private（p_include_private 仅对本人生效）。';

-- --- 5.2 单个收藏夹 --------------------------------------------------------
-- 不可见 / 已删除 / 不存在统统返回空集，由路由翻成 404（不泄露「存在但无权」）。
drop function if exists public.api_get_collection(uuid);
create function public.api_get_collection(p_id uuid)
returns table (
  id uuid,
  title text,
  description text,
  visibility text,
  owner_id uuid,
  owner_username text,
  owner_display_name text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
begin
  return query
    select c.id,
           c.title,
           c.description,
           c.visibility,
           c.owner_id,
           p.username::text,
           p.display_name,
           c.created_at,
           c.updated_at
      from public.collections c
      join public.profiles p on p.id = c.owner_id
     where c.id = p_id
       and c.deleted_at is null
       and (c.visibility in ('public', 'unlisted')
            or (c.visibility = 'private' and c.owner_id is not distinct from v_uid));
end;
$$;

comment on function public.api_get_collection(uuid) is
  '读单个收藏夹；public/unlisted 任何人、private 仅本人。不可见时返回空集。';

-- --- 5.3 新建收藏夹 --------------------------------------------------------
drop function if exists public.api_create_collection(text, text, text);
create function public.api_create_collection(p_title text, p_description text, p_visibility text)
returns table (
  id uuid,
  title text,
  description text,
  visibility text,
  owner_id uuid,
  owner_username text,
  owner_display_name text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_visibility text := coalesce(nullif(btrim(coalesce(p_visibility, '')), ''), 'private');
  v_id uuid;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if char_length(v_title) < 1 then
    raise exception '收藏夹标题不能为空' using errcode = '23514';
  end if;
  if char_length(v_title) > 40 then
    raise exception '收藏夹标题最多 40 字' using errcode = '23514';
  end if;
  if char_length(v_description) > 200 then
    raise exception '收藏夹简介最多 200 字' using errcode = '23514';
  end if;
  if v_visibility not in ('private', 'unlisted', 'public') then
    raise exception 'INVALID_VISIBILITY:%', v_visibility using errcode = '22023';
  end if;

  -- 事务级咨询锁：两个人（或同一人两个标签页）并发新建时，
  -- 若不加锁，两个事务都会看到 29 个、各自插进去变成 31 个。
  -- 锁按用户分片，只在「新建收藏夹」这条路径上串行化，代价可忽略。
  perform pg_advisory_xact_lock(hashtext('collections:' || v_uid::text)::bigint);

  select count(*)::integer into v_count
    from public.collections c
   where c.owner_id = v_uid and c.deleted_at is null;

  if v_count >= 30 then
    -- 53400 = configuration_limit_exceeded：服务端 translateDbError 把它译成
    -- 422 LIMIT_EXCEEDED（契约 §2 要求「超过 30 个夹报 422」，而 23514 会变 400）
    raise exception '收藏夹数量已达上限' using errcode = '53400';
  end if;

  -- 必须用别名：OUT 参数里也有 id，RETURNING 写裸 id 会被当成参数
  insert into public.collections as c (owner_id, title, description, visibility)
  values (v_uid, v_title, v_description, v_visibility)
  returning c.id into v_id;

  return query
    select c.id, c.title, c.description, c.visibility, c.owner_id,
           p.username::text, p.display_name, c.created_at, c.updated_at
      from public.collections c
      join public.profiles p on p.id = c.owner_id
     where c.id = v_id;
end;
$$;

comment on function public.api_create_collection(text, text, text) is
  '新建收藏夹（每用户最多 30 个未删除）。非本人相关判定不适用；未登录 42501。';

-- --- 5.4 改名 / 改简介 / 改可见性 -------------------------------------------
-- p_title / p_description / p_visibility 传 null 表示「这一项不动」；
-- 简介传空串表示「清空」——两者必须区分开，否则前端无法只改可见性。
drop function if exists public.api_update_collection(uuid, text, text, text);
create function public.api_update_collection(p_id uuid, p_title text, p_description text, p_visibility text)
returns table (
  id uuid,
  title text,
  description text,
  visibility text,
  owner_id uuid,
  owner_username text,
  owner_display_name text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.collections;
  v_title text;
  v_description text;
  v_visibility text;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select * into v_row from public.collections c where c.id = p_id;
  if not found or v_row.deleted_at is not null then
    raise exception 'COLLECTION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.owner_id <> v_uid then
    raise exception 'COLLECTION_FORBIDDEN' using errcode = '42501';
  end if;

  v_title := case when p_title is null then v_row.title else btrim(p_title) end;
  v_description := case when p_description is null then v_row.description else btrim(p_description) end;
  v_visibility := case when p_visibility is null or btrim(p_visibility) = '' then v_row.visibility
                       else btrim(p_visibility) end;

  if char_length(v_title) < 1 then
    raise exception '收藏夹标题不能为空' using errcode = '23514';
  end if;
  if char_length(v_title) > 40 then
    raise exception '收藏夹标题最多 40 字' using errcode = '23514';
  end if;
  if char_length(v_description) > 200 then
    raise exception '收藏夹简介最多 200 字' using errcode = '23514';
  end if;
  if v_visibility not in ('private', 'unlisted', 'public') then
    raise exception 'INVALID_VISIBILITY:%', v_visibility using errcode = '22023';
  end if;

  update public.collections c
     set title       = v_title,
         description = v_description,
         visibility  = v_visibility
   where c.id = p_id;

  return query
    select c.id, c.title, c.description, c.visibility, c.owner_id,
           p.username::text, p.display_name, c.created_at, c.updated_at
      from public.collections c
      join public.profiles p on p.id = c.owner_id
     where c.id = p_id;
end;
$$;

comment on function public.api_update_collection(uuid, text, text, text) is
  '改收藏夹标题/简介/可见性（传 null 表示该项不动）。非本人 42501。';

-- --- 5.5 软删收藏夹 -------------------------------------------------------
drop function if exists public.api_delete_collection(uuid);
create function public.api_delete_collection(p_id uuid)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.collections;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select * into v_row from public.collections c where c.id = p_id;
  if not found or v_row.deleted_at is not null then
    raise exception 'COLLECTION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.owner_id <> v_uid then
    raise exception 'COLLECTION_FORBIDDEN' using errcode = '42501';
  end if;

  -- 软删：条目保留（作品可能还想恢复夹），读取路径一律带 deleted_at is null，
  -- 所以软删后无论本人还是他人都读不到。
  update public.collections c
     set deleted_at = clock_timestamp()
   where c.id = p_id;
end;
$$;

comment on function public.api_delete_collection(uuid) is
  '软删收藏夹（置 deleted_at）。非本人 42501。';

-- --- 5.6 加作品到收藏夹 ----------------------------------------------------
-- 重复添加幂等（主键冲突不报错，返回当前数量）；只能收藏已发布且未删除的作品。
drop function if exists public.api_add_collection_item(uuid, uuid);
create function public.api_add_collection_item(p_collection_id uuid, p_photo_id uuid)
returns table (item_count integer)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_deleted timestamptz;
  v_status text;
  v_photo_deleted timestamptz;
  v_total integer;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select c.owner_id, c.deleted_at into v_owner, v_deleted
    from public.collections c
   where c.id = p_collection_id;

  if v_owner is null or v_deleted is not null then
    raise exception 'COLLECTION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_owner <> v_uid then
    raise exception 'COLLECTION_FORBIDDEN' using errcode = '42501';
  end if;

  select p.status, p.deleted_at into v_status, v_photo_deleted
    from public.photos p
   where p.id = p_photo_id;

  if v_status is null then
    raise exception 'PHOTO_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status <> 'published' or v_photo_deleted is not null then
    raise exception '只能收藏已发布作品' using errcode = '23514';
  end if;

  -- 单夹护栏：契约没写，但一个夹无限长会让详情页与封面查询失去意义。
  -- 已收藏的重复点击不占新额度（下面先判存在）。
  if not exists (
    select 1 from public.collection_items ci
     where ci.collection_id = p_collection_id and ci.photo_id = p_photo_id
  ) then
    select count(*)::integer into v_total
      from public.collection_items ci
     where ci.collection_id = p_collection_id;
    if v_total >= 500 then
      raise exception '单个收藏夹最多 500 件作品' using errcode = '53400';
    end if;
  end if;

  insert into public.collection_items (collection_id, photo_id)
  values (p_collection_id, p_photo_id)
  on conflict (collection_id, photo_id) do nothing;

  -- 返回「可见件数」：作者把作品撤下后，条目还在但界面已经不显示它
  select count(*)::integer into v_count
    from public.collection_items ci
    join public.photos ph on ph.id = ci.photo_id
   where ci.collection_id = p_collection_id
     and ph.status = 'published'
     and ph.deleted_at is null;

  return query select coalesce(v_count, 0);
end;
$$;

comment on function public.api_add_collection_item(uuid, uuid) is
  '把作品加入本人收藏夹（幂等）。非本人 42501；非已发布作品 23514；超过 500 件 53400。';

-- --- 5.7 从收藏夹移除作品（幂等）-------------------------------------------
drop function if exists public.api_remove_collection_item(uuid, uuid);
create function public.api_remove_collection_item(p_collection_id uuid, p_photo_id uuid)
returns table (item_count integer)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_deleted timestamptz;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select c.owner_id, c.deleted_at into v_owner, v_deleted
    from public.collections c
   where c.id = p_collection_id;

  if v_owner is null or v_deleted is not null then
    raise exception 'COLLECTION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_owner <> v_uid then
    raise exception 'COLLECTION_FORBIDDEN' using errcode = '42501';
  end if;

  -- 不在夹里也算成功（幂等）
  delete from public.collection_items ci
   where ci.collection_id = p_collection_id and ci.photo_id = p_photo_id;

  select count(*)::integer into v_count
    from public.collection_items ci
    join public.photos ph on ph.id = ci.photo_id
   where ci.collection_id = p_collection_id
     and ph.status = 'published'
     and ph.deleted_at is null;

  return query select coalesce(v_count, 0);
end;
$$;

comment on function public.api_remove_collection_item(uuid, uuid) is
  '把作品移出本人收藏夹（幂等）。非本人 42501。';

-- --- 5.8 收藏夹条目分页 ----------------------------------------------------
-- 返回 table(items jsonb, next_cursor jsonb)：可见时恒一行，items 至少是 '[]'。
-- 不可见 / 已删除 / 不存在时**返回零行**（路由据此转 404，与 5.2 的空集语义同构；
-- 若返回一行空数组，路由就无法区分「空夹」和「无权看」）。
--
-- items 每项 = to_jsonb(photos 整行) || {author_username, author_display_name,
-- author_avatar_key, added_at}：作者字段在这次 join 里一次取出，TS 侧不再逐条
-- 回查 profiles（避免 N+1）。
drop function if exists public.api_list_collection_items(uuid, jsonb, integer);
create function public.api_list_collection_items(p_collection_id uuid, p_cursor jsonb default null, p_limit integer default 20)
returns table (items jsonb, next_cursor jsonb)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_owner uuid;
  v_visibility text;
  v_deleted timestamptz;
  v_cp integer;
  v_ca timestamptz;
  v_ci uuid;
  v_items jsonb := '[]'::jsonb;
  v_seen integer := 0;
  v_has_more boolean := false;
  v_lp integer;
  v_la timestamptz;
  v_li uuid;
  r record;
begin
  select c.owner_id, c.visibility, c.deleted_at
    into v_owner, v_visibility, v_deleted
    from public.collections c
   where c.id = p_collection_id;

  -- 已删除任何情况下都不可读；private 仅本人
  if v_owner is null or v_deleted is not null then
    return;
  end if;
  if v_visibility = 'private' and v_owner is distinct from v_uid then
    return;
  end if;

  -- 游标：{"p": position, "a": added_at, "i": photo_id}
  if p_cursor is not null and jsonb_typeof(p_cursor) <> 'null' then
    if jsonb_typeof(p_cursor) <> 'object' then
      raise exception 'INVALID_CURSOR' using errcode = '22023';
    end if;
    begin
      v_cp := nullif(p_cursor ->> 'p', '')::integer;
      v_ca := nullif(p_cursor ->> 'a', '')::timestamptz;
      v_ci := nullif(p_cursor ->> 'i', '')::uuid;
    exception when others then
      raise exception 'INVALID_CURSOR' using errcode = '22023';
    end;
    if v_cp is null or v_ca is null or v_ci is null then
      raise exception 'INVALID_CURSOR' using errcode = '22023';
    end if;
  end if;

  for r in
    select ci.position,
           ci.added_at,
           ci.photo_id,
           to_jsonb(ph) || jsonb_build_object(
             'author_username', au.username,
             'author_display_name', au.display_name,
             'author_avatar_key', au.avatar_key,
             'added_at', ci.added_at,
             -- 排序位也一并下发：前端将来做拖拽排序/回显位置时不用再查一次，
             -- 且它与游标里的 p 是同一个值（游标由本函数的 next_cursor 自行产出）。
             'position', ci.position
           ) as card
      from public.collection_items ci
      join public.photos ph
        on ph.id = ci.photo_id
       and ph.status = 'published'
       and ph.deleted_at is null
      left join public.profiles au on au.id = ph.author_id
     where ci.collection_id = p_collection_id
       and (
         v_ca is null
         or ci.position > v_cp
         or (ci.position = v_cp and ci.added_at < v_ca)
         or (ci.position = v_cp and ci.added_at = v_ca and ci.photo_id < v_ci)
       )
     order by ci.position asc, ci.added_at desc, ci.photo_id desc
     limit v_limit + 1
  loop
    v_seen := v_seen + 1;
    if v_seen > v_limit then
      v_has_more := true;
      exit;
    end if;
    v_items := v_items || r.card;
    v_lp := r.position;
    v_la := r.added_at;
    v_li := r.photo_id;
  end loop;

  if v_has_more then
    return query select v_items, jsonb_build_object('p', v_lp, 'a', v_la, 'i', v_li);
  else
    return query select v_items, null::jsonb;
  end if;
end;
$$;

comment on function public.api_list_collection_items(uuid, jsonb, integer) is
  '收藏夹条目游标分页（position asc, added_at desc, photo_id desc）。不可见时返回零行。';

-- ============================================================================
-- §6 用户注销：补上草稿与收藏夹的清理
--     0022 的 api_delete_own_account 走的是「匿名化 + 保留作品行」，
--     不会触发 auth.users 的 on delete cascade，所以必须在这里显式删。
--     签名与返回类型不变，但按仓库惯例仍然先 drop 再 create（回放最稳）。
-- ============================================================================

drop function if exists public.api_delete_own_account(text, text, text);
create function public.api_delete_own_account(p_reason text, p_ip_hash text, p_user_agent text)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_username text;
  v_deleted_at timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  select username::text into v_username
    from public.profiles where id=v_uid and deleted_at is null for update;
  if v_username is null then raise exception 'PROFILE_NOT_FOUND' using errcode='P0002'; end if;

  insert into public.account_deletion_events(user_id, username_snapshot, reason, ip_hash, user_agent)
  values(v_uid, v_username, left(coalesce(p_reason,''),500), left(p_ip_hash,128), left(p_user_agent,512));

  update public.security_sessions set revoked_at=v_deleted_at, revoke_reason='admin'
   where user_id=v_uid and revoked_at is null;
  delete from public.likes where user_id=v_uid;
  delete from public.favorites where user_id=v_uid;

  -- 0022：关注关系（双向）与通知（收件箱 + 我作为触发者的痕迹）
  delete from public.follows where follower_id=v_uid or followee_id=v_uid;
  delete from public.notifications where user_id=v_uid or actor_id=v_uid;

  -- 0028：服务端草稿与收藏夹。
  -- 注销是匿名化而不是删行，on delete cascade 永远不会触发，这里必须显式删；
  -- collection_items 由 FK 级联带走。
  delete from public.publish_drafts where user_id = v_uid;
  delete from public.collections where owner_id = v_uid;

  update public.comments
     set body='[账号已注销]', status='removed', deleted_at=coalesce(deleted_at,v_deleted_at)
   where author_id=v_uid;
  update public.photos
     set title='已注销用户作品', description='', tags='{}', location_name='',
         location_lat=null, location_lng=null, location_precision='hidden', shot_at=null, exif=null,
         credit=null, status='removed', deleted_at=coalesce(deleted_at,v_deleted_at)
   where author_id=v_uid;
  update public.articles
     set title='已注销用户文章', summary='', body_md='', cover_key=null, tags='{}', equipment='{}',
         related_photo_ids='{}', status='draft', published_at=null
   where author_id=v_uid;
  update public.profiles
     set username=('del_' || left(replace(v_uid::text,'-',''),16))::citext,
         display_name='已注销用户', avatar_key=null, bio='', links='[]'::jsonb,
         visibility='private', show_likes=false, show_favorites=false, discoverable=false,
         notification_preferences='{"accountSecurity":false,"productUpdates":false}'::jsonb,
         phone=null, phone_verified_at=null, deleted_at=v_deleted_at
   where id=v_uid;
  update auth.users
     set phone=null, email=null, password_hash=null, raw_user_meta_data='{}'::jsonb
    where id=v_uid;
end
$$;

comment on function public.api_delete_own_account(text, text, text) is
  '注销当前账号（匿名化）+ 清理会话/互动/关注/通知/草稿/收藏夹。';

-- ============================================================================
-- §7 函数授权：先 revoke 到底，再只给 app_user 最小可执行集
--     drop function 会连带丢掉旧授权，所以 grant 必须写在 create 之后。
-- ============================================================================

-- 内部触发器函数不给任何业务角色
revoke all on function public.touch_collection_updated_at() from public, app_user;

revoke all on function public.api_get_publish_draft() from public, app_user;
grant execute on function public.api_get_publish_draft() to app_user;

revoke all on function public.api_save_publish_draft(jsonb) from public, app_user;
grant execute on function public.api_save_publish_draft(jsonb) to app_user;

revoke all on function public.api_delete_publish_draft() from public, app_user;
grant execute on function public.api_delete_publish_draft() to app_user;

revoke all on function public.api_list_collections(text, boolean) from public, app_user;
grant execute on function public.api_list_collections(text, boolean) to app_user;

revoke all on function public.api_get_collection(uuid) from public, app_user;
grant execute on function public.api_get_collection(uuid) to app_user;

revoke all on function public.api_create_collection(text, text, text) from public, app_user;
grant execute on function public.api_create_collection(text, text, text) to app_user;

revoke all on function public.api_update_collection(uuid, text, text, text) from public, app_user;
grant execute on function public.api_update_collection(uuid, text, text, text) to app_user;

revoke all on function public.api_delete_collection(uuid) from public, app_user;
grant execute on function public.api_delete_collection(uuid) to app_user;

revoke all on function public.api_add_collection_item(uuid, uuid) from public, app_user;
grant execute on function public.api_add_collection_item(uuid, uuid) to app_user;

revoke all on function public.api_remove_collection_item(uuid, uuid) from public, app_user;
grant execute on function public.api_remove_collection_item(uuid, uuid) to app_user;

revoke all on function public.api_list_collection_items(uuid, jsonb, integer) from public, app_user;
grant execute on function public.api_list_collection_items(uuid, jsonb, integer) to app_user;

-- 0022 重建过的注销函数（本节 drop+create 之后必须重新下发）
revoke all on function public.api_delete_own_account(text, text, text) from public, app_user;
grant execute on function public.api_delete_own_account(text, text, text) to app_user;

-- ============================================================================
-- §8 自检：迁移必须把安全边界真正落地（任何一条不成立就让迁移失败）
-- ============================================================================

do $$
declare
  v_table text;
  v_priv text;
  v_expected text[] := array[
    'api_get_publish_draft',
    'api_save_publish_draft',
    'api_delete_publish_draft',
    'api_list_collections',
    'api_get_collection',
    'api_create_collection',
    'api_update_collection',
    'api_delete_collection',
    'api_add_collection_item',
    'api_remove_collection_item',
    'api_list_collection_items',
    'api_delete_own_account'
  ];
  r record;
begin
  -- 8.1 三张新表：RLS 开、无 policy、app_user 无任何表级权限
  foreach v_table in array array['publish_drafts', 'collections', 'collection_items'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || v_table)::regclass) then
      raise exception '0028 自检失败：% 未启用 row level security', v_table;
    end if;

    if exists (
      select 1 from pg_policies p
       where p.schemaname = 'public' and p.tablename = v_table
    ) then
      raise exception '0028 自检失败：% 不该有 policy（本表只允许走 definer 函数）', v_table;
    end if;

    foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege('app_user', 'public.' || v_table, v_priv) then
        raise exception '0028 自检失败：app_user 仍持有 %.% 权限', v_table, v_priv;
      end if;
    end loop;
  end loop;

  -- 8.2 每个 API 函数：SECURITY DEFINER、固定 search_path、PUBLIC 不可执行、app_user 可执行
  for r in
    select p.oid, p.proname, p.prosecdef, coalesce(p.proconfig, array[]::text[]) as cfg
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any(v_expected)
  loop
    if not r.prosecdef then
      raise exception '0028 自检失败：% 不是 security definer', r.proname;
    end if;
    if not exists (select 1 from unnest(r.cfg) as c where c like 'search_path=%') then
      raise exception '0028 自检失败：% 没有固定 search_path', r.proname;
    end if;
    if has_function_privilege('public', r.oid, 'EXECUTE') then
      raise exception '0028 自检失败：PUBLIC 仍可执行 %', r.proname;
    end if;
    if not has_function_privilege('app_user', r.oid, 'EXECUTE') then
      raise exception '0028 自检失败：app_user 无法执行 %', r.proname;
    end if;
  end loop;

  -- 8.3 12 个函数一个都不能少（drop 失败/名字打错会在这里暴露）
  if (select count(*) from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any(v_expected)) <> array_length(v_expected, 1) then
    raise exception '0028 自检失败：API 函数数量不符（期望 % 个）', array_length(v_expected, 1);
  end if;

  -- 8.4 内部触发器函数不对 app_user 开放
  if has_function_privilege('app_user', 'public.touch_collection_updated_at()', 'EXECUTE') then
    raise exception '0028 自检失败：app_user 可执行内部触发器函数';
  end if;

  -- 8.5 关键约束在位（快照可能被手工改过）
  if not exists (select 1 from pg_constraint where conname = 'collections_visibility_check') then
    raise exception '0028 自检失败：collections_visibility_check 缺失';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'publish_drafts_payload_size') then
    raise exception '0028 自检失败：publish_drafts_payload_size 缺失';
  end if;

  raise notice 'OK: 0028 服务端草稿与收藏夹自检通过';
end
$$;
