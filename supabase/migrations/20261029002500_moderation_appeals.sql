-- ============================================================================
-- 工科影展 · 0025 举报回执 / 处罚可见 / 申诉闭环（8.2 治理 P0 后端）
-- 依据：.tmp/phase82-freeze.md（绑定契约）、docs/暂定产品完善计划表.md §5.2
--       （P0-13 举报入口 / P0-14 回执 / P0-15 我的举报 / P0-16 审核队列 /
--         P0-17 通知 / P0-18 处罚透明 / P0-19 申诉与复核）
--
-- 本迁移只做"补齐"，不改历史迁移：
--   1) notifications 增加 meta jsonb，并重建 api_list_notifications 带出 meta
--      （举报裁定 / 处罚生效 / 申诉结论三类系统通知都用 meta 携带深链参数）；
--   2) 新表 report_appeals（申诉）：RLS 开 + 无 policy + 收回表级权限，
--      与 notifications / moderation_actions 同一套"只能经 SECURITY DEFINER 访问"的边界；
--   3) moderation_actions 的动作词表补 'review_appeal'（申诉复核审计），
--      词表是 0015 的 inline CHECK，此处 drop 后以命名约束重建，保持既有语义不变；
--   4) 9 个对外 SECURITY DEFINER 函数：举报回执查询、申诉提交/查询、处罚查询、
--      管理端举报详情/队列、管理端处罚/申诉列表、申诉复核；
--   5) api_resolve_report / api_apply_sanction 重建：在原有审计之后补系统通知；
--   6) 权限收口 + 自检 DO 块（RLS、app_user 无直连权限、函数均为 definer 且带 search_path）。
--
-- 幂等：全部 create ... if not exists / drop ... if exists 后再建，可整文件重复回放。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. notifications.meta
--    三类治理通知的载荷（reportId / outcome / sanctionId / kind / endsAt /
--    appealId / status）必须能被前端直接消费，而不必反查举报表（举报人无权读他人的处罚）。
-- ----------------------------------------------------------------------------
alter table public.notifications add column if not exists meta jsonb;

-- meta 必须是 JSON 对象，避免前端拿到数组/标量后崩溃
alter table public.notifications drop constraint if exists ck_notifications_meta_object;
alter table public.notifications add constraint ck_notifications_meta_object
  check (meta is null or jsonb_typeof(meta) = 'object');

comment on column public.notifications.meta is
  '通知载荷（jsonb object）：治理类系统通知带 reportId/outcome/sanctionId/appealId 等深链参数；其它类型为 null';

-- ----------------------------------------------------------------------------
-- 2. 重建 api_list_notifications：末尾增加 meta
--    返回类型变化 → 必须先 drop function（create or replace 不允许改返回列）。
--    api_notifications_unread_count / api_mark_notifications_read 只回计数，
--    没有任何 meta 语义，保持 0022 原样不重建（改动只会增加无意义的列）。
-- ----------------------------------------------------------------------------
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
  created_at timestamptz,
  meta jsonb
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
      select n.id, n.kind, n.actor_id, n.photo_id, n.comment_id, n.read_at, n.created_at, n.meta
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
           pg.created_at,
           pg.meta
      from page pg
      left join public.profiles actor on actor.id = pg.actor_id and actor.deleted_at is null
      left join public.photos p on p.id = pg.photo_id
      left join public.comments c on c.id = pg.comment_id
     order by pg.created_at desc, pg.id desc;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. report_appeals（申诉）
--    一个申诉要么针对"被驳回/成立的举报"，要么针对"落在本人身上的处罚"，
--    二者恰好一个非空（ck_report_appeals_target）。申诉人只能是本人（函数强制）。
--    状态机与 reports 对齐：open → reviewing → upheld（申诉成立）/ rejected（维持原判）。
-- ----------------------------------------------------------------------------
create table if not exists public.report_appeals (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid references public.reports (id) on delete cascade,
  sanction_id uuid references public.user_sanctions (id) on delete cascade,
  appellant_id uuid not null references public.profiles (id) on delete cascade,
  message     text not null,
  status      text not null default 'open',
  reviewer_id uuid references public.profiles (id) on delete set null,
  review_note text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  reviewed_at timestamptz
);

comment on table public.report_appeals is
  '申诉；针对举报或针对处罚（恰好一个非空）；只经 SECURITY DEFINER 函数读写';

-- 约束用"先 drop 再 add"的收敛写法，保证重复回放后约束名与定义一致（同 0015 的风格）
alter table public.report_appeals drop constraint if exists ck_report_appeals_status;
alter table public.report_appeals add constraint ck_report_appeals_status
  check (status in ('open', 'reviewing', 'upheld', 'rejected'));

alter table public.report_appeals drop constraint if exists ck_report_appeals_target;
alter table public.report_appeals add constraint ck_report_appeals_target
  check (((report_id is not null)::integer + (sanction_id is not null)::integer) = 1);

