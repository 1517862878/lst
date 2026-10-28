\encoding UTF8
-- ============================================================================
-- 工科影展 · 0022 社交关系闭环
--
-- 交付三件事：
--   1. public.follows        关注关系（主键二元组，禁止自关注）
--   2. public.notifications  通知中心（like / comment / follow / system）
--   3. api_feed              关注动态流（已发布作品，游标分页）
--
-- 安全模型（与 0015~0021 保持一致）：
--   * 两张新表 enable row level security，并且不建任何 policy；
--   * revoke all from public, app_user —— 表级权限一并收回，
--     因此即便 RLS 被绕过，app_user 也无法直接 select/insert/update/delete；
--   * 只经 SECURITY DEFINER 函数访问（固定 search_path = pg_catalog, public），
--     函数内部一律 auth.uid() 取当前用户，不接受调用方传入的 user_id。
--
-- 幂等：本迁移是 append-only 的，可重复执行。
--   * 表/列/索引都走 if not exists；
--   * 约束用 pg_constraint 存在性判断后再 add；
--   * 函数先 drop function 再 create（便于后续改返回类型），触发函数用
--     create or replace（触发器依赖它们，drop 会失败）；
--   * 重新下发 revoke / grant（drop function 会丢掉旧授权）。
--
-- 分页约定：对外 limit 上限 50；SQL 侧钳到 51 —— 仓库层多取一行用于判断
-- hasMore（与 /api/photos、/api/comments 的 limit+1 探测一致），切片在仓库层做。
-- ============================================================================

-- ============================================================================
-- 1. public.follows
--    主键 (follower_id, followee_id) 天然保证关注幂等：重复关注 = on conflict。
--    ck_follows_no_self 在数据库层禁止自关注（api_follow 里还会再拦一次，
--    以便返回可读的 CANNOT_FOLLOW_SELF 业务错误而不是约束冲突）。
-- ============================================================================

create table if not exists public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint pk_follows primary key (follower_id, followee_id),
  constraint ck_follows_no_self check (follower_id <> followee_id)
);

alter table public.follows add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'pk_follows' and conrelid = 'public.follows'::regclass
  ) then
    alter table public.follows add constraint pk_follows primary key (follower_id, followee_id);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'ck_follows_no_self' and conrelid = 'public.follows'::regclass
  ) then
    alter table public.follows add constraint ck_follows_no_self check (follower_id <> followee_id);
  end if;
end;
$$;

-- 粉丝列表：按 followee 取，倒序（最新关注在前）；created_at 相同时用 follower_id 兜底，
-- 保证游标 (created_at, follower_id) 严格全序、翻页不丢不重。
create index if not exists idx_follows_followee_created
  on public.follows (followee_id, created_at desc, follower_id desc);

-- 我关注的人（关注列表 + 动态流 join 的驱动侧）。
create index if not exists idx_follows_follower_created
  on public.follows (follower_id, created_at desc, followee_id desc);

-- ============================================================================
-- 2. public.notifications
--    user_id = 收件人；actor_id = 触发者（system 通知为空）；
--    photo_id / comment_id 指向上下文对象，级联删除，避免悬挂引用。
-- ============================================================================

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null,
  actor_id   uuid references public.profiles (id) on delete set null,
  photo_id   uuid references public.photos (id) on delete cascade,
  comment_id uuid references public.comments (id) on delete cascade,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

alter table public.notifications add column if not exists kind text;
alter table public.notifications add column if not exists actor_id uuid;
alter table public.notifications add column if not exists photo_id uuid;
alter table public.notifications add column if not exists comment_id uuid;
alter table public.notifications add column if not exists read_at timestamptz;
alter table public.notifications add column if not exists created_at timestamptz not null default now();

-- kind 的取值约束只在这里统一加一次（上面建表时刻意不写 inline check）：
-- inline 写法会让 Postgres 自动命名成 notifications_kind_check，于是「新建库」会有
-- 两个一模一样的 check，「已存在的库」只有一个 —— 反复执行会漂移出不同的终态。
-- 这里顺手把早期自动命名的那一个删掉，让所有库收敛到同一个约束名。
alter table public.notifications drop constraint if exists notifications_kind_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'ck_notifications_kind' and conrelid = 'public.notifications'::regclass
  ) then
    alter table public.notifications
      add constraint ck_notifications_kind check (kind in ('like', 'comment', 'follow', 'system'));
  end if;
