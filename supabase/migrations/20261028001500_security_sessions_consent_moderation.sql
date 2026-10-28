\encoding UTF8
-- 工科影展 · 0015 安全会话、法律同意与内容治理
-- 身份与权限均以 auth.uid() / profiles 实时状态为准；敏感表只经 SECURITY DEFININER 函数写入。

-- ---------------------------------------------------------------------------
-- 1. 会话、同意、处罚与不可变审计
-- ---------------------------------------------------------------------------
create table if not exists public.security_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  family_id uuid not null default gen_random_uuid(),
  refresh_token_hash text not null unique check (char_length(refresh_token_hash) between 43 and 128),
  user_agent text check (user_agent is null or char_length(user_agent) <= 512),
  ip_hash text check (ip_hash is null or char_length(ip_hash) <= 128),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason is null or revoke_reason in
    ('logout','logout_all','password_changed','sanction','rotated','reuse_detected','admin')),
  replaced_by uuid references public.security_sessions(id) on delete set null,
  check (expires_at > created_at),
  check ((revoked_at is null and revoke_reason is null) or (revoked_at is not null and revoke_reason is not null))
);
create index if not exists idx_security_sessions_user_active
  on public.security_sessions(user_id, expires_at desc) where revoked_at is null;
create index if not exists idx_security_sessions_family_active
  on public.security_sessions(family_id, expires_at desc) where revoked_at is null;

create table if not exists public.legal_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_type text not null check (document_type in ('terms','privacy','community')),
  document_version text not null check (char_length(document_version) between 1 and 64),
  accepted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  ip_hash text check (ip_hash is null or char_length(ip_hash) <= 128),
  user_agent text check (user_agent is null or char_length(user_agent) <= 512),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object')
);
create unique index if not exists uq_legal_consents_active_version
  on public.legal_consents(user_id, document_type, document_version)
  where withdrawn_at is null;
create index if not exists idx_legal_consents_user_doc
  on public.legal_consents(user_id, document_type, accepted_at desc);

create table if not exists public.user_sanctions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('warning','content_restriction','suspension','ban')),
  reason_code text not null check (char_length(reason_code) between 1 and 64),
  reason_detail text not null default '' check (char_length(reason_detail) <= 1000),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  status text not null default 'active' check (status in ('active','revoked')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason is null or char_length(revoke_reason) <= 500),
  related_report_id uuid references public.reports(id) on delete set null,
  check (ends_at is null or ends_at > starts_at),
  check (
    (status = 'active' and revoked_at is null and revoked_by is null and revoke_reason is null)
    or (status = 'revoked' and revoked_at is not null and revoke_reason is not null)
  )
);
create index if not exists idx_user_sanctions_active
  on public.user_sanctions(user_id, starts_at desc, ends_at) where status = 'active';

alter table public.reports add column if not exists assigned_to uuid references public.profiles(id) on delete set null;
alter table public.reports add column if not exists review_note text not null default '';
alter table public.reports add column if not exists resolution_code text;
alter table public.reports add column if not exists resolved_by uuid references public.profiles(id) on delete set null;
alter table public.reports add column if not exists updated_at timestamptz not null default now();
alter table public.reports add column if not exists target_snapshot jsonb not null default '{}'::jsonb;
alter table public.reports drop constraint if exists ck_reports_review_note_len;
alter table public.reports add constraint ck_reports_review_note_len check (char_length(review_note) <= 2000);
alter table public.reports drop constraint if exists ck_reports_resolution_code;
alter table public.reports add constraint ck_reports_resolution_code check (resolution_code is null or resolution_code in
  ('no_violation','content_hidden','content_removed','user_warned','user_suspended','user_banned','duplicate','other'));