alter table public.report_appeals drop constraint if exists ck_report_appeals_message_len;
alter table public.report_appeals add constraint ck_report_appeals_message_len
  check (char_length(btrim(message)) between 10 and 2000);

alter table public.report_appeals drop constraint if exists ck_report_appeals_review_note_len;
alter table public.report_appeals add constraint ck_report_appeals_review_note_len
  check (char_length(review_note) <= 2000);

-- 未结案 ⇔ 没有复核时间；已结案 ⇔ 必须有复核时间（与 reports 的 ck_reports_resolution_state 同构）
alter table public.report_appeals drop constraint if exists ck_report_appeals_reviewed_state;
alter table public.report_appeals add constraint ck_report_appeals_reviewed_state
  check (
    (status in ('open', 'reviewing') and reviewed_at is null and reviewer_id is null)
    or (status in ('upheld', 'rejected') and reviewed_at is not null and reviewer_id is not null)
  );

-- 同一申诉人对同一事项只能有一条未结申诉（P0-19：避免同一事项无限申诉）。
-- 两个部分唯一索引分别覆盖"针对举报"和"针对处罚"两种目标，重复提交由 23505 拦下，
-- 服务端把它翻成 409 CONFLICT。
create unique index if not exists uq_report_appeals_open_report
  on public.report_appeals (appellant_id, report_id)
  where status in ('open', 'reviewing') and report_id is not null;
create unique index if not exists uq_report_appeals_open_sanction
  on public.report_appeals (appellant_id, sanction_id)
  where status in ('open', 'reviewing') and sanction_id is not null;

create index if not exists idx_report_appeals_status
  on public.report_appeals (status, created_at desc, id desc);
create index if not exists idx_report_appeals_appellant
  on public.report_appeals (appellant_id, created_at desc, id desc);
create index if not exists idx_report_appeals_report on public.report_appeals (report_id);
create index if not exists idx_report_appeals_sanction on public.report_appeals (sanction_id);

drop trigger if exists trg_report_appeals_updated_at on public.report_appeals;
create trigger trg_report_appeals_updated_at
  before update on public.report_appeals
  for each row execute function public.set_updated_at();

-- 与 notifications 同一套边界：RLS 开、无 policy、收回表级权限 ⇒ 只能经 definer 函数访问。
-- 为什么不给 policy：申诉行的可见性取决于"本人 or staff"，但 staff 判定
-- (is_editor_or_admin) 与"最新申诉状态"投影都在函数里做，表级 policy 只会让
-- 两条路径的权限语义出现分叉，增加越权面。
alter table public.report_appeals enable row level security;
revoke all on public.report_appeals from public, app_user;

-- ----------------------------------------------------------------------------
-- 4. moderation_actions 动作词表补 'review_appeal'
--    0015 的 action_type 是 inline CHECK（自动名 moderation_actions_action_type_check），
--    没有任何取值能表达"申诉复核"本身。这里把两个可能的名字都 drop 掉，
--    再用命名约束重建完整词表（原 12 个取值原样保留）。
-- ----------------------------------------------------------------------------
alter table public.moderation_actions drop constraint if exists moderation_actions_action_type_check;
alter table public.moderation_actions drop constraint if exists ck_moderation_actions_action_type;
alter table public.moderation_actions add constraint ck_moderation_actions_action_type
  check (action_type in
    ('claim_report', 'uphold_report', 'reject_report', 'hide_photo', 'restore_photo',
     'hide_comment', 'restore_comment', 'warn_user', 'restrict_user', 'suspend_user',
     'ban_user', 'revoke_sanction', 'review_appeal'));

-- ----------------------------------------------------------------------------
-- 5. 内部助手函数（不对 app_user 开放）
-- ----------------------------------------------------------------------------

-- 5.1 治理通知写入：统一走 kind='system' + meta
--     被通知人已注销时静默跳过（软删用户仍满足 FK，但没有阅读入口）。
create or replace function public.notify_moderation_event(p_user_id uuid, p_meta jsonb)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_id uuid;
begin
  if p_user_id is null then
    return null;
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.deleted_at is null) then
    return null;
  end if;
  insert into public.notifications (user_id, kind, meta)
  values (p_user_id, 'system', p_meta)
  returning id into v_id;
  return v_id;
end;
$$;