end;
$$;

-- 通知列表：user_id + created_at desc（游标再带 id 兜底全序）。
create index if not exists idx_notifications_user_created
  on public.notifications (user_id, created_at desc, id desc);

-- 未读数：部分索引，只索引未读行。
create index if not exists idx_notifications_user_unread
  on public.notifications (user_id)
  where read_at is null;

-- 通知列表要 join 触发者资料；actor 注销后 actor_id 置空，索引仍然有用。
create index if not exists idx_notifications_actor on public.notifications (actor_id);

-- ============================================================================
-- 3. 锁死两张新表：RLS + 表级权限
--    没有 policy 的 RLS 等价于“任何非 owner 角色一行都看不到”；
--    再 revoke 表级权限，双保险。app_user 只能通过下面的 SECURITY DEFINER 函数访问。
-- ============================================================================

alter table public.follows enable row level security;
alter table public.notifications enable row level security;

revoke all on table public.follows from public;
revoke all on table public.follows from app_user;
revoke all on table public.notifications from public;
revoke all on table public.notifications from app_user;

-- ============================================================================
-- 4. profiles.follower_count / following_count
--    存成计数器列（读多写少，避免列表页 count(*) 扫全表），由触发器维护；
--    非负约束保证计数不会因为并发/异常路径变成负数。
-- ============================================================================

