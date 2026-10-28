\encoding UTF8
-- ============================================================================
-- 工科影展 · 0024 拉黑（blocks）+ 用户搜索
--
-- 契约：.tmp/phase2-remaining-freeze.md §1/§2（唯一依据）。本迁移交付：
--   1. public.blocks 有向拉黑表（RLS 开、无 policy、表级权限全部收回）；
--   2. 拉黑读写 API：api_block_user / api_unblock_user / api_list_blocks / api_count_blocks；
--   3. 用户搜索：api_search_users / api_count_search_users
--      （搜索是单页返回，`total` 由同样过滤条件的计数函数给出）；
--   4. 既有函数加拉黑过滤，全部 create or replace、**签名与返回类型保持不变**：
--        notify_from_interaction / notify_from_follow —— 四条通知触发器早退；
--        api_follow                                  —— 互相不能关注（403）；
--        api_list_followers / api_list_following      —— 社交图谱互相排除；
--        api_feed                                    —— 动态流互相排除；
--        api_set_like / api_set_favorite / api_create_comment
--                                                    —— 不能与对方作品互动（403）；
--        api_list_profile_interactions                —— 公开喜欢/收藏互相不可见；
--   5. api_get_profile_by_username 增加 is_blocked 列 +「被对方拉黑即 P0002」。
--      它要加一列，table 行型变了 ⇒ create or replace 不适用，只能 drop + create
--      （0018 里已有同样的先例与注释），drop 会丢授权，所以下面重新 grant。
--
-- 拉黑语义（契约 §1，就按这个实现，不要发明）：
--   * 有向存储、对称生效；建立拉黑时删两人之间**双向** follows（计数由 0022 的
--     trg_follows_counts 维护，本迁移不手写计数）；
--   * 生效期间：互相不能关注 / 点赞 / 收藏 / 评论；不为对方产生任何通知；
--     被拉黑方向看资料是 404（与「用户不存在」不可区分）；followers / following /
--     feed / 用户搜索互相排除；已有点赞收藏评论**保留**，但对方主页的公开喜欢/收藏
--     列表互相不可见；
--   * 解除拉黑后一切恢复，不恢复被删除的关注关系。
--
-- 方向约定（实现里反复用到，这里先说清楚）：
--   「被拉黑方向」= 访问者被目标拉黑（blocks.blocker_id = 目标, blocked_id = 访问者）
--     ⇒ 资料 404 —— 访问者不该知道「这个账号存在但拉黑了我」；
--   「拉黑方向」= 访问者拉黑了目标（blocks.blocker_id = 访问者, blocked_id = 目标）
--     ⇒ 资料仍是 200 + is_blocked=true —— 拉黑是自己做的动作，主页要能显示
--        「你已拉黑该用户」并能就地解除；但对方的社交图谱与互动列表对访问者不可见。
--
-- 幂等（契约 §0.1）：本迁移可重复执行。
--   * 表 / 列 / 索引走 if not exists，约束用 pg_constraint 存在性判断后再 add；
--   * 新函数 drop function if exists + create function（drop 后必须重发 grant）；
--   * 既有函数一律 create or replace（触发器依赖它们，drop 会连触发器一起带走）。
--
-- 错误码约定（与 0014 / 0018 / 0022 / 0023 一致，供 server/src/lib/errors.ts 翻译）：
--   P0002 → 404 NOT_FOUND；42501 → 403 FORBIDDEN；23514 → 400；22023 → 400。
--   本迁移的「拉黑阻断」抛 42501，消息以 BLOCKED_BY_RELATION: 前缀标记：
--   服务端据此把**业务文案原样透出**（「对方不可关注」这种可操作的原因要能显示给
--   用户），而 RLS 自己抛的 42501 样板文案仍折叠成统一兜底文案。
--   标记常量与解析逻辑见 server/src/lib/errors.ts 的 translateDbError。
-- ============================================================================

-- ============================================================================
-- 1. public.blocks
--    主键 (blocker_id, blocked_id) 天然幂等：重复拉黑 = on conflict do nothing。
--    ck_blocks_no_self 在数据库层禁止自拉黑（api_block_user 里还会再拦一次，
--    以便返回可读的 CANNOT_BLOCK_SELF 而不是裸的约束冲突）。
--    两条索引对应两种真实查询：
--      * idx_blocks_blocker_created ——「我拉黑了谁」倒序游标分页（也是 PK 之外的排序键）；
--      * idx_blocks_blocked         ——「谁拉黑了我」的反查（资料 P0002、写操作阻断、
--        通知触发器早退都要按 blocked_id 找）。
-- ============================================================================

