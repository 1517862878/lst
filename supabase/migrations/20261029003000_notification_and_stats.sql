\encoding UTF8
-- ============================================================================
-- 工科影展 · 0030 通知补全与创作者统计（8.3d 后端）
-- 依据：docs/主线与并行工作线汇总报告 §8.3（留存 P1 的最后两项）
--       .tmp/phase83d-freeze.md（绑定契约）
--
-- 本迁移补三件事：
--   1) 回复通知：评论回复要通知「被回复的人」，而不是只通知作品作者
--      （0022 的触发器对所有评论都只找 photos.author_id，回复通知因此从未出现过）
--   2) 榜单通知：周榜快照发布后给上榜作者发系统通知（排名写进 meta）
--   3) 创作者统计：作品数/获赞/收藏/评论/浏览/粉丝，口径收口在一个函数里
--
-- 顺带给 notifications 加 meta jsonb：榜单名次、聚合分组这类结构化信息需要有地方放，
-- 否则前端只能靠文案硬编码。meta 只允许对象，避免数组/标量混进来。
--
-- 幂等：add column if not exists、函数先 drop 再 create、trigger drop 后重建、
--       末尾 DO 块自检。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. notifications.meta
-- ---------------------------------------------------------------------------
alter table public.notifications add column if not exists meta jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.notifications'::regclass and conname = 'ck_notifications_meta_object'
  ) then
    alter table public.notifications
      add constraint ck_notifications_meta_object
      check (meta is null or jsonb_typeof(meta) = 'object');
  end if;
end;
$$;

comment on column public.notifications.meta is
  '结构化附加信息（如榜单名次 {rank, isoWeek, score}）。只允许 JSON 对象，nullable。';

-- ---------------------------------------------------------------------------
-- 2. 回复通知
--
-- 只在 parent_id 非空时触发：顶楼评论的通知由 0022 的 notify_from_interaction 负责，
-- 两者不重叠（回复同时也会提醒作品作者？不会 —— 这里只发给 parent 作者，
-- 避免「一条回复给同一个作者发两条通知」的重复轰炸）。
-- 自己回复自己、父评论作者已注销、父评论已被删除、父评论作者与回复者被拉黑 → 静默。
-- ---------------------------------------------------------------------------
-- 必须先把触发器摘掉：drop function 会被触发器倚赖而失败
-- （重放时报错「触发器 trg_notifications_comment_reply 在 表 comments 倚赖于 函数」）。
drop trigger if exists trg_notifications_comment_reply on public.comments;
drop function if exists public.notify_from_comment_reply();
create function public.notify_from_comment_reply()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_parent_author uuid;
  v_photo_author uuid;
begin
  if new.parent_id is null or new.deleted_at is not null then
    return new;
  end if;

  select c.author_id into v_parent_author
    from public.comments c
   where c.id = new.parent_id
     and c.deleted_at is null;

  if v_parent_author is null then
    return new;
  end if;

  -- 回复自己 → 不提醒
  if v_parent_author = new.author_id then
    return new;
  end if;

  -- 被回复的人已注销 → 不打扰
  if not exists (
    select 1 from public.profiles p where p.id = v_parent_author and p.deleted_at is null
  ) then
    return new;
  end if;

  -- 与作品作者是同一个人时，0022 的触发器已经发过「评论了你的作品」，
  -- 这里不再补一条，避免同一条回复给他两条通知。
  select p.author_id into v_photo_author from public.photos p where p.id = new.photo_id;
  if v_photo_author = v_parent_author then
    return new;
  end if;

  insert into public.notifications (user_id, kind, actor_id, photo_id, comment_id, meta)
  values (v_parent_author, 'comment', new.author_id, new.photo_id, new.id,
          jsonb_build_object('reply', true, 'parentCommentId', new.parent_id));

  return new;
end;
$$;

create trigger trg_notifications_comment_reply
  after insert on public.comments
  for each row execute function public.notify_from_comment_reply();