alter table public.reports drop constraint if exists ck_reports_resolution_state;
alter table public.reports add constraint ck_reports_resolution_state check (
  (status in ('open','reviewing') and resolved_at is null and resolved_by is null)
  or (status in ('upheld','rejected') and resolved_at is not null and resolved_by is not null)
);
create index if not exists idx_reports_queue on public.reports(status, created_at desc, id desc);
create index if not exists idx_reports_assignee on public.reports(assigned_to, status, created_at desc);

drop trigger if exists trg_reports_updated_at on public.reports;
create trigger trg_reports_updated_at before update on public.reports
  for each row execute function public.set_updated_at();

create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.reports(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  action_type text not null check (action_type in
    ('claim_report','uphold_report','reject_report','hide_photo','restore_photo','hide_comment','restore_comment',
     'warn_user','restrict_user','suspend_user','ban_user','revoke_sanction')),
  target_type text not null check (target_type in ('report','photo','comment','profile','user')),
  target_id uuid not null,
  reason text not null check (char_length(reason) between 1 and 1000),
  before_state jsonb not null default '{}'::jsonb check (jsonb_typeof(before_state) = 'object'),
  after_state jsonb not null default '{}'::jsonb check (jsonb_typeof(after_state) = 'object'),
  sanction_id uuid references public.user_sanctions(id) on delete set null,
  request_id text check (request_id is null or char_length(request_id) <= 128),
  created_at timestamptz not null default now()
);
create index if not exists idx_moderation_actions_report on public.moderation_actions(report_id, created_at);
create index if not exists idx_moderation_actions_target on public.moderation_actions(target_type, target_id, created_at desc);
create index if not exists idx_moderation_actions_actor on public.moderation_actions(actor_id, created_at desc);

create or replace function public.reject_moderation_action_mutation()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  raise exception '审核日志不可修改或删除' using errcode = '42501';
end;
$$;
drop trigger if exists trg_moderation_actions_immutable on public.moderation_actions;
create trigger trg_moderation_actions_immutable before update or delete on public.moderation_actions
  for each row execute function public.reject_moderation_action_mutation();

alter table public.security_sessions enable row level security;
alter table public.legal_consents enable row level security;
alter table public.user_sanctions enable row level security;
alter table public.moderation_actions enable row level security;

drop policy if exists p_legal_consents_select_own on public.legal_consents;
create policy p_legal_consents_select_own on public.legal_consents
  for select using (user_id = auth.uid());

-- 修复旧策略：编辑不能通过修改自己 profile 把自己提升为 admin。
drop policy if exists p_profiles_update on public.profiles;
create policy p_profiles_update on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = public.current_role_name());

-- 举报必须登录；不允许直接改整行，状态流转只走受控函数。
drop policy if exists p_reports_insert on public.reports;
create policy p_reports_insert on public.reports
  for insert with check (auth.uid() is not null and reporter_id = auth.uid());
drop policy if exists p_reports_update on public.reports;

-- ---------------------------------------------------------------------------
-- 2. 权威账号状态与可撤销会话
-- ---------------------------------------------------------------------------
create or replace function public.api_account_access_state(p_user_id uuid)
returns table(allowed boolean, reason text, sanction_id uuid, ends_at timestamptz)
language sql stable security definer
set search_path = pg_catalog, public, auth
as $$
  with blocker as (
    select s.id, s.kind, s.ends_at
      from public.user_sanctions s
     where s.user_id = p_user_id
       and s.status = 'active'
       and s.starts_at <= now()
       and (s.ends_at is null or s.ends_at > now())
       and s.kind in ('suspension','ban')
     order by case s.kind when 'ban' then 0 else 1 end, s.created_at desc
     limit 1
  )
  select
    p.id is not null and p.deleted_at is null and b.id is null,
    case when p.id is null or p.deleted_at is not null then 'deleted'
         when b.kind is not null then b.kind else null end,
    b.id,
    b.ends_at
  from (select p.id, p.deleted_at from public.profiles p where p.id = p_user_id) p
  full join blocker b on true;
$$;

