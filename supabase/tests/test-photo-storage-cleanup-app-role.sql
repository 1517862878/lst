-- ============================================================================
-- 图片清理队列的 app_user 调用边界回归
-- 用法：psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d <fresh-db> \
--       -f supabase/test-photo-storage-cleanup-app-role.sql
-- 前提：全部 migrations 已执行。
--
-- 为什么必须以 app_user 身份跑：
--   0020 把队列表从 app_user 完全收回，而真实服务端 worker 用的就是 app_user
--   （server/src/lib/db.ts 只有一个连接池，PGUSER 默认 app_user）。
--   以管理员身份写的断言无论队列是否可用都会通过 —— 那正是这个缺陷最初漏掉的原因。
-- ============================================================================
\set ON_ERROR_STOP on

begin;

-- ---- 夹具：作者 + 一件已发布作品（与 test-photo-owner-api.sql 同一套写法） ----
insert into auth.users (id, email, raw_user_meta_data) values
  ('d4000000-0000-0000-0000-000000000004', 'cleanup-owner@test.local', '{"display_name":"Cleanup Owner"}')
on conflict (id) do nothing;

insert into public.profiles (id, username, display_name)
values ('d4000000-0000-0000-0000-000000000004', 'cleanup_owner', 'Cleanup Owner')
on conflict (id) do nothing;

insert into public.photos (
  id, author_id, title, category_slug, image_key, thumb_key, width, height, status, published_at
) values (
  'e5000000-0000-0000-0000-000000000005',
  'd4000000-0000-0000-0000-000000000004',
  '清理队列夹具', 'landscape',
  'photos/d4000000-0000-0000-0000-000000000004/e5000000-0000-0000-0000-000000000005/display.webp',
  'photos/d4000000-0000-0000-0000-000000000004/e5000000-0000-0000-0000-000000000005/thumb.webp',
  1200, 800, 'published', clock_timestamp()
) on conflict (id) do nothing;

-- ---- 1) 权限矩阵：表不可达、三个函数可用、入队仍不可用 ----
do $$
begin
  if has_table_privilege('app_user', 'public.photo_storage_cleanup_jobs', 'select')
     or has_table_privilege('app_user', 'public.photo_storage_cleanup_jobs', 'insert')
     or has_table_privilege('app_user', 'public.photo_storage_cleanup_jobs', 'update')
     or has_table_privilege('app_user', 'public.photo_storage_cleanup_jobs', 'delete') then
    raise exception 'app_user 不应拥有图片清理队列的表权限';
  end if;

  if not has_function_privilege(
    'app_user', 'public.claim_photo_storage_cleanup_jobs(integer,integer)', 'execute'
  ) then
    raise exception 'app_user 缺少领取任务的函数权限（worker 会每轮 42501）';
  end if;
  if not has_function_privilege(
    'app_user', 'public.complete_photo_storage_cleanup_job(bigint,uuid)', 'execute'
  ) then
    raise exception 'app_user 缺少完成任务的函数权限';
  end if;
  if not has_function_privilege(
    'app_user', 'public.retry_photo_storage_cleanup_job(bigint,uuid,text)', 'execute'
  ) then
    raise exception 'app_user 缺少重试任务的函数权限';
  end if;
  if has_function_privilege(
    'app_user', 'public.enqueue_photo_storage_cleanup(uuid,timestamptz)', 'execute'
  ) then
    raise exception 'app_user 不应能直接入队';
  end if;
end;
$$;

-- ---- 2) 以 app_user 直连队列表必须被拒 ----
set local role app_user;
do $$
begin
  begin
    perform count(*) from public.photo_storage_cleanup_jobs;
    raise exception 'app_user 竟然能直接 SELECT 图片清理队列';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.enqueue_photo_storage_cleanup('e5000000-0000-0000-0000-000000000005'::uuid);
    raise exception 'app_user 竟然能直接入队';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

-- ---- 3) 作者撤回 → 同一事务内入队 display + thumb 两条任务 ----
reset role;
select set_config('app.user_id', 'd4000000-0000-0000-0000-000000000004', true);
set local role app_user;
do $$
begin
  if not public.api_remove_photo('e5000000-0000-0000-0000-000000000005') then
    raise exception '作者撤回失败';
  end if;
end;
$$;

reset role;
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.photo_storage_cleanup_jobs
  where photo_id = 'e5000000-0000-0000-0000-000000000005';

  if v_count <> 2 then
    raise exception '撤回应恰好入队 2 条任务（display + thumb），实际 %', v_count;
  end if;

  if exists (
    select 1 from public.photo_storage_cleanup_jobs
    where photo_id = 'e5000000-0000-0000-0000-000000000005'
      and available_at < clock_timestamp() + interval '29 days'
  ) then
    raise exception '任务可执行时间应至少推迟 30 天（线上移除窗口）';
  end if;
