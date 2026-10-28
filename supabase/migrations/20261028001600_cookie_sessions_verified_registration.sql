\encoding UTF8
-- 工科影展 · 0016 Cookie 会话与手机号验证注册
-- 修复 0015 rotate 失败分支的事务回滚问题，并把「消费注册验证码 + 开户」收口为单事务。

drop function if exists public.api_rotate_session(uuid,text,text,timestamptz,text,text);
create function public.api_rotate_session(
  p_session_id uuid, p_refresh_token_hash text, p_new_refresh_token_hash text,
  p_new_expires_at timestamptz, p_user_agent text default null, p_ip_hash text default null
) returns table(ok boolean, reason text, session_id uuid, family_id uuid, user_id uuid, expires_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare v_old public.security_sessions; v_allowed boolean; v_new uuid; v_exp timestamptz;
begin
  select * into v_old from public.security_sessions where id = p_session_id for update;
  if not found then
    return query select false,'invalid'::text,null::uuid,null::uuid,null::uuid,null::timestamptz;
    return;
  end if;
  if v_old.refresh_token_hash <> p_refresh_token_hash or v_old.revoked_at is not null or v_old.expires_at <= now() then
    update public.security_sessions set revoked_at=coalesce(revoked_at,clock_timestamp()),
      revoke_reason=coalesce(revoke_reason,'reuse_detected')
      where family_id=v_old.family_id and revoked_at is null;
    return query select false,'reuse_detected'::text,null::uuid,v_old.family_id,v_old.user_id,null::timestamptz;
    return;
  end if;
  select s.allowed into v_allowed from public.api_account_access_state(v_old.user_id) s;
  if not coalesce(v_allowed,false) then
    update public.security_sessions set revoked_at=clock_timestamp(),revoke_reason='sanction'
      where family_id=v_old.family_id and revoked_at is null;
    return query select false,'sanction'::text,null::uuid,v_old.family_id,v_old.user_id,null::timestamptz;
    return;
  end if;
  if p_new_expires_at <= now() then
    return query select false,'expiry'::text,null::uuid,v_old.family_id,v_old.user_id,null::timestamptz;
    return;
  end if;
  update public.security_sessions set revoked_at=clock_timestamp(),revoke_reason='rotated',last_seen_at=clock_timestamp()
    where id=v_old.id;
  insert into public.security_sessions(user_id,family_id,refresh_token_hash,expires_at,user_agent,ip_hash)
    values(v_old.user_id,v_old.family_id,p_new_refresh_token_hash,p_new_expires_at,left(p_user_agent,512),left(p_ip_hash,128))
    returning id,security_sessions.expires_at into v_new,v_exp;
  update public.security_sessions set replaced_by=v_new where id=v_old.id;
  return query select true,null::text,v_new,v_old.family_id,v_old.user_id,v_exp;
end;
$$;

create or replace function public.api_register_verified_account(
  p_username text, p_display_name text, p_password_hash text, p_phone text,
  p_code_id uuid, p_code_hash text, p_terms_version text, p_privacy_version text,
  p_ip_hash text default null, p_user_agent text default null
) returns table(ok boolean, reason text, user_id uuid, user_name text, display_name text, user_role text, phone text)
language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare v_code public.phone_verifications; v_user uuid; v_name text; v_display text; v_role text; v_phone text;
begin
  select * into v_code from public.phone_verifications where id=p_code_id for update;
  if not found or v_code.phone<>p_phone or v_code.purpose<>'register' or v_code.consumed_at is not null then
    return query select false,'invalid_code'::text,null::uuid,null::text,null::text,null::text,null::text; return;
  end if;
  if v_code.expires_at<=now() then
    update public.phone_verifications set consumed_at=coalesce(consumed_at,clock_timestamp()) where id=p_code_id;
    return query select false,'expired'::text,null::uuid,null::text,null::text,null::text,null::text; return;
  end if;
  if v_code.attempt_count>=5 then
    update public.phone_verifications set consumed_at=coalesce(consumed_at,clock_timestamp()) where id=p_code_id;
    return query select false,'locked'::text,null::uuid,null::text,null::text,null::text,null::text; return;
  end if;
  if v_code.code_hash<>p_code_hash then
    update public.phone_verifications
      set attempt_count=attempt_count+1,
          consumed_at=case when attempt_count+1>=5 then clock_timestamp() else consumed_at end
      where id=p_code_id;
    return query select false,case when v_code.attempt_count+1>=5 then 'locked' else 'mismatch' end,
      null::uuid,null::text,null::text,null::text,null::text; return;
  end if;

  select r.user_id,r.user_name,r.display_name,r.user_role,r.phone
    into v_user,v_name,v_display,v_role,v_phone
    from public.api_register_account(p_username,p_display_name,p_password_hash,p_phone) r;
  update public.phone_verifications set consumed_at=clock_timestamp() where id=p_code_id;
  update public.profiles set phone_verified_at=coalesce(phone_verified_at,clock_timestamp()) where id=v_user;
  insert into public.legal_consents(user_id,document_type,document_version,ip_hash,user_agent,evidence)
    values
      (v_user,'terms',p_terms_version,left(p_ip_hash,128),left(p_user_agent,512),jsonb_build_object('source','registration')),
      (v_user,'privacy',p_privacy_version,left(p_ip_hash,128),left(p_user_agent,512),jsonb_build_object('source','registration'));
  return query select true,null::text,v_user,v_name,v_display,v_role,v_phone;
end;
$$;

revoke all on function public.api_rotate_session(uuid,text,text,timestamptz,text,text) from public;
revoke all on function public.api_register_verified_account(text,text,text,text,uuid,text,text,text,text,text) from public;
grant execute on function public.api_rotate_session(uuid,text,text,timestamptz,text,text) to app_user;
grant execute on function public.api_register_verified_account(text,text,text,text,uuid,text,text,text,text,text) to app_user;

-- Cookie secret 校验需要按 id 取单行；只向应用返回单个哈希，禁止表级 SELECT。
create or replace function public.api_get_session_for_auth(p_session_id uuid)
returns table(session_id uuid,user_id uuid,refresh_token_hash text,expires_at timestamptz)
language sql stable security definer
set search_path = pg_catalog, public, auth
as $$
  select s.id,s.user_id,s.refresh_token_hash,s.expires_at
    from public.security_sessions s where s.id=p_session_id;
$$;
revoke all on function public.api_get_session_for_auth(uuid) from public;
grant execute on function public.api_get_session_for_auth(uuid) to app_user;

do $$ begin
  if not has_function_privilege('app_user','public.api_register_verified_account(text,text,text,text,uuid,text,text,text,text,text)','EXECUTE') then
    raise exception '0016 自检失败：app_user 无注册函数执行权';
  end if;
  raise notice 'OK: 0016 Cookie 会话与手机号验证注册迁移自检通过';
end $$;