-- 5.2 举报目标投影（ReportTarget）：列表与详情共用同一份投影，避免两处漂移。
--     内容被硬删（或作者注销）时退回到 api_submit_report 写入的 target_snapshot，
--     这样审核队列不会出现"标题空白、无法判断"的行。
create or replace function public.moderation_report_target(
  p_target_type text, p_target_id uuid, p_snapshot jsonb
) returns jsonb language sql stable security definer
set search_path = pg_catalog, public
as $$
  select case p_target_type
    when 'photo' then (
      select jsonb_build_object(
        'kind', 'photo',
        'id', p_target_id,
        'title', coalesce(nullif(p.title, ''), nullif(p_snapshot ->> 'title', ''), '已删除作品'),
        'excerpt', left(coalesce(p.description, ''), 200),
        'authorId', coalesce(p.author_id, nullif(p_snapshot ->> 'authorId', '')::uuid),
        'authorUsername', coalesce(au.username::text, ''),
        'authorDisplayName', coalesce(au.display_name, ''),
        'hidden', (p.id is null) or p.status <> 'published' or p.deleted_at is not null
      )
      from (select 1) anchor
      left join public.photos p on p.id = p_target_id
      left join public.profiles au
        on au.id = coalesce(p.author_id, nullif(p_snapshot ->> 'authorId', '')::uuid)
    )
    when 'comment' then (
      select jsonb_build_object(
        'kind', 'comment',
        'id', p_target_id,
        'title', coalesce(nullif(ph.title, ''), '评论'),
        'excerpt', left(coalesce(nullif(c.body, ''), nullif(p_snapshot ->> 'body', ''), ''), 200),
        'authorId', coalesce(c.author_id, nullif(p_snapshot ->> 'authorId', '')::uuid),
        'authorUsername', coalesce(au.username::text, ''),
        'authorDisplayName', coalesce(au.display_name, ''),
        'hidden', (c.id is null) or c.status <> 'visible' or c.deleted_at is not null
      )
      from (select 1) anchor
      left join public.comments c on c.id = p_target_id
      left join public.photos ph on ph.id = c.photo_id
      left join public.profiles au
        on au.id = coalesce(c.author_id, nullif(p_snapshot ->> 'authorId', '')::uuid)
    )
    when 'profile' then (
      select jsonb_build_object(
        'kind', 'profile',
        'id', p_target_id,
        'title', coalesce(nullif(pr.display_name, ''), pr.username::text, p_snapshot ->> 'username', '已注销用户'),
        'excerpt', left(coalesce(pr.bio, ''), 200),
        'authorId', p_target_id,
        'authorUsername', coalesce(pr.username::text, p_snapshot ->> 'username', ''),
        'authorDisplayName', coalesce(nullif(pr.display_name, ''), p_snapshot ->> 'username', ''),
        'hidden', (pr.id is null) or pr.deleted_at is not null
      )
      from (select 1) anchor
      left join public.profiles pr on pr.id = p_target_id
    )
    else null
  end;
$$;

comment on function public.moderation_report_target(text, uuid, jsonb) is
  '举报目标投影（ReportTarget）：photo/comment/profile；内容缺失时回退 target_snapshot';

-- ----------------------------------------------------------------------------
-- 6. 举报裁定 → 通知举报人（重建 api_resolve_report）
--    只新增一条通知写入，原有权限判定、认领校验、审计与返回值保持 0015 原样。
-- ----------------------------------------------------------------------------
drop function if exists public.api_resolve_report(uuid, text, text, text, text);
create function public.api_resolve_report(
  p_report_id uuid, p_outcome text, p_resolution_code text, p_review_note text,
  p_request_id text default null
) returns public.reports language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare v_actor uuid:=auth.uid(); v_before public.reports; v_after public.reports;
begin
  if not public.is_editor_or_admin() then raise exception '需要审核权限' using errcode='42501'; end if;
  if p_outcome not in ('upheld','rejected') then raise exception '结论不合法' using errcode='23514'; end if;
  select * into v_before from public.reports where id=p_report_id for update;
  if not found then raise exception '举报不存在' using errcode='P0002'; end if;
  if v_before.status not in ('open','reviewing') then raise exception '举报已结案' using errcode='P0003'; end if;
  if public.current_role_name()<>'admin' and v_before.assigned_to is distinct from v_actor then
    raise exception '请先认领该举报' using errcode='42501';
  end if;
  update public.reports set status=p_outcome,resolution_code=p_resolution_code,review_note=btrim(coalesce(p_review_note,'')),
    resolved_by=v_actor,resolved_at=clock_timestamp(),assigned_to=coalesce(assigned_to,v_actor)
   where id=p_report_id returning * into v_after;
  insert into public.moderation_actions(report_id,actor_id,action_type,target_type,target_id,reason,before_state,after_state,request_id)
  values(p_report_id,v_actor,case when p_outcome='upheld' then 'uphold_report' else 'reject_report' end,
    'report',p_report_id,coalesce(nullif(btrim(p_review_note),''),p_resolution_code),to_jsonb(v_before),to_jsonb(v_after),left(p_request_id,128));
  -- 0025：举报回执闭环 —— 告诉举报人结论（P0-14 / P0-17）
  perform public.notify_moderation_event(v_after.reporter_id,
    jsonb_strip_nulls(jsonb_build_object(
      'reportId', v_after.id,
      'outcome', v_after.status,
      'resolutionCode', v_after.resolution_code,
      'resolvedAt', v_after.resolved_at)));
  return v_after;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. 处罚生效 → 通知被处罚者（重建 api_apply_sanction）