create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint pk_blocks primary key (blocker_id, blocked_id),
  constraint ck_blocks_no_self check (blocker_id <> blocked_id)
);

alter table public.blocks add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'pk_blocks' and conrelid = 'public.blocks'::regclass
  ) then
    alter table public.blocks add constraint pk_blocks primary key (blocker_id, blocked_id);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'ck_blocks_no_self' and conrelid = 'public.blocks'::regclass
  ) then
    alter table public.blocks add constraint ck_blocks_no_self check (blocker_id <> blocked_id);
  end if;
end;
$$;

create index if not exists idx_blocks_blocker_created
  on public.blocks (blocker_id, created_at desc, blocked_id desc);
create index if not exists idx_blocks_blocked
  on public.blocks (blocked_id, blocker_id);

alter table public.blocks enable row level security;

-- 与 follows / notifications 同一套边界：表级权限一并收回，因此即便 RLS 被绕过，
-- app_user 也无法直接 select/insert/update/delete，只能经下面的 definer 函数。
revoke all on table public.blocks from public;
revoke all on table public.blocks from app_user;

-- ============================================================================
-- 2. 内部辅助：两个用户之间是否存在任一方向的拉黑
--    特意做成一个函数而不是到处写 exists(... or ...)：
--      * 五处判断（资料、关注、动态流、写操作、搜索）必须是同一条规则，
--        写五遍迟早会漂移一个方向；
--      * p_a / p_b 任一为 null（匿名访问者）时比较结果全为 null ⇒ 返回 false，
--        这正是「游客不受拉黑影响」想要的语义，调用方不必再判 null。
--    仅内部使用：revoke from app_user，不对外暴露（definer 函数内部调用不受影响，
--    那是以属主身份执行的）。
-- ============================================================================

drop function if exists public.blocks_between(uuid, uuid);
create function public.blocks_between(p_a uuid, p_b uuid)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.blocks b
     where (b.blocker_id = p_a and b.blocked_id = p_b)
        or (b.blocker_id = p_b and b.blocked_id = p_a)
  )
$$;

comment on function public.blocks_between(uuid, uuid) is
  '任一方向拉黑判定（匿名/任一侧为 null ⇒ false）；仅内部使用，不对 app_user 开放';

-- ============================================================================
-- 3. 拉黑 API
--
--    这一组函数的第一个参数是 p_blocker_id（契约固定的签名）：身份由路由层从
--    会话（JWT → withRls 事务级 app.user_id）取出后显式传入。为了让「传错人」
--    不可能悄悄成功，函数里加一道自证：登录态下 auth.uid() 必须等于 p_blocker_id。
--    匿名调用（auth.uid() 为空）不触发这道检查 —— 保持这些函数在运维/测试脚本里
--    以属主身份直调时可用（对外的 HTTP 入口一律 requireUser，见 routes/social.ts）。
-- ============================================================================