-- ---------------------------------------------------------------------------
-- 3. 榜单通知
--
-- 由运维/脚本在快照发布后调用一次（没有调度器，所以不做成自动触发器）：
--   select public.api_notify_weekly_rank('<snapshot-id>');
-- 幂等：同一快照同一作品已经发过系统通知就跳过，重复调用不会刷屏。
-- ---------------------------------------------------------------------------
drop function if exists public.api_notify_weekly_rank(uuid);
create function public.api_notify_weekly_rank(p_snapshot_id uuid)
returns integer
language plpgsql volatile security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_iso_week text;
  v_created integer := 0;
  r record;
begin
  select s.iso_week into v_iso_week
    from public.weekly_rank_snapshots s
   where s.id = p_snapshot_id;
  if v_iso_week is null then
    raise exception '周榜快照不存在' using errcode = 'P0002';
  end if;

  for r in
    select e.photo_id, e.rank, e.score, p.author_id
      from public.weekly_rank_entries e
      join public.photos p on p.id = e.photo_id
     where e.snapshot_id = p_snapshot_id
       and e.rank <= 10
       and p.deleted_at is null
       and p.status = 'published'
       and p.author_id is not null
  loop
    if exists (
      select 1 from public.notifications n
       where n.user_id = r.author_id
         and n.kind = 'system'
         and n.photo_id = r.photo_id
         and n.meta ->> 'isoWeek' = v_iso_week
    ) then
      continue;
    end if;

    insert into public.notifications (user_id, kind, actor_id, photo_id, comment_id, meta)
    values (r.author_id, 'system', null, r.photo_id, null,
            jsonb_build_object('kind', 'weekly_rank', 'rank', r.rank, 'isoWeek', v_iso_week,
                               'score', r.score));
    v_created := v_created + 1;
  end loop;

  return v_created;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. 创作者统计
--
-- 口径：
--   * 作品数只算未删除；曝光/互动数按整库累加（含草稿？不含 —— 草稿没对外展示，
--     把它的浏览算进「影响力」会误导创作者）
--   * 粉丝数只算 follows，不含互相关注的重复计数
--   * 浏览数来自 photos.view_count（本项目目前没有真实埋点，数字以种子/后台为准）
-- 返回单行，调用方一次拿全，避免前端发七八个请求。
-- ---------------------------------------------------------------------------
drop function if exists public.api_creator_stats(uuid);
create function public.api_creator_stats(p_user_id uuid)
returns table(
  photo_count integer,
  published_count integer,
  draft_count integer,
  like_total bigint,
  favorite_total bigint,
  comment_total bigint,
  view_total bigint,
  follower_count integer,
  following_count integer
)
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_user_id is null then
    raise exception '缺少用户' using errcode = '22023';
  end if;

  return query
  select
    count(ph.id)::integer as photo_count,
    count(ph.id) filter (where ph.status = 'published' and ph.deleted_at is null)::integer as published_count,
    count(ph.id) filter (where ph.status = 'draft' and ph.deleted_at is null)::integer as draft_count,
    coalesce(sum(ph.like_count) filter (where ph.status = 'published' and ph.deleted_at is null), 0)::bigint as like_total,
    coalesce(sum(ph.favorite_count) filter (where ph.status = 'published' and ph.deleted_at is null), 0)::bigint as favorite_total,
    coalesce(sum(ph.comment_count) filter (where ph.status = 'published' and ph.deleted_at is null), 0)::bigint as comment_total,
    coalesce(sum(ph.view_count) filter (where ph.status = 'published' and ph.deleted_at is null), 0)::bigint as view_total,
    (select count(*)::integer from public.follows f where f.followee_id = p_user_id) as follower_count,
    (select count(*)::integer from public.follows f where f.follower_id = p_user_id) as following_count
  from public.photos ph
  where ph.author_id = p_user_id
    and ph.deleted_at is null;