--    处罚必须对本人可见（P0-18），否则被处罚者只能看到"突然不能发帖"。
--    原有权限判定、会话吊销、审计与返回值保持 0015 原样。
-- ----------------------------------------------------------------------------
drop function if exists public.api_apply_sanction(uuid, text, text, text, timestamptz, uuid, text);
create function public.api_apply_sanction(
  p_user_id uuid, p_kind text, p_reason_code text, p_reason_detail text,
  p_ends_at timestamptz default null, p_report_id uuid default null, p_request_id text default null
) returns public.user_sanctions language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare v_actor uuid:=auth.uid(); v_row public.user_sanctions; v_target_role text;
begin
  if public.current_role_name()<>'admin' then raise exception '仅管理员可处罚账号' using errcode='42501'; end if;
  if p_user_id=v_actor then raise exception '不能处罚自己' using errcode='42501'; end if;
  select role into v_target_role from public.profiles where id=p_user_id and deleted_at is null for update;
  if not found then raise exception '用户不存在' using errcode='P0002'; end if;
  if v_target_role='admin' then raise exception '不能处罚管理员账号' using errcode='42501'; end if;
  if p_kind='suspension' and (p_ends_at is null or p_ends_at<=now()) then raise exception '暂停必须有未来结束时间' using errcode='23514'; end if;
  if p_kind='ban' and p_ends_at is not null then raise exception '永久封禁不能设置结束时间' using errcode='23514'; end if;
  insert into public.user_sanctions(user_id,kind,reason_code,reason_detail,ends_at,created_by,related_report_id)
  values(p_user_id,p_kind,p_reason_code,btrim(coalesce(p_reason_detail,'')),p_ends_at,v_actor,p_report_id)
  returning * into v_row;
  insert into public.moderation_actions(report_id,actor_id,action_type,target_type,target_id,reason,after_state,sanction_id,request_id)
  values(p_report_id,v_actor,case p_kind when 'warning' then 'warn_user' when 'content_restriction' then 'restrict_user'
    when 'suspension' then 'suspend_user' else 'ban_user' end,'user',p_user_id,
    coalesce(nullif(btrim(p_reason_detail),''),p_reason_code),to_jsonb(v_row),v_row.id,left(p_request_id,128));
  if p_kind in ('suspension','ban') then
    update public.security_sessions set revoked_at=clock_timestamp(),revoke_reason='sanction'
     where user_id=p_user_id and revoked_at is null;
  end if;
  -- 0025：处罚透明 —— 把处罚编号写进通知 meta，本人可在「我的处罚」对照与申诉
  perform public.notify_moderation_event(v_row.user_id,
    jsonb_strip_nulls(jsonb_build_object(
      'sanctionId', v_row.id,
      'kind', v_row.kind,
      'reasonCode', v_row.reason_code,
      'endsAt', v_row.ends_at,
      'reportId', v_row.related_report_id)));
  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. 用户侧申诉与回执函数
-- ----------------------------------------------------------------------------