alter table public.profiles add column if not exists follower_count integer not null default 0;
alter table public.profiles add column if not exists following_count integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'ck_profiles_follower_count' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint ck_profiles_follower_count check (follower_count >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'ck_profiles_following_count' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint ck_profiles_following_count check (following_count >= 0);
  end if;
end;
$$;

-- 全量对账：把计数列修正为 follows 的真实值。
-- 迁移可重复执行，所以每次都用真值回填，顺便修复历史上可能的漂移。
update public.profiles p
   set follower_count = (
         select count(*)::integer from public.follows f where f.followee_id = p.id
       ),
       following_count = (
         select count(*)::integer from public.follows f where f.follower_id = p.id
       )
 where p.follower_count <> (
         select count(*)::integer from public.follows f where f.followee_id = p.id
       )
    or p.following_count <> (
         select count(*)::integer from public.follows f where f.follower_id = p.id
       );

-- 单行增量触发器函数：关注/取关时同步两侧计数。
-- 用 update ... where id = ... 而不是 update ... = count(*)，是为了避免
-- “读-改-写”丢更新；delete 后再 update 可能命中 0 行（本人资料已注销），
-- 所以不检查 rowcount。
create or replace function public.recount_follow_counts()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles
       set follower_count = follower_count + 1, updated_at = now()
     where id = new.followee_id;
    update public.profiles
       set following_count = following_count + 1, updated_at = now()
     where id = new.follower_id;
    return new;
  end if;

  -- DELETE / UPDATE 都按旧值回退
  update public.profiles
     set follower_count = greatest(follower_count - 1, 0), updated_at = now()
   where id = old.followee_id;
  update public.profiles
     set following_count = greatest(following_count - 1, 0), updated_at = now()
   where id = old.follower_id;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_follows_counts on public.follows;
create trigger trg_follows_counts
  after insert or delete on public.follows
  for each row execute function public.recount_follow_counts();

-- ============================================================================
-- 5. 通知触发器
--    likes / favorites / comments 插入 → 通知作品作者。
--    follows 插入 → 通知被关注者。
--    自操作（actor = 收件人）不发通知。
-- ============================================================================

create or replace function public.notify_from_interaction()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_kind text;
  v_photo_id uuid;
  v_comment_id uuid;
  v_recipient uuid;
  -- 触发者：likes/favorites 用 user_id，comments 用 author_id（列名不同，
  -- 所以必须按表分别取，不能直接写 new.user_id）。
  v_actor uuid;
begin
  if tg_table_name = 'likes' then
    v_kind := 'like';
    v_photo_id := new.photo_id;
    v_actor := new.user_id;
  elsif tg_table_name = 'favorites' then
    -- 收藏复用 like 类型：notifications.kind 只开放 like/comment/follow/system，
    -- 收藏在语义上属于“喜欢了我的作品”，因此不额外增加 kind 值。
    v_kind := 'like';
    v_photo_id := new.photo_id;
    v_actor := new.user_id;
  elsif tg_table_name = 'comments' then
    v_kind := 'comment';
    v_photo_id := new.photo_id;
    v_comment_id := new.id;
    v_actor := new.author_id;
  else
    return new;
  end if;

  select p.author_id into v_recipient
    from public.photos p
   where p.id = v_photo_id;

  -- 作品不存在 / 作者已注销 / 自己操作自己的作品 → 不产生通知
  if v_recipient is null or v_actor is null or v_recipient = v_actor then
    return new;
  end if;

  -- 作者已注销（profiles 里仍是同一行，只是 deleted_at 非空）也不打扰
  if not exists (
    select 1 from public.profiles pr where pr.id = v_recipient and pr.deleted_at is null
  ) then
    return new;
  end if;

  insert into public.notifications (user_id, kind, actor_id, photo_id, comment_id)
  values (v_recipient, v_kind, v_actor, v_photo_id, v_comment_id);

  return new;
end;
$$;

drop trigger if exists trg_notifications_likes on public.likes;
create trigger trg_notifications_likes
  after insert on public.likes
  for each row execute function public.notify_from_interaction();

drop trigger if exists trg_notifications_favorites on public.favorites;
create trigger trg_notifications_favorites
  after insert on public.favorites
  for each row execute function public.notify_from_interaction();

drop trigger if exists trg_notifications_comments on public.comments;
create trigger trg_notifications_comments
  after insert on public.comments
  for each row execute function public.notify_from_interaction();

create or replace function public.notify_from_follow()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  -- 自关注已被 ck_follows_no_self 拦住，这里再防一层。
  if new.follower_id = new.followee_id then
    return new;
  end if;

  if not exists (
    select 1 from public.profiles pr where pr.id = new.followee_id and pr.deleted_at is null
  ) then
    return new;
  end if;

  insert into public.notifications (user_id, kind, actor_id)
  values (new.followee_id, 'follow', new.follower_id);

  return new;
end;
$$;

drop trigger if exists trg_follows_notify on public.follows;
create trigger trg_follows_notify
  after insert on public.follows
  for each row execute function public.notify_from_follow();

-- ============================================================================
-- 6. 内部辅助：按 username 解析“可见的目标资料”
--    可见性语义与 0018 的 api_get_profile_by_username 完全一致：
--      * 公开资料：任何人可解析；
--      * 私密资料：只有本人可解析。
--    不可见 / 不存在统一抛 PROFILE_NOT_FOUND(P0002)，避免探测账号是否存在。
--    仅内部使用（revoke from app_user），不对外暴露。
-- ============================================================================

drop function if exists public.social_target_profile(text);
create function public.social_target_profile(p_username text)
returns table (profile_id uuid, profile_username text, profile_visibility text)
language sql security definer stable
set search_path = pg_catalog, public
as $$
  select p.id, p.username::text, p.visibility
    from public.profiles p
   where lower(p.username::text) = lower(btrim(coalesce(p_username, '')))
     and p.deleted_at is null
     and (p.visibility = 'public' or p.id = auth.uid())
   limit 1
$$;

-- 解析关注目标：关注/取关不受 visibility 限制。
-- 需求明确“关注不改变私密可见性”，也就没有“申请关注”流程：
--   关注一个私密账号不会看到它任何内容（关注列表 / 粉丝列表 / 动态流依旧按
--   可见性过滤），只是建立了有向边，对方可见时立即生效。
-- 不按 visibility 过滤是必要的：解析结果里带了 username，而 **不可见** 与
-- **不存在** 在 0018 里必须是同一种错误，否则可以拿它探测私密账号是否存在。
drop function if exists public.social_follow_target(text);
create function public.social_follow_target(p_username text)
returns table (profile_id uuid, profile_username text)
language sql security definer stable
set search_path = pg_catalog, public
as $$
  select p.id, p.username::text
    from public.profiles p
   where lower(p.username::text) = lower(btrim(coalesce(p_username, '')))
     and p.deleted_at is null
   limit 1
$$;

-- ============================================================================
-- 7. 关注关系 API
-- ============================================================================

-- api_follow：幂等关注。返回关注后的状态与双方最新计数，前端可一次性刷新按钮。
drop function if exists public.api_follow(text);
create function public.api_follow(p_username text)
returns table (is_following boolean, target_follower_count integer, viewer_following_count integer)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_target_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select t.profile_id into v_target_id from public.social_follow_target(p_username) t;
  if v_target_id is null then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 自关注：主键二元组本身允许 (x,x)，靠约束 + 这里显式拒绝
  if v_target_id = v_uid then
    raise exception 'CANNOT_FOLLOW_SELF' using errcode = '22023';
  end if;

  insert into public.follows (follower_id, followee_id)
  values (v_uid, v_target_id)
  on conflict (follower_id, followee_id) do nothing;

  return query
    select true,
           (select count(*)::integer from public.follows f where f.followee_id = v_target_id),
           (select count(*)::integer from public.follows f where f.follower_id = v_uid);
end;
$$;

-- api_unfollow：幂等取关（没关注也返回成功，不报错）。
drop function if exists public.api_unfollow(text);
create function public.api_unfollow(p_username text)
returns table (is_following boolean, target_follower_count integer, viewer_following_count integer)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_target_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select t.profile_id into v_target_id from public.social_follow_target(p_username) t;
  if v_target_id is null then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_target_id = v_uid then
    raise exception 'CANNOT_FOLLOW_SELF' using errcode = '22023';
  end if;

  delete from public.follows f
   where f.follower_id = v_uid and f.followee_id = v_target_id;

  return query
    select false,
           (select count(*)::integer from public.follows f where f.followee_id = v_target_id),
           (select count(*)::integer from public.follows f where f.follower_id = v_uid);
end;
$$;

-- api_is_following：查询“我是否关注了他”。
-- 游客（auth.uid() 为空）返回 false，不抛错——作品详情页对未登录用户也要能渲染。
-- 这里刻意只在“关注状态”上回答，不泄露目标资料任何字段，所以不受 visibility 限制。
drop function if exists public.api_is_following(text);
create function public.api_is_following(p_username text)
returns table (is_following boolean)
language plpgsql security definer stable
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_target_id uuid;
begin
  select t.profile_id into v_target_id from public.social_follow_target(p_username) t;
  if v_target_id is null then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
    select exists (
      select 1 from public.follows f
       where f.follower_id = v_uid and f.followee_id = v_target_id
    );
end;
$$;

-- api_follow_counts：资料页展示的关注/粉丝数。
-- 走 visibility 过滤（私密账号的社交图谱不外泄），所以这里用 social_target_profile。
drop function if exists public.api_follow_counts(text);
create function public.api_follow_counts(p_username text)
returns table (follower_count integer, following_count integer)
language plpgsql security definer stable
set search_path = pg_catalog, public
as $$
declare
  v_target_id uuid;
begin
  select t.profile_id into v_target_id from public.social_target_profile(p_username) t;
  if v_target_id is null then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
    select p.follower_count, p.following_count
      from public.profiles p
     where p.id = v_target_id;
end;
$$;

-- api_list_followers / api_list_following：游标分页，最新在前。
-- 同一份资料卡字段，避免前端为两个列表写两套渲染。
-- is_following = “当前登录用户是否关注了这一行的用户”，用于列表里的关注按钮回填。
--
-- 资料卡的字段集与 0018 的 api_get_own_profile 收敛为同一份投影
-- （id/username/display_name/avatar_key/bio/role/links/license_preference/时间戳），
-- 前端拿到的就是它 domain 里的 Profile，不需要为列表再造一个精简类型。
-- 为什么这里给出 profiles.id（而 api_get_profile_by_username 明确不给）：
--   * 关系列表是「同一个对象的多行」，前端用 id 作 React key 与去重键；
--     缺了 id 会让列表退化成按下标复用节点（同一行换人时不重挂载）。
--   * 0015/0018 关掉的是「按 UUID 读资料的旁路」——即拿 id 当查询键。
--     本项目没有任何以 profile UUID 为入参的接口，所以给出 id 不打开新的读取路径。
--   * phone / phone_verified_at 无论如何都不出现在这条投影里（见 repositories/social.ts
--     统一走 lib/mappers 的 mapPublicProfile）。
--
-- 游标键仍然用 (created_at, username) 而不是 (created_at, id)：
--   * 用户名唯一 ⇒ 二元组仍是严格全序，同一秒内的并列也能稳定翻页；
--   * 游标是 base64(JSON) 明文，放用户名（公开字段）比放内部 id 更不容易被当成稳定标识去依赖。
drop function if exists public.api_list_followers(text, integer, timestamptz, uuid);
drop function if exists public.api_list_followers(text, integer, timestamptz, text);
create function public.api_list_followers(
  p_username text,
  p_limit integer default 20,
  p_cursor_at timestamptz default null,
  p_cursor_key text default null
)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_key text,
  bio text,
  role text,
  links jsonb,
  license_preference text,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz,
  followed_at timestamptz,
  is_following boolean
)
language plpgsql security definer stable
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_target_id uuid;
begin
  select t.profile_id into v_target_id from public.social_target_profile(p_username) t;
  if v_target_id is null then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
    select f.id,
           f.username::text,
           f.display_name,
           f.avatar_key,
           f.bio,
           f.role,
           f.links,
           f.license_preference,
           f.created_at,
           f.updated_at,
           f.deleted_at,
           fo.created_at,
           exists (
             select 1 from public.follows x
              where x.follower_id = v_uid and x.followee_id = f.id
           )
      from public.follows fo
      join public.profiles f on f.id = fo.follower_id
     where fo.followee_id = v_target_id
       and f.deleted_at is null
       and (
         p_cursor_at is null or p_cursor_key is null
         or (fo.created_at, f.username::text) < (p_cursor_at, p_cursor_key)
       )
     order by fo.created_at desc, f.username desc
     limit least(greatest(coalesce(p_limit, 20), 1), 51);