create or replace function public.api_create_session(
  p_user_id uuid, p_refresh_token_hash text, p_expires_at timestamptz,
  p_user_agent text default null, p_ip_hash text default null
) returns table(session_id uuid, family_id uuid, expires_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare v_allowed boolean; v_id uuid; v_family uuid; v_exp timestamptz;
begin
  select s.allowed into v_allowed from public.api_account_access_state(p_user_id) s;
  if not coalesce(v_allowed, false) then raise exception '账号当前不可登录' using errcode = '42501'; end if;
  if p_expires_at <= now() then raise exception '会话有效期不合法' using errcode = '23514'; end if;
  insert into public.security_sessions(user_id, refresh_token_hash, expires_at, user_agent, ip_hash)
  values(p_user_id, p_refresh_token_hash, p_expires_at, left(p_user_agent,512), left(p_ip_hash,128))
  returning id, security_sessions.family_id, security_sessions.expires_at into v_id, v_family, v_exp;
  return query select v_id, v_family, v_exp;
end;
$$;

create or replace function public.api_rotate_session(
  p_session_id uuid, p_refresh_token_hash text, p_new_refresh_token_hash text,
  p_new_expires_at timestamptz, p_user_agent text default null, p_ip_hash text default null
) returns table(session_id uuid, family_id uuid, user_id uuid, expires_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare v_old public.security_sessions; v_allowed boolean; v_new uuid; v_exp timestamptz;
begin
  select * into v_old from public.security_sessions where id = p_session_id for update;
  if not found or v_old.refresh_token_hash <> p_refresh_token_hash or v_old.revoked_at is not null or v_old.expires_at <= now() then
    if found then
      update public.security_sessions set revoked_at = coalesce(revoked_at, clock_timestamp()), revoke_reason = coalesce(revoke_reason,'reuse_detected')
       where family_id = v_old.family_id and revoked_at is null;
    end if;
    raise exception '刷新会话无效或已被复用' using errcode = '42501';
  end if;
  select s.allowed into v_allowed from public.api_account_access_state(v_old.user_id) s;
  if not coalesce(v_allowed,false) then
    update public.security_sessions set revoked_at=clock_timestamp(), revoke_reason='sanction'
     where family_id=v_old.family_id and revoked_at is null;
    raise exception '账号当前不可访问' using errcode='42501';
  end if;
  update public.security_sessions set revoked_at=clock_timestamp(), revoke_reason='rotated', last_seen_at=clock_timestamp()
   where id=v_old.id;
  insert into public.security_sessions(user_id,family_id,refresh_token_hash,expires_at,user_agent,ip_hash)
  values(v_old.user_id,v_old.family_id,p_new_refresh_token_hash,p_new_expires_at,left(p_user_agent,512),left(p_ip_hash,128))
  returning id, security_sessions.expires_at into v_new,v_exp;
  update public.security_sessions set replaced_by=v_new where id=v_old.id;
  return query select v_new,v_old.family_id,v_old.user_id,v_exp;
end;
$$;

create or replace function public.api_session_is_active(p_session_id uuid, p_user_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, auth
as $$
  select exists(select 1 from public.security_sessions s
    where s.id=p_session_id and s.user_id=p_user_id and s.revoked_at is null and s.expires_at>now())
    and coalesce((select a.allowed from public.api_account_access_state(p_user_id) a),false);
$$;

create or replace function public.api_revoke_session(p_session_id uuid, p_user_id uuid)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
begin
  update public.security_sessions set revoked_at=clock_timestamp(), revoke_reason='logout'
   where id=p_session_id and user_id=p_user_id and revoked_at is null;
  return found;
end;
$$;

create or replace function public.api_revoke_my_sessions()
returns integer language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare v_count integer; v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception '请先登录' using errcode='42501'; end if;
  update public.security_sessions set revoked_at=clock_timestamp(),revoke_reason='logout_all'
   where user_id=v_user and revoked_at is null;
  get diagnostics v_count=row_count; return v_count;
end;
$$;

-- 改密同时撤销所有会话，修复旧函数只改密码、旧令牌仍有效的问题。
create or replace function public.api_set_password(p_user_id uuid, p_password_hash text)
returns void language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if p_user_id is null or p_password_hash is null or char_length(p_password_hash) not between 20 and 255 then
    raise exception '密码参数不合法' using errcode='23514';
  end if;
  update auth.users set password_hash=p_password_hash where id=p_user_id;
  if not found then raise exception '账号不存在' using errcode='P0002'; end if;
  update public.security_sessions set revoked_at=clock_timestamp(),revoke_reason='password_changed'
   where user_id=p_user_id and revoked_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. 同意记录与内容治理函数
-- ---------------------------------------------------------------------------
create or replace function public.api_record_legal_consent(
  p_document_type text, p_document_version text, p_ip_hash text default null,
  p_user_agent text default null, p_evidence jsonb default '{}'::jsonb
) returns public.legal_consents language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare v_user uuid:=auth.uid(); v_row public.legal_consents;
begin
  if v_user is null then raise exception '请先登录' using errcode='42501'; end if;
  insert into public.legal_consents(user_id,document_type,document_version,ip_hash,user_agent,evidence)
  values(v_user,p_document_type,btrim(p_document_version),left(p_ip_hash,128),left(p_user_agent,512),coalesce(p_evidence,'{}'::jsonb))
  on conflict (user_id,document_type,document_version) where withdrawn_at is null
  do update set document_version=excluded.document_version
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.api_withdraw_legal_consent(p_consent_id uuid)
returns timestamptz language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare v_at timestamptz;
begin
  update public.legal_consents set withdrawn_at=clock_timestamp()
   where id=p_consent_id and user_id=auth.uid() and withdrawn_at is null
   returning withdrawn_at into v_at;
  if not found then raise exception '同意记录不存在' using errcode='P0002'; end if;
  return v_at;
end;
$$;

create or replace function public.api_submit_report(
  p_target_type text, p_target_id uuid, p_reason text, p_detail text default ''
) returns public.reports language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare v_user uuid:=auth.uid(); v_snapshot jsonb; v_row public.reports;
begin
  if v_user is null then raise exception '请先登录' using errcode='42501'; end if;
  if p_target_type='photo' then
    select jsonb_build_object('title',title,'authorId',author_id,'status',status) into v_snapshot
      from public.photos where id=p_target_id;
  elsif p_target_type='comment' then
    select jsonb_build_object('body',body,'authorId',author_id,'photoId',photo_id,'status',status) into v_snapshot
      from public.comments where id=p_target_id;
  elsif p_target_type='profile' then
    select jsonb_build_object('username',username::text,'role',role,'deleted',deleted_at is not null) into v_snapshot
      from public.profiles where id=p_target_id;
  else raise exception '举报目标类型不合法' using errcode='23514'; end if;
  if v_snapshot is null then raise exception '举报目标不存在' using errcode='P0002'; end if;
  insert into public.reports(target_type,target_id,reason,detail,reporter_id,target_snapshot)
  values(p_target_type,p_target_id,p_reason,btrim(coalesce(p_detail,'')),v_user,v_snapshot)
  on conflict (coalesce(reporter_id,'00000000-0000-0000-0000-000000000000'::uuid),target_type,target_id)
    where status in ('open','reviewing')
  do update set updated_at=public.reports.updated_at
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.api_claim_report(p_report_id uuid, p_request_id text default null)
returns public.reports language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare v_actor uuid:=auth.uid(); v_before public.reports; v_after public.reports;
begin
  if not public.is_editor_or_admin() then raise exception '需要审核权限' using errcode='42501'; end if;
  select * into v_before from public.reports where id=p_report_id for update;
  if not found then raise exception '举报不存在' using errcode='P0002'; end if;
  if v_before.status not in ('open','reviewing') then raise exception '举报已结案' using errcode='P0003'; end if;
  if v_before.assigned_to is not null and v_before.assigned_to<>v_actor then raise exception '举报已由其他审核员认领' using errcode='P0003'; end if;
  update public.reports set status='reviewing',assigned_to=v_actor where id=p_report_id returning * into v_after;
  if v_before.assigned_to is null then
    insert into public.moderation_actions(report_id,actor_id,action_type,target_type,target_id,reason,before_state,after_state,request_id)
    values(p_report_id,v_actor,'claim_report','report',p_report_id,'认领举报',to_jsonb(v_before),to_jsonb(v_after),left(p_request_id,128));
  end if;
  return v_after;
end;
$$;

create or replace function public.api_set_content_visibility(
  p_target_type text, p_target_id uuid, p_hidden boolean, p_reason text,
  p_report_id uuid default null, p_request_id text default null
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare v_actor uuid:=auth.uid(); v_before jsonb; v_after jsonb; v_action text;
begin
  if not public.is_editor_or_admin() then raise exception '需要审核权限' using errcode='42501'; end if;
  if char_length(btrim(coalesce(p_reason,'')))<1 then raise exception '必须填写审核原因' using errcode='23514'; end if;
  if p_target_type='photo' then
    select to_jsonb(p) into v_before from public.photos p where id=p_target_id for update;
    if v_before is null then raise exception '作品不存在' using errcode='P0002'; end if;
    update public.photos set status=case when p_hidden then 'hidden' else 'published' end
     where id=p_target_id and status=case when p_hidden then 'published' else 'hidden' end;
    if not found then raise exception '作品状态不允许该操作' using errcode='P0003'; end if;
    select to_jsonb(p) into v_after from public.photos p where id=p_target_id;
    v_action:=case when p_hidden then 'hide_photo' else 'restore_photo' end;
  elsif p_target_type='comment' then
    select to_jsonb(c) into v_before from public.comments c where id=p_target_id for update;
    if v_before is null then raise exception '评论不存在' using errcode='P0002'; end if;
    update public.comments set status=case when p_hidden then 'hidden' else 'visible' end
     where id=p_target_id and status=case when p_hidden then 'visible' else 'hidden' end;
    if not found then raise exception '评论状态不允许该操作' using errcode='P0003'; end if;
    select to_jsonb(c) into v_after from public.comments c where id=p_target_id;
    v_action:=case when p_hidden then 'hide_comment' else 'restore_comment' end;
  else raise exception '内容类型不合法' using errcode='23514'; end if;
  insert into public.moderation_actions(report_id,actor_id,action_type,target_type,target_id,reason,before_state,after_state,request_id)
  values(p_report_id,v_actor,v_action,p_target_type,p_target_id,btrim(p_reason),v_before,v_after,left(p_request_id,128));
  return p_target_id;
end;
$$;

create or replace function public.api_apply_sanction(
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
  return v_row;
end;
$$;

create or replace function public.api_revoke_sanction(
  p_sanction_id uuid, p_reason text, p_request_id text default null
) returns public.user_sanctions language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare v_actor uuid:=auth.uid(); v_before public.user_sanctions; v_after public.user_sanctions;
begin
  if public.current_role_name()<>'admin' then raise exception '仅管理员可撤销处罚' using errcode='42501'; end if;
  select * into v_before from public.user_sanctions where id=p_sanction_id for update;
  if not found then raise exception '处罚不存在' using errcode='P0002'; end if;
  if v_before.status<>'active' then raise exception '处罚已失效' using errcode='P0003'; end if;
  update public.user_sanctions set status='revoked',revoked_by=v_actor,revoked_at=clock_timestamp(),revoke_reason=btrim(p_reason)
   where id=p_sanction_id returning * into v_after;
  insert into public.moderation_actions(report_id,actor_id,action_type,target_type,target_id,reason,before_state,after_state,sanction_id,request_id)
  values(v_before.related_report_id,v_actor,'revoke_sanction','user',v_before.user_id,btrim(p_reason),to_jsonb(v_before),to_jsonb(v_after),v_after.id,left(p_request_id,128));
  return v_after;
end;
$$;

create or replace function public.api_resolve_report(
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
  return v_after;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. 权限收口与迁移自检
-- ---------------------------------------------------------------------------
revoke all on public.security_sessions, public.legal_consents, public.user_sanctions, public.moderation_actions from public, app_user;
revoke update on public.reports from app_user;
grant select on public.legal_consents to app_user;

revoke all on function public.reject_moderation_action_mutation() from public, app_user;
revoke all on function public.api_account_access_state(uuid) from public;
revoke all on function public.api_create_session(uuid,text,timestamptz,text,text) from public;
revoke all on function public.api_rotate_session(uuid,text,text,timestamptz,text,text) from public;
revoke all on function public.api_session_is_active(uuid,uuid) from public;
revoke all on function public.api_revoke_session(uuid,uuid) from public;
revoke all on function public.api_revoke_my_sessions() from public;
revoke all on function public.api_record_legal_consent(text,text,text,text,jsonb) from public;
revoke all on function public.api_withdraw_legal_consent(uuid) from public;
revoke all on function public.api_submit_report(text,uuid,text,text) from public;
revoke all on function public.api_claim_report(uuid,text) from public;
revoke all on function public.api_set_content_visibility(text,uuid,boolean,text,uuid,text) from public;
revoke all on function public.api_apply_sanction(uuid,text,text,text,timestamptz,uuid,text) from public;
revoke all on function public.api_revoke_sanction(uuid,text,text) from public;
revoke all on function public.api_resolve_report(uuid,text,text,text,text) from public;

grant execute on function public.api_account_access_state(uuid) to app_user;
grant execute on function public.api_create_session(uuid,text,timestamptz,text,text) to app_user;
grant execute on function public.api_rotate_session(uuid,text,text,timestamptz,text,text) to app_user;
grant execute on function public.api_session_is_active(uuid,uuid) to app_user;
grant execute on function public.api_revoke_session(uuid,uuid) to app_user;
grant execute on function public.api_revoke_my_sessions() to app_user;
grant execute on function public.api_record_legal_consent(text,text,text,text,jsonb) to app_user;
grant execute on function public.api_withdraw_legal_consent(uuid) to app_user;
grant execute on function public.api_submit_report(text,uuid,text,text) to app_user;
grant execute on function public.api_claim_report(uuid,text) to app_user;
grant execute on function public.api_set_content_visibility(text,uuid,boolean,text,uuid,text) to app_user;
grant execute on function public.api_apply_sanction(uuid,text,text,text,timestamptz,uuid,text) to app_user;
grant execute on function public.api_revoke_sanction(uuid,text,text) to app_user;
grant execute on function public.api_resolve_report(uuid,text,text,text,text) to app_user;

do $$
begin
  if has_table_privilege('app_user','public.security_sessions','select') then
    raise exception '自检失败：app_user 不应直读 security_sessions';
  end if;
  if has_table_privilege('app_user','public.moderation_actions','insert') then
    raise exception '自检失败：app_user 不应直写 moderation_actions';
  end if;
  if has_table_privilege('app_user','public.reports','update') then
    raise exception '自检失败：app_user 不应直接更新 reports';
  end if;
  if has_function_privilege('public','public.api_apply_sanction(uuid,text,text,text,timestamptz,uuid,text)','execute') then
    raise exception '自检失败：PUBLIC 不应能执行处罚函数';
  end if;
  raise notice 'OK: 0015 安全会话、法律同意与内容治理迁移自检通过';
end;
$$;