-- 8.1 提交申诉：appellant 只能是本人；目标必须属于本人；10–2000 字；
--     同一事项已有未结申诉 → 23505（服务端翻 409）。
drop function if exists public.api_submit_appeal(uuid, uuid, text);
create function public.api_submit_appeal(
  p_report_id uuid, p_sanction_id uuid, p_message text
) returns table (appeal_id uuid, status text, created_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_message text := btrim(coalesce(p_message, ''));
  v_row public.report_appeals;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if (p_report_id is not null) = (p_sanction_id is not null) then
    raise exception '申诉必须且只能指定一项对象（举报或处罚）' using errcode = '23514';
  end if;
  if char_length(v_message) < 10 or char_length(v_message) > 2000 then
    raise exception '申诉说明需 10–2000 字' using errcode = '23514';
  end if;

  if p_report_id is not null then
    if not exists (
      select 1 from public.reports r where r.id = p_report_id and r.reporter_id = v_uid
    ) then
      raise exception '举报不存在或不属于本人' using errcode = 'P0002';
    end if;
  else
    if not exists (
      select 1 from public.user_sanctions s where s.id = p_sanction_id and s.user_id = v_uid
    ) then
      raise exception '处罚不存在或不属于本人' using errcode = 'P0002';
    end if;
  end if;

  begin
    insert into public.report_appeals (report_id, sanction_id, appellant_id, message)
    values (p_report_id, p_sanction_id, v_uid, v_message)
    returning * into v_row;
  exception when unique_violation then
    raise exception '该事项已有未结申诉，请等待复核结果' using errcode = '23505';
  end;

  return query select v_row.id, v_row.status, v_row.created_at;
end;
$$;

-- 8.2 我的举报（含最新一条申诉状态，前端据此决定"申请复核"按钮是否可点）
drop function if exists public.api_my_reports();
create function public.api_my_reports()
returns table (
  id uuid,
  target_type text,
  target_id uuid,
  reason text,
  detail text,
  status text,
  resolution_code text,
  review_note text,
  appeal_status text,
  created_at timestamptz,
  resolved_at timestamptz
)
language plpgsql security definer stable
set search_path = pg_catalog, public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  return query
    select r.id,
           r.target_type,
           r.target_id,
           r.reason,
           r.detail,
           r.status,
           r.resolution_code,
           r.review_note,
           (select a.status
              from public.report_appeals a
             where a.report_id = r.id and a.appellant_id = v_uid
             order by a.created_at desc, a.id desc
             limit 1),
           r.created_at,
           r.resolved_at
      from public.reports r
     where r.reporter_id = v_uid
     order by r.created_at desc, r.id desc
     limit 200;
end;
$$;

-- 8.3 我的申诉
drop function if exists public.api_my_appeals();
create function public.api_my_appeals()
returns table (
  id uuid,
  report_id uuid,
  sanction_id uuid,
  message text,
  status text,
  review_note text,
  created_at timestamptz,
  reviewed_at timestamptz
)
language plpgsql security definer stable
set search_path = pg_catalog, public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  return query
    select a.id, a.report_id, a.sanction_id, a.message, a.status, a.review_note,
           a.created_at, a.reviewed_at
      from public.report_appeals a
     where a.appellant_id = v_uid
     order by a.created_at desc, a.id desc
     limit 200;
end;
$$;

-- 8.4 我的处罚（P0-18 处罚透明：原因、期限、状态、能否申诉）
drop function if exists public.api_my_sanctions();
create function public.api_my_sanctions()
returns table (
  id uuid,
  kind text,
  reason_code text,
  reason_detail text,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  revoked_at timestamptz,
  appeal_status text,
  created_at timestamptz
)
language plpgsql security definer stable
set search_path = pg_catalog, public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  return query
    select s.id,
           s.kind,
           s.reason_code,
           s.reason_detail,
           s.status,
           s.starts_at,
           s.ends_at,
           s.revoked_at,
           (select a.status
              from public.report_appeals a
             where a.sanction_id = s.id and a.appellant_id = v_uid
             order by a.created_at desc, a.id desc
             limit 1),
           s.created_at
      from public.user_sanctions s
     where s.user_id = v_uid
     order by s.created_at desc, s.id desc
     limit 200;
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. 管理端函数（内部再做 is_editor_or_admin 判定，不依赖路由层）
-- ----------------------------------------------------------------------------

-- 9.1 审核队列：举报 + 举报人 + 目标摘要（替代 repos 里直查 reports 的写法）
drop function if exists public.api_admin_list_reports(text);
create function public.api_admin_list_reports(p_status text default null)
returns table (
  id uuid,
  target_type text,
  target_id uuid,
  reason text,
  detail text,
  status text,
  assigned_to uuid,
  review_note text,
  resolution_code text,
  resolved_by uuid,
  reporter_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  resolved_at timestamptz,
  reporter jsonb,
  target jsonb
)
language plpgsql security definer stable
set search_path = pg_catalog, public
as $$
declare v_status text := nullif(btrim(coalesce(p_status, '')), '');
begin
  if not public.is_editor_or_admin() then
    raise exception '需要审核权限' using errcode = '42501';
  end if;
  if v_status is not null and v_status not in ('open', 'reviewing', 'upheld', 'rejected') then
    raise exception '举报状态不合法' using errcode = '22023';
  end if;

  return query
    select r.id, r.target_type, r.target_id, r.reason, r.detail, r.status,
           r.assigned_to, r.review_note, r.resolution_code, r.resolved_by, r.reporter_id,
           r.created_at, r.updated_at, r.resolved_at,
           (select jsonb_build_object('id', pr.id, 'username', pr.username::text,
                                      'displayName', pr.display_name)
              from public.profiles pr where pr.id = r.reporter_id),
           public.moderation_report_target(r.target_type, r.target_id, r.target_snapshot)
      from public.reports r
     where v_status is null or r.status = v_status
     order by r.created_at desc, r.id desc
     limit 100;
end;
$$;

-- 9.2 举报详情：举报 + 目标投影 + 该举报的全部审核审计
drop function if exists public.api_admin_report_detail(uuid);
create function public.api_admin_report_detail(p_report_id uuid)
returns table (
  id uuid,
  target_type text,
  target_id uuid,
  reason text,
  detail text,
  status text,
  assigned_to uuid,
  review_note text,
  resolution_code text,
  resolved_by uuid,
  reporter_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  resolved_at timestamptz,
  reporter jsonb,
  target jsonb,
  actions jsonb
)
language plpgsql security definer stable
set search_path = pg_catalog, public
as $$
begin
  if not public.is_editor_or_admin() then
    raise exception '需要审核权限' using errcode = '42501';
  end if;

  return query
    select r.id, r.target_type, r.target_id, r.reason, r.detail, r.status,
           r.assigned_to, r.review_note, r.resolution_code, r.resolved_by, r.reporter_id,
           r.created_at, r.updated_at, r.resolved_at,
           (select jsonb_build_object('id', pr.id, 'username', pr.username::text,
                                      'displayName', pr.display_name)
              from public.profiles pr where pr.id = r.reporter_id),
           public.moderation_report_target(r.target_type, r.target_id, r.target_snapshot),
           (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', ma.id,
                     'action', ma.action_type,
                     'actorId', ma.actor_id,
                     'targetType', ma.target_type,
                     'targetId', ma.target_id,
                     'reason', ma.reason,
                     'createdAt', ma.created_at)
                     order by ma.created_at, ma.id), '[]'::jsonb)
              from public.moderation_actions ma
             where ma.report_id = r.id)
      from public.reports r
     where r.id = p_report_id;

  if not found then
    raise exception '举报不存在' using errcode = 'P0002';
  end if;