end;
$$;

drop function if exists public.api_list_following(text, integer, timestamptz, uuid);
drop function if exists public.api_list_following(text, integer, timestamptz, text);
create function public.api_list_following(
  p_username text,
  p_limit integer default 20,
  p_cursor_at timestamptz default null,
  p_cursor_key text default null
)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_key text,
  bio text,
  role text,
  links jsonb,
  license_preference text,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz,
  followed_at timestamptz,
  is_following boolean
)
language plpgsql security definer stable
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_target_id uuid;
begin
  select t.profile_id into v_target_id from public.social_target_profile(p_username) t;
  if v_target_id is null then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  return query
    select f.id,
           f.username::text,
           f.display_name,
           f.avatar_key,
           f.bio,
           f.role,
           f.links,
           f.license_preference,
           f.created_at,
           f.updated_at,
           f.deleted_at,
           fo.created_at,
           exists (
             select 1 from public.follows x
              where x.follower_id = v_uid and x.followee_id = f.id
           )
      from public.follows fo
      join public.profiles f on f.id = fo.followee_id
     where fo.follower_id = v_target_id
       and f.deleted_at is null
       and (
         p_cursor_at is null or p_cursor_key is null
         or (fo.created_at, f.username::text) < (p_cursor_at, p_cursor_key)
       )
     order by fo.created_at desc, f.username desc
     limit least(greatest(coalesce(p_limit, 20), 1), 51);