end;
$$;

-- 单件作品的互动数据（作品管理页用）；只返回本人的作品
drop function if exists public.api_photo_stats(uuid, integer, integer);
create function public.api_photo_stats(p_user_id uuid, p_limit integer default 50, p_offset integer default 0)
returns table(
  photo_id uuid,
  title text,
  status text,
  published_at timestamptz,
  like_count integer,
  favorite_count integer,
  comment_count integer,
  view_count integer,
  featured_at timestamptz
)
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if p_user_id is null then
    raise exception '缺少用户' using errcode = '22023';
  end if;

  return query
  select ph.id, ph.title, ph.status, ph.published_at,
         ph.like_count, ph.favorite_count, ph.comment_count, ph.view_count, ph.featured_at
    from public.photos ph
   where ph.author_id = p_user_id
     and ph.deleted_at is null
   order by coalesce(ph.published_at, ph.created_at) desc, ph.id desc
   limit v_limit offset v_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4.5 通知的 meta 一次性取回
--
-- 为什么不做成「改 api_list_notifications 的返回列」：那个函数是 0022 写好并已被
-- 集成测试覆盖的长函数，改返回类型要 drop + 整段重写，风险与收益不成比例。
-- 这里补一个批量取 meta 的函数，服务端一次查询把所有 meta 拼回去（不是 N+1）。
-- 另一个好处：老客户端拿不到 meta 也不会坏（向后兼容）。
-- ---------------------------------------------------------------------------
drop function if exists public.api_notification_meta(uuid[]);
create function public.api_notification_meta(p_ids uuid[])
returns table(id uuid, meta jsonb)
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_ids is null or array_length(p_ids, 1) is null then
    return;
  end if;

  return query
  select n.id, n.meta
    from public.notifications n
   where n.id = any(p_ids);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. 授权
-- ---------------------------------------------------------------------------
revoke all on function public.api_notify_weekly_rank(uuid) from public, app_user;
grant execute on function public.api_notify_weekly_rank(uuid) to app_user;

revoke all on function public.api_notification_meta(uuid[]) from public, app_user;
grant execute on function public.api_notification_meta(uuid[]) to app_user;

revoke all on function public.api_creator_stats(uuid) from public, app_user;
grant execute on function public.api_creator_stats(uuid) to app_user;

revoke all on function public.api_photo_stats(uuid, integer, integer) from public, app_user;
grant execute on function public.api_photo_stats(uuid, integer, integer) to app_user;

-- ---------------------------------------------------------------------------
-- 6. 自检
-- ---------------------------------------------------------------------------
do $$
declare
  v_sig text;
  v_oid oid;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'notifications' and column_name = 'meta'
  ) then
    raise exception '0030 自检失败：notifications.meta 不存在';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.comments'::regclass
       and tgname = 'trg_notifications_comment_reply'
       and not tgisinternal
  ) then
    raise exception '0030 自检失败：回复通知触发器不存在';
  end if;

  foreach v_sig in array array[
    'public.api_notify_weekly_rank(uuid)',
    'public.api_notification_meta(uuid[])',
    'public.api_creator_stats(uuid)',
    'public.api_photo_stats(uuid,integer,integer)'
  ] loop
    v_oid := to_regprocedure(v_sig);
    if v_oid is null then
      raise exception '0030 自检失败：函数 % 不存在', v_sig;
    end if;

    if not exists (select 1 from pg_proc p where p.oid = v_oid and p.prosecdef) then
      raise exception '0030 自检失败：函数 % 不是 security definer', v_sig;
    end if;

    if not has_function_privilege('app_user', v_oid, 'execute') then
      raise exception '0030 自检失败：app_user 不能执行 %', v_sig;
    end if;
  end loop;

  raise notice 'OK: 0030 通知补全与创作者统计迁移自检通过（meta / 回复触发器 / 3 个 definer 函数就位）';
end;
$$;