end;
$$;

-- 9.3 处罚列表（管理端）：带上被处罚者资料与申诉状态
drop function if exists public.api_admin_list_sanctions(text);
create function public.api_admin_list_sanctions(p_status text default null)
returns table (
  id uuid,
  user_id uuid,
  kind text,
  reason_code text,
  reason_detail text,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  revoked_at timestamptz,
  appeal_status text,
  created_at timestamptz,
  username text,
  display_name text
)
language plpgsql security definer stable
set search_path = pg_catalog, public
as $$
declare v_status text := nullif(btrim(coalesce(p_status, '')), '');
begin
  if not public.is_editor_or_admin() then
    raise exception '需要审核权限' using errcode = '42501';
  end if;
  if v_status is not null and v_status not in ('active', 'revoked') then
    raise exception '处罚状态不合法' using errcode = '22023';
  end if;

  return query
    select s.id, s.user_id, s.kind, s.reason_code, s.reason_detail, s.status,
           s.starts_at, s.ends_at, s.revoked_at,
           (select a.status
              from public.report_appeals a
             where a.sanction_id = s.id
             order by a.created_at desc, a.id desc
             limit 1),
           s.created_at,
           coalesce(pr.username::text, ''),
           coalesce(pr.display_name, '')
      from public.user_sanctions s
      left join public.profiles pr on pr.id = s.user_id
     where v_status is null or s.status = v_status
     order by s.created_at desc, s.id desc
     limit 200;
end;
$$;

-- 9.4 申诉列表（管理端）：带上申诉人资料
drop function if exists public.api_admin_list_appeals(text);
create function public.api_admin_list_appeals(p_status text default null)
returns table (
  id uuid,
  report_id uuid,
  sanction_id uuid,
  message text,
  status text,
  review_note text,
  created_at timestamptz,
  reviewed_at timestamptz,
  appellant_id uuid,
  appellant_username text,
  appellant_display_name text
)
language plpgsql security definer stable
set search_path = pg_catalog, public
as $$
declare v_status text := nullif(btrim(coalesce(p_status, '')), '');
begin
  if not public.is_editor_or_admin() then
    raise exception '需要审核权限' using errcode = '42501';
  end if;
  if v_status is not null and v_status not in ('open', 'reviewing', 'upheld', 'rejected') then
    raise exception '申诉状态不合法' using errcode = '22023';
  end if;

  return query
    select a.id, a.report_id, a.sanction_id, a.message, a.status, a.review_note,
           a.created_at, a.reviewed_at,
           a.appellant_id,
           coalesce(pr.username::text, ''),
           coalesce(pr.display_name, '')
      from public.report_appeals a
      left join public.profiles pr on pr.id = a.appellant_id
     where v_status is null or a.status = v_status
     order by a.created_at desc, a.id desc
     limit 200;
end;
$$;