end;
$$;

-- ============================================================================
-- 8. api_feed：关注动态流
--    * 只含我关注的人（不含自己；自己的作品在“我的作品”里）；
--    * 只含 status='published' and deleted_at is null；
--    * 游标 (published_at, id)，与 /api/photos 同一套排序键与编码；
--    * 函数是 SECURITY DEFINER，会绕过 photos 的 RLS，所以可见性在这里显式重申：
--      published + 未删除 + 作者未注销。私密（visibility='private'）账号的
--      已发布作品在现有 RLS 下本来就是公开可读的，本迁移不改变这一点
--      —— “关注不改变私密可见性”指的就是订阅关系不额外解锁任何东西。
-- ============================================================================

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
           p.like_count, p.favorite_count, p.comment_count, p.view_count,
           p.published_at, p.created_at, p.updated_at, p.deleted_at,
           a.username::text, a.display_name, a.avatar_key
      from public.follows f
      join public.photos p on p.author_id = f.followee_id
      join public.profiles a on a.id = p.author_id
     where f.follower_id = v_uid
       and p.status = 'published'
       and p.deleted_at is null
       and a.deleted_at is null
       and (
         p_cursor_at is null or p_cursor_id is null
         or (p.published_at, p.id) < (p_cursor_at, p_cursor_id)
       )
     order by p.published_at desc, p.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 51);
end;
$$;

-- ============================================================================
-- 9. 通知中心 API
-- ============================================================================

-- api_notifications_unread_count：只读自己的行。
drop function if exists public.api_notifications_unread_count();
create function public.api_notifications_unread_count()
returns table (unread_count integer)
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
    select count(*)::integer
      from public.notifications n
     where n.user_id = v_uid and n.read_at is null;
end;
$$;