drop function if exists public.api_block_user(uuid, citext);
create function public.api_block_user(p_blocker_id uuid, p_blocked_username citext)
returns table (blocked boolean, removed_follows integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_target_id uuid;
  v_removed integer := 0;
begin
  if p_blocker_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if auth.uid() is not null and auth.uid() <> p_blocker_id then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- 目标必须存在且未注销：已注销账号的用户名已被改写成 del_xxx，
  -- 因此「已注销」在语义上就等于「不存在」。
  select p.id into v_target_id
    from public.profiles p
   where lower(p.username::text) = lower(btrim(coalesce(p_blocked_username::text, '')))
     and p.deleted_at is null
   limit 1;

  if v_target_id is null then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_target_id = p_blocker_id then
    raise exception 'CANNOT_BLOCK_SELF' using errcode = '23514';
  end if;

  -- 幂等：重复拉黑不报错、不刷新 created_at（列表排序保持首次拉黑时间）。
  insert into public.blocks (blocker_id, blocked_id)
  values (p_blocker_id, v_target_id)
  on conflict (blocker_id, blocked_id) do nothing;

  -- 契约 §1：建立拉黑时删两人之间**双向**的 follows。
  -- 计数交给 0022 的 trg_follows_counts（after delete 触发器），这里不手写：
  -- 手写就等于把计数规则复制一份，迟早与触发器漂移。
  delete from public.follows f
   where (f.follower_id = p_blocker_id and f.followee_id = v_target_id)
      or (f.follower_id = v_target_id and f.followee_id = p_blocker_id);
  get diagnostics v_removed = row_count;

  return query select true, v_removed;
end;
$$;

comment on function public.api_block_user(uuid, citext) is
  '拉黑（幂等）：写 blocks + 删双向 follows，返回删除的关注条数；目标不存在 P0002，自拉黑 23514';

drop function if exists public.api_unblock_user(uuid, citext);
create function public.api_unblock_user(p_blocker_id uuid, p_blocked_username citext)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_target_id uuid;
  v_removed integer := 0;
begin
  if p_blocker_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if auth.uid() is not null and auth.uid() <> p_blocker_id then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select p.id into v_target_id
    from public.profiles p
   where lower(p.username::text) = lower(btrim(coalesce(p_blocked_username::text, '')))
     and p.deleted_at is null
   limit 1;

  if v_target_id is null then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  delete from public.blocks b
   where b.blocker_id = p_blocker_id and b.blocked_id = v_target_id;
  get diagnostics v_removed = row_count;

  -- 没拉黑过也返回 false，不报错（契约 §2：未拉黑时返回 false）。
  -- 解除拉黑不恢复被删的关注关系（契约 §1），所以这里只删 blocks 一张表。
  return v_removed > 0;
end;
$$;

comment on function public.api_unblock_user(uuid, citext) is
  '解除拉黑（幂等）：没拉黑过返回 false 而不是报错；不恢复已删除的关注关系';

-- 我拉黑的用户列表：游标键 (created_at, blocked_id) 倒序，与 0022 的列表同一套排序键。
-- 返回 blocked_id 是为了服务端能编出下一页游标；它对客户端不可见
-- （路由响应的 BlockedUser 里没有 id 字段，仓库层显式白名单映射）。
-- 已注销账号不进列表（与 followers/following 的 deleted_at is null 一致），
-- api_count_blocks 用同样的过滤条件，保证 total 与列表一致。
drop function if exists public.api_list_blocks(uuid, integer, timestamptz, uuid);
create function public.api_list_blocks(
  p_blocker_id uuid,
  p_limit integer default 20,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (
  username citext,
  display_name text,
  avatar_key text,
  bio text,
  blocked_at timestamptz,
  blocked_id uuid
)
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select p.username,
         p.display_name,
         p.avatar_key,
         p.bio,
         b.created_at,
         b.blocked_id
    from public.blocks b
    join public.profiles p on p.id = b.blocked_id
   where b.blocker_id = p_blocker_id
     and p.deleted_at is null
     and (
       p_cursor_created_at is null or p_cursor_id is null
       or (b.created_at, b.blocked_id) < (p_cursor_created_at, p_cursor_id)
     )
   order by b.created_at desc, b.blocked_id desc
   limit least(greatest(coalesce(p_limit, 20), 1), 51);
$$;

comment on function public.api_list_blocks(uuid, integer, timestamptz, uuid) is
  '我拉黑的用户（最新在前，游标 (created_at, blocked_id)）；只返回公开资料投影 + blocked_id';

-- 契约 §3 的响应形状要求 { items, total, nextCursor }，而 api_list_blocks 的
-- 返回列是契约固定死的（不得加 total 列），所以 total 单独给一个计数函数：
-- 过滤条件必须与 api_list_blocks 完全一致，否则会出现「total=3 但列表只有 2 行」。
drop function if exists public.api_count_blocks(uuid);
create function public.api_count_blocks(p_blocker_id uuid)
returns integer
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select count(*)::integer
    from public.blocks b
    join public.profiles p on p.id = b.blocked_id
   where b.blocker_id = p_blocker_id
     and p.deleted_at is null
$$;

comment on function public.api_count_blocks(uuid) is
  '我拉黑的用户总数（过滤条件与 api_list_blocks 一致，供分页响应的 total 用）';

-- ============================================================================
-- 4. 用户搜索
--
--    契约 §2 的规则逐条落在下面的 where / order by 里：
--      * 关键词 btrim 后长度 1–30，否则返回空集（不报错：搜索框清空不是错误输入）；
--      * username ilike 或 display_name ilike 的「包含」匹配；
--      * 排序：前缀命中优先 → follower_count desc → username asc；
--      * 排除：未 discoverable、已注销、与 p_viewer_id 任一方向拉黑
--        （p_viewer_id 为 null ⇒ 只排除前两项，游客照常能搜）；
--      * p_limit 夹到 1–50。
--
--    两点实现选择（契约没写死，但不能默默做错）：
--      1) LIKE 元字符转义：把 \ % _ 按字面匹配。不转义的话搜 "%" 会命中全站用户，
--         而前端 mock 侧是 includes() 的子串匹配 —— 两边语义必须一致。
--      2) 前缀排序也比较 username/display_name 的前缀（而非只排 username）：
--         「前缀命中优先」在昵称搜索时才有意义，用户名搜索时两种排序结果相同。
-- ============================================================================