-- 9.5 申诉复核（P0-19）
--     upheld  = 申诉成立：撤销对应处罚（若仍生效）或恢复对应内容可见性；
--     rejected= 维持原判：
--     两种情况都在同一事务里写 moderation_actions(action_type='review_appeal')，
--     并给申诉人发系统通知（带 appealId/outcome）。
drop function if exists public.api_review_appeal(uuid, text, text, text);
create function public.api_review_appeal(
  p_appeal_id uuid, p_outcome text, p_note text, p_request_id text default null
) returns table (appeal_id uuid, status text, updated_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_note text := btrim(coalesce(p_note, ''));
  v_before public.report_appeals;
  v_after public.report_appeals;
  v_sanction_before public.user_sanctions;
  v_sanction_after public.user_sanctions;
  v_report public.reports;
  v_photo_before jsonb;
  v_comment_before jsonb;
  v_restored text := null;
  v_reason text;
begin
  if not public.is_editor_or_admin() then
    raise exception '需要审核权限' using errcode = '42501';
  end if;
  if p_outcome not in ('upheld', 'rejected') then
    raise exception '复核结论不合法' using errcode = '23514';
  end if;
  if char_length(v_note) > 2000 then
    raise exception '复核说明不能超过 2000 字' using errcode = '23514';
  end if;

  select * into v_before from public.report_appeals where id = p_appeal_id for update;
  if not found then
    raise exception '申诉不存在' using errcode = 'P0002';
  end if;
  if v_before.status not in ('open', 'reviewing') then
    raise exception '该申诉已复核完毕，不能重复处理' using errcode = '55000';
  end if;

  v_reason := left(coalesce(nullif(v_note, ''),
    case when p_outcome = 'upheld' then '申诉成立' else '维持原判' end), 1000);

  if p_outcome = 'upheld' then
    -- (a) 针对处罚的申诉：撤销处罚（同时满足 user_sanctions 的 revoked 三列约束）
    if v_before.sanction_id is not null then
      select * into v_sanction_before
        from public.user_sanctions where id = v_before.sanction_id for update;
      if v_sanction_before.status = 'active' then
        update public.user_sanctions
           set status = 'revoked',
               revoked_by = v_actor,
               revoked_at = clock_timestamp(),
               revoke_reason = left(coalesce(nullif(v_note, ''), '申诉成立，撤销处罚'), 500)
         where id = v_sanction_before.id
         returning * into v_sanction_after;
        insert into public.moderation_actions(report_id,actor_id,action_type,target_type,target_id,reason,before_state,after_state,sanction_id,request_id)
        values(v_sanction_before.related_report_id,v_actor,'revoke_sanction','user',v_sanction_before.user_id,
               v_reason,to_jsonb(v_sanction_before),to_jsonb(v_sanction_after),v_sanction_after.id,left(p_request_id,128));
        v_restored := 'sanction';
      end if;
    end if;

    -- (b) 针对举报的申诉：若目标内容因人被下架/隐藏，恢复可见性
    if v_before.report_id is not null then
      select * into v_report from public.reports where id = v_before.report_id;
      if found then
        if v_report.target_type = 'photo' then
          select to_jsonb(p) into v_photo_before
            from public.photos p where p.id = v_report.target_id and p.status = 'hidden' for update;
          if v_photo_before is not null then
            update public.photos set status = 'published' where id = v_report.target_id;
            insert into public.moderation_actions(report_id,actor_id,action_type,target_type,target_id,reason,before_state,after_state,request_id)
            values(v_report.id,v_actor,'restore_photo','photo',v_report.target_id,v_reason,
                   v_photo_before,jsonb_build_object('id',v_report.target_id,'status','published'),
                   left(p_request_id,128));
            v_restored := 'photo';
          end if;
        elsif v_report.target_type = 'comment' then
          select to_jsonb(c) into v_comment_before
            from public.comments c where c.id = v_report.target_id and c.status = 'hidden' for update;
          if v_comment_before is not null then
            update public.comments set status = 'visible' where id = v_report.target_id;
            insert into public.moderation_actions(report_id,actor_id,action_type,target_type,target_id,reason,before_state,after_state,request_id)
            values(v_report.id,v_actor,'restore_comment','comment',v_report.target_id,v_reason,
                   v_comment_before,jsonb_build_object('id',v_report.target_id,'status','visible'),
                   left(p_request_id,128));
            v_restored := 'comment';
          end if;
        end if;
      end if;
    end if;
  end if;

  update public.report_appeals
     set status = p_outcome,
         reviewer_id = v_actor,
         review_note = v_note,
         reviewed_at = clock_timestamp()
   where id = p_appeal_id
   returning * into v_after;

  -- 复核审计：target 指向"被申诉的事项"（报告型→report，处罚型→user），
  -- 申诉行本身放在 after_state.appeal 里，便于按举报/按用户串起完整时间线。
  insert into public.moderation_actions(report_id,actor_id,action_type,target_type,target_id,reason,before_state,after_state,sanction_id,request_id)
  values(v_after.report_id,v_actor,'review_appeal',
         case when v_after.report_id is not null then 'report' else 'user' end,
         coalesce(v_after.report_id, v_after.appellant_id),
         v_reason,
         to_jsonb(v_before),
         jsonb_build_object('appeal', to_jsonb(v_after), 'outcome', p_outcome, 'restored', v_restored),
         v_after.sanction_id,
         left(p_request_id,128));

  -- 结论通知（P0-17/P0-19）：告诉申诉人复核结果，避免"申诉后石沉大海"
  perform public.notify_moderation_event(v_after.appellant_id,
    jsonb_strip_nulls(jsonb_build_object(
      'appealId', v_after.id,
      'status', v_after.status,
      'outcome', p_outcome,
      'reportId', v_after.report_id,
      'sanctionId', v_after.sanction_id,
      'restored', v_restored)));

  return query select v_after.id, v_after.status, v_after.updated_at;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. 权限收口：先 revoke 再最小化 grant
-- ----------------------------------------------------------------------------
revoke all on function public.notify_moderation_event(uuid, jsonb) from public, app_user;
revoke all on function public.moderation_report_target(text, uuid, jsonb) from public, app_user;

revoke all on function public.api_list_notifications(integer, timestamptz, uuid) from public, app_user;
grant execute on function public.api_list_notifications(integer, timestamptz, uuid) to app_user;

revoke all on function public.api_resolve_report(uuid, text, text, text, text) from public, app_user;
grant execute on function public.api_resolve_report(uuid, text, text, text, text) to app_user;

revoke all on function public.api_apply_sanction(uuid, text, text, text, timestamptz, uuid, text) from public, app_user;
grant execute on function public.api_apply_sanction(uuid, text, text, text, timestamptz, uuid, text) to app_user;

revoke all on function public.api_submit_appeal(uuid, uuid, text) from public, app_user;
grant execute on function public.api_submit_appeal(uuid, uuid, text) to app_user;

revoke all on function public.api_my_reports() from public, app_user;
grant execute on function public.api_my_reports() to app_user;

revoke all on function public.api_my_appeals() from public, app_user;
grant execute on function public.api_my_appeals() to app_user;

revoke all on function public.api_my_sanctions() from public, app_user;
grant execute on function public.api_my_sanctions() to app_user;

revoke all on function public.api_admin_list_reports(text) from public, app_user;
grant execute on function public.api_admin_list_reports(text) to app_user;

revoke all on function public.api_admin_report_detail(uuid) from public, app_user;
grant execute on function public.api_admin_report_detail(uuid) to app_user;

revoke all on function public.api_admin_list_sanctions(text) from public, app_user;
grant execute on function public.api_admin_list_sanctions(text) to app_user;

revoke all on function public.api_admin_list_appeals(text) from public, app_user;
grant execute on function public.api_admin_list_appeals(text) to app_user;

revoke all on function public.api_review_appeal(uuid, text, text, text) from public, app_user;
grant execute on function public.api_review_appeal(uuid, text, text, text) to app_user;

-- ----------------------------------------------------------------------------
-- 11. 自检：迁移必须把安全边界真正落地
-- ----------------------------------------------------------------------------
do $$
declare
  v_priv text;
  r record;
  v_expected text[] := array[
    'api_list_notifications', 'api_resolve_report', 'api_apply_sanction',
    'api_submit_appeal', 'api_my_reports', 'api_my_appeals', 'api_my_sanctions',
    'api_admin_list_reports', 'api_admin_report_detail',
    'api_admin_list_sanctions', 'api_admin_list_appeals', 'api_review_appeal'
  ];
begin
  -- 11.1 新表必须开 RLS 且没有 policy（只能经 definer 函数访问）
  if not (select relrowsecurity from pg_class where oid = 'public.report_appeals'::regclass) then
    raise exception '0025 自检失败：report_appeals 未开启 RLS';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'report_appeals') then
    raise exception '0025 自检失败：report_appeals 不应有 policy';
  end if;

  -- 11.2 app_user 不得有任何 report_appeals 表级权限
  foreach v_priv in array array['select', 'insert', 'update', 'delete'] loop
    if has_table_privilege('app_user', 'public.report_appeals', v_priv) then
      raise exception '0025 自检失败：app_user 拥有 report_appeals 的 % 权限', v_priv;
    end if;
  end loop;

  -- 11.3 moderation_actions 词表必须已含 review_appeal
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.moderation_actions'::regclass
       and conname = 'ck_moderation_actions_action_type'
  ) then
    raise exception '0025 自检失败：缺少 ck_moderation_actions_action_type';
  end if;

  -- 11.4 所有对外函数：security definer + search_path + PUBLIC 不可执行 + app_user 可执行
  for r in
    select p.oid, p.proname, p.prosecdef, coalesce(p.proconfig, array[]::text[]) as config
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (v_expected)
  loop
    if not r.prosecdef then
      raise exception '0025 自检失败：% 不是 security definer', r.proname;
    end if;
    if not exists (select 1 from unnest(r.config) c where c like 'search_path=%') then
      raise exception '0025 自检失败：% 未固定 search_path', r.proname;
    end if;
    if has_function_privilege('public', r.oid, 'execute') then
      raise exception '0025 自检失败：PUBLIC 不应能执行 %', r.proname;
    end if;
    if not has_function_privilege('app_user', r.oid, 'execute') then
      raise exception '0025 自检失败：app_user 应能执行 %', r.proname;
    end if;
  end loop;

  -- 11.5 内部助手不得对 app_user 开放
  if has_function_privilege('app_user', 'public.notify_moderation_event(uuid, jsonb)', 'execute')
     or has_function_privilege('app_user', 'public.moderation_report_target(text, uuid, jsonb)', 'execute') then
    raise exception '0025 自检失败：内部助手函数不应开放给 app_user';
  end if;

  raise notice 'OK: 0025 举报回执、处罚可见与申诉闭环迁移自检通过';
end;
$$;