-- api_list_notifications：游标分页，最新在前。
-- 触发者/作品/评论的展示字段在读取时才 join，并且重新过一遍可见性：
--   * 作品被下架（非 published）或作者注销 → 不返回标题与缩略图；
--   * 评论被隐藏/删除 → 不返回摘要。
-- 这样“通知里能看到的内容”和“页面里能看到的内容”永远一致。
--
-- actor 直接内联成一份完整资料投影（actor_* 列），而不是只回 actor_id 让前端再查：
-- 前端的 AppNotification.actor 就是一个 Profile|null 对象，列表页因此不需要
-- 按 actor_id 批量回查用户（避免 N+1），也不会出现“通知有了、作者还没请求回来”
-- 的中间态。字段集与 api_get_own_profile / 关注列表保持同一份公开投影，
-- phone 类字段不在其中。
drop function if exists public.api_list_notifications(integer, timestamptz, uuid);
create function public.api_list_notifications(
  p_limit integer default 20,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid,
  kind text,
  actor_id uuid,
  actor_username text,
  actor_display_name text,
  actor_avatar_key text,
  actor_bio text,
  actor_role text,
  actor_links jsonb,
  actor_license_preference text,
  actor_created_at timestamptz,
  actor_updated_at timestamptz,
  actor_deleted_at timestamptz,
  photo_id uuid,
  photo_title text,
  photo_thumb_key text,
  comment_id uuid,
  comment_excerpt text,
  read_at timestamptz,
  created_at timestamptz
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
    with page as (
      select n.id, n.kind, n.actor_id, n.photo_id, n.comment_id, n.read_at, n.created_at
        from public.notifications n
       where n.user_id = v_uid
         and (
           p_cursor_at is null or p_cursor_id is null
           or (n.created_at, n.id) < (p_cursor_at, p_cursor_id)
         )
       order by n.created_at desc, n.id desc
       limit least(greatest(coalesce(p_limit, 20), 1), 51)
    )
    select pg.id,
           pg.kind,
           actor.id,
           actor.username::text,
           actor.display_name,
           actor.avatar_key,
           actor.bio,
           actor.role,
           actor.links,
           actor.license_preference,
           actor.created_at,
           actor.updated_at,
           actor.deleted_at,
           pg.photo_id,
           case
             when p.status = 'published' and p.deleted_at is null then p.title
             else null
           end,
           case
             when p.status = 'published' and p.deleted_at is null then p.thumb_key
             else null
           end,
           pg.comment_id,
           case
             when c.status = 'visible' and c.deleted_at is null then left(c.body, 80)
             else null
           end,
           pg.read_at,
           pg.created_at
      from page pg
      left join public.profiles actor on actor.id = pg.actor_id and actor.deleted_at is null
      left join public.photos p on p.id = pg.photo_id
      left join public.comments c on c.id = pg.comment_id
     order by pg.created_at desc, pg.id desc;
end;
$$;

-- api_mark_notifications_read：把 p_ids 里的通知标为已读；p_ids 为空表示全部已读。
-- 只能改自己的行（where user_id = v_uid），重复标记不会重复计数。
drop function if exists public.api_mark_notifications_read(uuid[]);
create function public.api_mark_notifications_read(p_ids uuid[] default null)
returns table (marked_count integer)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if p_ids is not null and array_length(p_ids, 1) > 200 then
    raise exception 'TOO_MANY_IDS' using errcode = '22023';
  end if;

  with changed as (
    update public.notifications n
       set read_at = now()
     where n.user_id = v_uid
       and n.read_at is null
       and (p_ids is null or n.id = any (p_ids))
    returning 1
  )
  select count(*)::integer into v_count from changed;

  return query select coalesce(v_count, 0);
end;
$$;

-- ============================================================================
-- 10. 注销清理（0018 的 api_delete_own_account 在本迁移重建）
--     在原逻辑之后补两件事：
--       a) 删除本人所有关注边（两个方向）→ 计数触发器自动把计数归零；
--       b) 删除本人收到的通知与本人触发的通知，避免注销后仍被 @/点赞打扰。
--     0018 的列清单、事件写入、会话吊销、作品/文章/评论匿名化逻辑保持原样。
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

-- ============================================================================
-- 11. 权限：先 revoke 再最小化 grant
--     内部函数（触发器函数、解析辅助函数）不对 app_user 开放。
-- ============================================================================

revoke all on function public.recount_follow_counts() from public, app_user;
revoke all on function public.notify_from_interaction() from public, app_user;
revoke all on function public.notify_from_follow() from public, app_user;
revoke all on function public.social_target_profile(text) from public, app_user;
revoke all on function public.social_follow_target(text) from public, app_user;