drop function if exists public.api_search_users(uuid, text, integer);
create function public.api_search_users(
  p_viewer_id uuid,
  p_query text,
  p_limit integer default 20
)
returns table (
  username citext,
  display_name text,
  avatar_key text,
  bio text,
  follower_count integer,
  is_following boolean
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_raw text := btrim(coalesce(p_query, ''));
  v_escaped text;
  v_like text;
  v_prefix text;
  v_limit integer;
begin
  if length(v_raw) < 1 or length(v_raw) > 30 then
    return;
  end if;

  -- 先转义反斜杠，再转义 % 和 _（顺序不能反，否则会把刚加上的反斜杠再转义一次）。
  v_escaped := replace(replace(replace(v_raw, '\', '\\'), '%', '\%'), '_', '\_');
  v_like := '%' || v_escaped || '%';
  v_prefix := v_escaped || '%';
  v_limit := least(greatest(coalesce(p_limit, 20), 1), 50);

  return query
    select p.username,
           p.display_name,
           p.avatar_key,
           p.bio,
           p.follower_count,
           exists (
             select 1 from public.follows f
              where f.follower_id = p_viewer_id and f.followee_id = p.id
           )
      from public.profiles p
     where p.deleted_at is null
       and p.discoverable
       and (p.username ilike v_like or p.display_name ilike v_like)
       and (p_viewer_id is null or not public.blocks_between(p_viewer_id, p.id))
     order by (case when p.username ilike v_prefix then 0
                    when p.display_name ilike v_prefix then 1
                    else 2
               end),
              p.follower_count desc,
              p.username asc
     limit v_limit;
end;
$$;

comment on function public.api_search_users(uuid, text, integer) is
  '用户搜索：discoverable + 未注销 + 与查看者无任一方向拉黑；前缀命中优先、粉丝数倒序';

-- 搜索是单页返回（没有游标），响应里的 total 用这个函数：
-- 过滤条件与 api_search_users 逐条对齐（关键词长度、discoverable、deleted_at、blocks）。
drop function if exists public.api_count_search_users(uuid, text);
create function public.api_count_search_users(p_viewer_id uuid, p_query text)
returns integer
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_raw text := btrim(coalesce(p_query, ''));
  v_escaped text;
  v_like text;
begin
  if length(v_raw) < 1 or length(v_raw) > 30 then
    return 0;
  end if;

  v_escaped := replace(replace(replace(v_raw, '\', '\\'), '%', '\%'), '_', '\_');
  v_like := '%' || v_escaped || '%';

  return (
    select count(*)::integer
      from public.profiles p
     where p.deleted_at is null
       and p.discoverable
       and (p.username ilike v_like or p.display_name ilike v_like)
       and (p_viewer_id is null or not public.blocks_between(p_viewer_id, p.id))
  );
end;
$$;

comment on function public.api_count_search_users(uuid, text) is
  '用户搜索命中总数（过滤条件与 api_search_users 一致，供响应里的 total 用）';

-- ============================================================================
-- 5. 既有函数加拉黑过滤（全部 create or replace，签名 / 返回类型不变）
-- ============================================================================

-- ---- 5.1 通知触发器：拉黑生效期间不为对方产生任何通知（契约 §1.3） ----
-- 四条触发器（likes / favorites / comments / follows）挂在两个函数上，所以只改函数体。
-- 位置放在「取到收件人、排除了自己与自己作品」之后：那时才知道该判哪一对人。

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

  -- 0024：拉黑生效期间不产生通知（任一方向）。
  -- 正常路径下写操作已经被 api_set_like/api_create_comment 的 42501 拦住，
  -- 这里是第二道闸：触发器自己挡住，才不依赖「所有写入都走 API 函数」这个假设。
  if public.blocks_between(v_actor, v_recipient) then
    return new;
  end if;

  insert into public.notifications (user_id, kind, actor_id, photo_id, comment_id)
  values (v_recipient, v_kind, v_actor, v_photo_id, v_comment_id);

  return new;
end;
$$;

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

  -- 0024：互相拉黑期间不产生「关注了你」通知（api_follow 已经拦过，这里是兜底）。
  if public.blocks_between(new.follower_id, new.followee_id) then
    return new;
  end if;

  insert into public.notifications (user_id, kind, actor_id)
  values (new.followee_id, 'follow', new.follower_id);

  return new;
end;
$$;

-- ---- 5.2 api_follow：互相不能关注（契约 §1.1 → 403 FORBIDDEN） ----
-- 这里刻意不用 social_target_profile 做过滤：关注/取关本来就不看 visibility
-- （0022 的注释），如果把拉黑塞进那个辅助函数，api_follow 会变成 404（P0002），
-- 而契约要的是 403 + 可读文案。所以在函数里显式分方向判断。

create or replace function public.api_follow(p_username text)
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

  -- 0024：拉黑生效期间互相不能关注。两个方向给不同文案（契约 §1.1）。
  if exists (
    select 1 from public.blocks b
     where b.blocker_id = v_target_id and b.blocked_id = v_uid
  ) then
    raise exception 'BLOCKED_BY_RELATION:对方不可关注' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.blocks b
     where b.blocker_id = v_uid and b.blocked_id = v_target_id
  ) then
    raise exception 'BLOCKED_BY_RELATION:你已拉黑对方' using errcode = '42501';
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

-- ---- 5.3 粉丝 / 关注列表：社交图谱互相排除（契约 §1.5） ----
-- 两层排除，缺一不可：
--   * 列表级：我与被查看的人之间若存在拉黑 —— 被对方拉黑 ⇒ 404（与资料一致，
--     不泄露「存在但被拉黑」）；我拉黑了对方 ⇒ 空集（资料本身仍可见，
--     主页要显示「你已拉黑该用户」，但对方的关系图谱不给我看）；
--   * 行级：列表里每一行若与我有任一方向拉黑，则该行不出现（A 拉了 C 之后，
--     A 看 D 的粉丝列表时也不该看见 C）。

create or replace function public.api_list_followers(
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

  -- 0024：被对方拉黑 ⇒ 与「资料不存在」同一种错误（不泄露「存在但被拉黑」）。
  if v_uid is not null and exists (
    select 1 from public.blocks b
     where b.blocker_id = v_target_id and b.blocked_id = v_uid
  ) then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- 0024：我拉黑了对方 ⇒ 对方的社交图谱对我不可见（空集，不是 404）。
  if v_uid is not null and public.blocks_between(v_uid, v_target_id) then
    return;
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
       -- 0024：与查看者存在任一方向拉黑的行互相排除
       and (v_uid is null or not public.blocks_between(v_uid, f.id))
       and (
         p_cursor_at is null or p_cursor_key is null
         or (fo.created_at, f.username::text) < (p_cursor_at, p_cursor_key)
       )
     order by fo.created_at desc, f.username desc
     limit least(greatest(coalesce(p_limit, 20), 1), 51);
end;
$$;

create or replace function public.api_list_following(
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

  if v_uid is not null and exists (
    select 1 from public.blocks b
     where b.blocker_id = v_target_id and b.blocked_id = v_uid
  ) then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_uid is not null and public.blocks_between(v_uid, v_target_id) then
    return;
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
       and (v_uid is null or not public.blocks_between(v_uid, f.id))
       and (
         p_cursor_at is null or p_cursor_key is null
         or (fo.created_at, f.username::text) < (p_cursor_at, p_cursor_key)
       )
     order by fo.created_at desc, f.username desc
     limit least(greatest(coalesce(p_limit, 20), 1), 51);
end;
$$;

-- ---- 5.4 api_feed：动态流互相排除（契约 §1.5） ----
-- 拉黑时双向 follows 已被删掉，所以这里其实是第二道闸；留着它的价值是：
-- 任何「先有 follows 后有拉黑」的历史数据（例如手工插入、或将来放开禁用的
-- API 路径）也不会把对方作品漏进动态流。

create or replace function public.api_feed(
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

-- ---- 5.5 互动写入：不能点赞 / 收藏 / 评论对方的作品（契约 §1.2 → 403） ----
-- 顺序刻意是「先判作品可互动（P0002/404）→ 再判拉黑（42501/403）」：
-- 与 0014 的既有语义一致（作品不存在就是 404），不给拉黑关系额外的探测面。
-- 作品作者用一次主键查询取回，而不是改 api_assert_interactable_photo 的签名。

create or replace function public.api_set_like(p_photo_id uuid, p_liked boolean)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_author uuid;
begin
  if v_user is null then raise exception '请先登录' using errcode = '42501'; end if;
  perform public.api_assert_interactable_photo(p_photo_id);

  select p.author_id into v_author from public.photos p where p.id = p_photo_id;
  if public.blocks_between(v_user, v_author) then
    raise exception 'BLOCKED_BY_RELATION:对方已拉黑你或你已拉黑对方，无法互动' using errcode = '42501';
  end if;

  if p_liked then
    insert into public.likes(user_id, photo_id) values (v_user, p_photo_id)
    on conflict (user_id, photo_id) do nothing;
  else
    delete from public.likes where user_id = v_user and photo_id = p_photo_id;
  end if;
  return p_liked;
end;
$$;

create or replace function public.api_set_favorite(p_photo_id uuid, p_favorited boolean)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_author uuid;
begin
  if v_user is null then raise exception '请先登录' using errcode = '42501'; end if;
  perform public.api_assert_interactable_photo(p_photo_id);

  select p.author_id into v_author from public.photos p where p.id = p_photo_id;
  if public.blocks_between(v_user, v_author) then
    raise exception 'BLOCKED_BY_RELATION:对方已拉黑你或你已拉黑对方，无法互动' using errcode = '42501';
  end if;

  if p_favorited then
    insert into public.favorites(user_id, photo_id) values (v_user, p_photo_id)
    on conflict (user_id, photo_id) do nothing;
  else
    delete from public.favorites where user_id = v_user and photo_id = p_photo_id;
  end if;
  return p_favorited;
end;
$$;

create or replace function public.api_create_comment(
  p_photo_id uuid,
  p_parent_id uuid,
  p_body text
)
returns public.comments
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.comments;
  v_parent public.comments;
  v_author uuid;
begin
  if v_user is null then raise exception '请先登录' using errcode = '42501'; end if;
  perform public.api_assert_interactable_photo(p_photo_id);

  select p.author_id into v_author from public.photos p where p.id = p_photo_id;
  if public.blocks_between(v_user, v_author) then
    raise exception 'BLOCKED_BY_RELATION:对方已拉黑你或你已拉黑对方，无法互动' using errcode = '42501';
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

-- ---- 5.6 公开资料：被对方拉黑 ⇒ P0002；并给出 is_blocked（契约 §1.4 / §3） ----
-- 返回行型多了 is_blocked 一列 ⇒ 只能 drop + create（0018 的注释里说明过这条路）。
-- drop 会丢授权，所以 6 节里重新 grant。

drop function if exists public.api_get_profile_by_username(text);
create function public.api_get_profile_by_username(p_username text)
returns table(
  username text, display_name text, avatar_key text, bio text, role text, links jsonb,
  license_preference text, visibility text, show_likes boolean, show_favorites boolean,
  discoverable boolean, created_at timestamptz, is_owner boolean, is_blocked boolean
)
language plpgsql security definer stable
set search_path = pg_catalog, public
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

  -- 不存在 / 未注销以外的不可见（private 且非本人）：沿用 0018 的「没有行」语义 ⇒ 404。
  if not found then
    return;
  end if;

  -- 0024：被目标拉黑 ⇒ 与「用户不存在」完全同一种错误。
  -- 必须抛 P0002 而不是返回空行吗？两者在 HTTP 上都是 404，但契约 §1.4 明确要求
  -- 抛 P0002（「让后端翻成 404」），并且将来若有别的调用方按异常分支处理，
  -- 空行会静默通过 —— 所以这里按契约抛异常，服务端在
  -- repositories/profiles.ts 里把 P0002 翻成 null ⇒ 路由 404。
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
           -- 任一方向为 true（自己被拉黑的那一侧在上面已经 404 了，所以这里
           -- 实际只会是「我拉黑了对方」或 false）。游客恒为 false。
           (v_uid is not null and public.blocks_between(v_uid, v_target.id));
end;
$$;

comment on function public.api_get_profile_by_username(text) is
  '直达公开资料；discoverable 只供发现/搜索过滤，不阻止已知 username 直达；不返回 user UUID；'
  '被对方拉黑时抛 P0002（与不存在不可区分）；is_blocked=任一方向拉黑';

-- ---- 5.7 个人主页的公开喜欢/收藏列表：互相不可见（契约 §1.6） ----
-- 与 5.3 同一套方向规则：被对方拉黑 ⇒ P0002；我拉黑了对方 ⇒ 空集
-- （资料本身仍可见，只是这类内容不给）。已存在的点赞/收藏行不做追溯删除 ——
-- 「互相不可见」是在读取侧过滤，而不是把历史数据删掉（契约 §1.6）。

create or replace function public.api_list_profile_interactions(
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

-- ============================================================================
-- 6. 权限：内部函数一律不开放，公开 API 单独 grant 给 app_user
--    （drop function 会丢掉旧授权，所以 api_get_profile_by_username 必须重发。）
-- ============================================================================

revoke all on function public.blocks_between(uuid, uuid) from public, app_user;

revoke all on function public.api_block_user(uuid, citext) from public, app_user;
grant execute on function public.api_block_user(uuid, citext) to app_user;

revoke all on function public.api_unblock_user(uuid, citext) from public, app_user;
grant execute on function public.api_unblock_user(uuid, citext) to app_user;

revoke all on function public.api_list_blocks(uuid, integer, timestamptz, uuid) from public, app_user;
grant execute on function public.api_list_blocks(uuid, integer, timestamptz, uuid) to app_user;

revoke all on function public.api_count_blocks(uuid) from public, app_user;
grant execute on function public.api_count_blocks(uuid) to app_user;

revoke all on function public.api_search_users(uuid, text, integer) from public, app_user;
grant execute on function public.api_search_users(uuid, text, integer) to app_user;

revoke all on function public.api_count_search_users(uuid, text) from public, app_user;
grant execute on function public.api_count_search_users(uuid, text) to app_user;

-- api_get_profile_by_username 是 drop + create，这里必须重新发一次授权，
-- 否则 profiles 接口在迁移后直接 42501（0018 的注释里也写过这一条）。
revoke all on function public.api_get_profile_by_username(text) from public, app_user;
grant execute on function public.api_get_profile_by_username(text) to app_user;

-- ============================================================================
-- 7. 自检：把上面每一条安全边界与「没改坏既有函数」都变成断言
--    （迁移失败要当场失败，不能留下一个「看起来装好了」的库。）
-- ============================================================================

do $$
declare
  v_priv text;
  v_name text;
  v_count integer;
  v_sig text;
begin
  -- 7.1 blocks 的表级权限必须被彻底收回（RLS 之外的兜底）
  foreach v_priv in array array['select', 'insert', 'update', 'delete'] loop
    if has_table_privilege('app_user', 'public.blocks', v_priv) then
      raise exception '0024 自检失败：app_user 拥有 blocks 的 % 权限', v_priv;
    end if;
  end loop;

  -- 7.2 RLS 必须开启且没有放行 policy
  if not exists (
    select 1 from pg_class where oid = 'public.blocks'::regclass and relrowsecurity
  ) then
    raise exception '0024 自检失败：blocks 未开启 RLS';
  end if;
  if exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'blocks'
  ) then
    raise exception '0024 自检失败：blocks 不应有 policy';
  end if;

  -- 7.3 主键 / 自拉黑约束必须在
  if not exists (
    select 1 from pg_constraint
     where conname = 'pk_blocks' and conrelid = 'public.blocks'::regclass
  ) or not exists (
    select 1 from pg_constraint
     where conname = 'ck_blocks_no_self' and conrelid = 'public.blocks'::regclass
  ) then
    raise exception '0024 自检失败：blocks 缺少主键或自拉黑约束';
  end if;

  -- 7.4 内部辅助不得对外开放
  if has_function_privilege('app_user', 'public.blocks_between(uuid, uuid)', 'execute') then
    raise exception '0024 自检失败：内部函数 blocks_between 被开放给 app_user';
  end if;

  -- 7.5 公开 API 必须对 app_user 可用，否则服务端必然 42501
  foreach v_sig in array array[
    'public.api_block_user(uuid,citext)',
    'public.api_unblock_user(uuid,citext)',
    'public.api_list_blocks(uuid,integer,timestamptz,uuid)',
    'public.api_count_blocks(uuid)',
    'public.api_search_users(uuid,text,integer)',
    'public.api_count_search_users(uuid,text)',
    'public.api_get_profile_by_username(text)'
  ] loop
    if not has_function_privilege('app_user', v_sig, 'execute') then
      raise exception '0024 自检失败：app_user 无法执行 %', v_sig;
    end if;
  end loop;

  -- 7.6 被本迁移替换过的既有函数必须仍然是「固定 search_path 的 SECURITY DEFINER」：
  --     create or replace 写错一个参数就会变成「多出一个重载」，旧签名还在，
  --     下面 7.7 的数量断言会同时把这种情况抓出来。
  foreach v_sig in array array[
    'public.api_feed(integer,timestamptz,uuid)',
    'public.api_follow(text)',
    'public.api_list_followers(text,integer,timestamptz,text)',
    'public.api_list_following(text,integer,timestamptz,text)',
    'public.api_set_like(uuid,boolean)',
    'public.api_set_favorite(uuid,boolean)',
    'public.api_create_comment(uuid,uuid,text)',
    'public.api_get_profile_by_username(text)',
    'public.api_list_profile_interactions(text,text,integer,timestamptz,uuid)',
    'public.notify_from_interaction()',
    'public.notify_from_follow()',
    'public.api_block_user(uuid,citext)',
    'public.api_unblock_user(uuid,citext)',
    'public.api_list_blocks(uuid,integer,timestamptz,uuid)',
    'public.api_search_users(uuid,text,integer)'
  ] loop
    if not exists (
      select 1
        from pg_proc pr
       where pr.oid = v_sig::regprocedure
         and pr.prosecdef
         and exists (
           select 1 from unnest(coalesce(pr.proconfig, array[]::text[])) c
            where c like 'search_path=%'
         )
    ) then
      raise exception '0024 自检失败：% 不是固定 search_path 的 SECURITY DEFINER 函数', v_sig;
    end if;
  end loop;

  -- 7.7 函数名唯一（防止 create or replace 写岔参数后留下多余重载）
  foreach v_name in array array[
    'api_feed', 'api_follow', 'api_list_followers', 'api_list_following',
    'api_set_like', 'api_set_favorite', 'api_create_comment',
    'api_get_profile_by_username', 'api_list_profile_interactions',
    'notify_from_interaction', 'notify_from_follow',
    'api_block_user', 'api_unblock_user', 'api_list_blocks', 'api_count_blocks',
    'api_search_users', 'api_count_search_users', 'blocks_between'
  ] loop
    select count(*) into v_count
      from pg_proc pr
      join pg_namespace n on n.oid = pr.pronamespace
     where n.nspname = 'public' and pr.proname = v_name;
    if v_count <> 1 then
      raise exception '0024 自检失败：public.% 存在 % 个函数（应为 1）', v_name, v_count;
    end if;
  end loop;

  -- 7.8 通知触发器必须还在（本迁移只改函数体，不能把触发器带走）
  foreach v_name in array array[
    'trg_notifications_likes', 'trg_notifications_favorites',
    'trg_notifications_comments', 'trg_follows_notify', 'trg_follows_counts'
  ] loop
    if not exists (
      select 1 from pg_trigger t
       where t.tgname = v_name and not t.tgisinternal
    ) then
      raise exception '0024 自检失败：触发器 % 丢失', v_name;
    end if;
  end loop;

  -- 7.9 公开资料接口的返回行型必须已经带上 is_blocked（列存在 = drop + create 生效）。
  --     TABLE(...) 函数的返回列名在 proargnames 里（不是 pg_attribute：
  --     此时 prorettype 是匿名的 record），所以这里查 proargnames。
  if not exists (
    select 1
      from pg_proc pr
     where pr.oid = 'public.api_get_profile_by_username(text)'::regprocedure
       and 'is_blocked' = any(coalesce(pr.proargnames, array[]::text[]))
  ) then
    raise exception '0024 自检失败：api_get_profile_by_username 未返回 is_blocked';
  end if;

  -- 7.10 拉黑语义依赖的可见性约束仍在（0018 的 ck_profiles_visibility）
  if not exists (
    select 1 from pg_constraint
     where conname = 'ck_profiles_visibility' and conrelid = 'public.profiles'::regclass
  ) then
    raise exception '0024 自检失败：profiles.visibility 约束缺失，可见性语义没有保障';
  end if;
end;
$$;