end;
$$;

-- ---- 4) 让任务立即可执行，再以 app_user 领取 ----
update public.photo_storage_cleanup_jobs
set available_at = clock_timestamp()
where photo_id = 'e5000000-0000-0000-0000-000000000005';

set local role app_user;
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.claim_photo_storage_cleanup_jobs(10, 300);
  if v_count <> 2 then
    raise exception 'app_user 应能领取 2 条任务，实际 %', v_count;
  end if;

  -- 租约生效期间不得重复领取。
  select count(*) into v_count from public.claim_photo_storage_cleanup_jobs(10, 300);
  if v_count <> 0 then
    raise exception '租约未生效，重复领取了 % 条任务', v_count;
  end if;
end;
$$;

reset role;
do $$
declare
  v_attempt integer;
begin
  select attempt_count into v_attempt
  from public.photo_storage_cleanup_jobs
  where photo_id = 'e5000000-0000-0000-0000-000000000005'
  order by id
  limit 1;

  if v_attempt <> 1 then
    raise exception '领取后 attempt_count 应为 1，实际 %', v_attempt;
  end if;
end;
$$;

-- ---- 5) worker 的真实调用序列：完成一条、退避一条、失效租约不得算成功 ----
update public.photo_storage_cleanup_jobs
set lease_token = null, lease_expires_at = null
where photo_id = 'e5000000-0000-0000-0000-000000000005';

set local role app_user;
do $$
declare
  v_job record;
  v_first record;
  v_second record;
  v_count integer := 0;
begin
  for v_job in select * from public.claim_photo_storage_cleanup_jobs(10, 300) loop
    v_count := v_count + 1;
    if v_count = 1 then
      v_first := v_job;
    else
      v_second := v_job;
    end if;
  end loop;

  if v_count <> 2 then
    raise exception '重新领取应得到 2 条任务，实际 %', v_count;
  end if;

  if not public.complete_photo_storage_cleanup_job(v_first.job_id, v_first.lease_token) then
    raise exception '完成图片清理任务失败';
  end if;

  if not public.retry_photo_storage_cleanup_job(v_second.job_id, v_second.lease_token, '模拟对象存储失败') then
    raise exception '重试图片清理任务失败';
  end if;

  -- 用已失效的租约再次完成，必须返回 false，不能被当成成功。
  if public.complete_photo_storage_cleanup_job(v_first.job_id, v_first.lease_token) then
    raise exception '失效租约竟然完成了任务';
  end if;

  -- 完成 + 退避中的任务不应再被领取。
  if (select count(*) from public.claim_photo_storage_cleanup_jobs(10, 300)) <> 0 then
    raise exception '完成或退避中的任务不应被再次领取';
  end if;
end;
$$;

reset role;
do $$
declare
  v_completed integer;
  v_pending integer;
  v_error text;
  v_available timestamptz;
begin
  select count(*) into v_completed
  from public.photo_storage_cleanup_jobs
  where photo_id = 'e5000000-0000-0000-0000-000000000005'
    and completed_at is not null;
  if v_completed <> 1 then
    raise exception '应恰有 1 条任务完成，实际 %', v_completed;
  end if;

  select count(*), max(last_error), max(available_at)
  into v_pending, v_error, v_available
  from public.photo_storage_cleanup_jobs
  where photo_id = 'e5000000-0000-0000-0000-000000000005'
    and completed_at is null;
  if v_pending <> 1 then
    raise exception '应恰有 1 条任务待重试，实际 %', v_pending;
  end if;
  if v_error <> '模拟对象存储失败' then
    raise exception '重试原因未记录，实际 %', coalesce(v_error, '<null>');
  end if;
  if v_available <= clock_timestamp() + interval '50 seconds' then
    raise exception '重试应至少退避 60 秒，实际可用时间 %', v_available;
  end if;

  -- 重复入队（撤回被重放，或运维手工补队）不得制造重复任务。
  perform public.enqueue_photo_storage_cleanup(
    'e5000000-0000-0000-0000-000000000005'::uuid, clock_timestamp()
  );
  perform public.enqueue_photo_storage_cleanup(
    'e5000000-0000-0000-0000-000000000005'::uuid, clock_timestamp()
  );

  if (select count(*) from public.photo_storage_cleanup_jobs
      where photo_id = 'e5000000-0000-0000-0000-000000000005') <> 2 then
    raise exception '重复入队制造了重复任务';
  end if;
end;
$$;

rollback;
\echo 'photo storage cleanup app_user boundary tests passed'