revoke all on function public.api_follow(text) from public, app_user;
grant execute on function public.api_follow(text) to app_user;

revoke all on function public.api_unfollow(text) from public, app_user;
grant execute on function public.api_unfollow(text) to app_user;

revoke all on function public.api_is_following(text) from public, app_user;
grant execute on function public.api_is_following(text) to app_user;

revoke all on function public.api_follow_counts(text) from public, app_user;
grant execute on function public.api_follow_counts(text) to app_user;

revoke all on function public.api_list_followers(text, integer, timestamptz, text) from public, app_user;
grant execute on function public.api_list_followers(text, integer, timestamptz, text) to app_user;

revoke all on function public.api_list_following(text, integer, timestamptz, text) from public, app_user;
grant execute on function public.api_list_following(text, integer, timestamptz, text) to app_user;

revoke all on function public.api_feed(integer, timestamptz, uuid) from public, app_user;
grant execute on function public.api_feed(integer, timestamptz, uuid) to app_user;

revoke all on function public.api_list_notifications(integer, timestamptz, uuid) from public, app_user;
grant execute on function public.api_list_notifications(integer, timestamptz, uuid) to app_user;

revoke all on function public.api_notifications_unread_count() from public, app_user;
grant execute on function public.api_notifications_unread_count() to app_user;

revoke all on function public.api_mark_notifications_read(uuid[]) from public, app_user;
grant execute on function public.api_mark_notifications_read(uuid[]) to app_user;

-- 0018 重建的函数授权（drop function 会一并丢掉旧授权，必须重新下发）
revoke all on function public.api_delete_own_account(text, text, text) from public, app_user;
grant execute on function public.api_delete_own_account(text, text, text) to app_user;

-- ============================================================================
-- 12. 自检：迁移必须把安全边界真正落地
-- ============================================================================

do $$
declare
  v_priv text;
begin
  -- 表级权限必须被彻底收回（RLS 之外的兜底）
  foreach v_priv in array array['select', 'insert', 'update', 'delete'] loop
    if has_table_privilege('app_user', 'public.follows', v_priv) then
      raise exception '0022 自检失败：app_user 拥有 follows 的 % 权限', v_priv;
    end if;
    if has_table_privilege('app_user', 'public.notifications', v_priv) then
      raise exception '0022 自检失败：app_user 拥有 notifications 的 % 权限', v_priv;
    end if;
  end loop;

  -- RLS 必须开启且没有放行 policy
  if not exists (
    select 1 from pg_class
     where oid = 'public.follows'::regclass and relrowsecurity
  ) then
    raise exception '0022 自检失败：follows 未开启 RLS';
  end if;
  if not exists (
    select 1 from pg_class
     where oid = 'public.notifications'::regclass and relrowsecurity
  ) then
    raise exception '0022 自检失败：notifications 未开启 RLS';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename in ('follows', 'notifications')
  ) then
    raise exception '0022 自检失败：follows/notifications 不应有 policy';
  end if;

  -- 公开 API 必须可用
  if not has_function_privilege('app_user', 'public.api_feed(integer, timestamptz, uuid)', 'execute')
     or not has_function_privilege('app_user', 'public.api_follow(text)', 'execute')
     or not has_function_privilege('app_user', 'public.api_mark_notifications_read(uuid[])', 'execute')
     or not has_function_privilege('app_user', 'public.api_list_notifications(integer, timestamptz, uuid)', 'execute') then
    raise exception '0022 自检失败：app_user 缺少社交 API 的执行权限';
  end if;

  -- 内部函数不得对外开放
  if has_function_privilege('app_user', 'public.social_target_profile(text)', 'execute')
     or has_function_privilege('app_user', 'public.notify_from_interaction()', 'execute') then
    raise exception '0022 自检失败：内部函数被开放给 app_user';
  end if;

  -- 计数列必须存在且非负
  if not exists (
    select 1 from pg_constraint
     where conname = 'ck_profiles_follower_count' and conrelid = 'public.profiles'::regclass
  ) or not exists (
    select 1 from pg_constraint
     where conname = 'ck_profiles_following_count' and conrelid = 'public.profiles'::regclass
  ) then
    raise exception '0022 自检失败：profiles 计数列缺少非负约束';
  end if;
end;
$$;
