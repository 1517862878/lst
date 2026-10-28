-- ============================================================================
-- 工科影展 · 0021 图片清理队列的 app_user 调用边界
--
-- 背景（0020 的缺陷）：
--   0020 把 public.photo_storage_cleanup_jobs 从 app_user 完全收回，
--   但服务端 worker 是【以 app_user 连接】直接读写该表的
--   （server/src/lib/db.ts 只有一个连接池，PGUSER 默认 app_user）。
--   结果是 worker 每 30 秒报一次 permission denied，图片永不删除、队列只增不减。
--
-- 本迁移的修法（与项目既有约定一致）：
--   表继续不对 app_user 开放，只暴露三个窄函数；
--   函数以 security definer 运行，因此拿不到表的应用角色也能安全地领取/完成/重试任务。
--   与 api_update_photo / api_remove_photo 等保持一致：应用角色只经函数动数据。
--
-- 单测为何没发现：server/src/storage/cleanup-worker.test.ts 注入的是假仓储，
-- 恰好把这段 SQL 与权限边界全部绕过了。真实验证见
-- supabase/test-photo-storage-cleanup-app-role.sql（以 app_user 身份执行）。
-- ============================================================================

create or replace function public.claim_photo_storage_cleanup_jobs(
  p_limit integer,
  p_lease_seconds integer
)
returns table (job_id bigint, object_key text, lease_token uuid)
language sql
security definer
set search_path = pg_catalog, public
as $$
  with candidates as (
    select id
    from public.photo_storage_cleanup_jobs
    where completed_at is null
      and available_at <= clock_timestamp()
      and (lease_expires_at is null or lease_expires_at <= clock_timestamp())
    order by available_at, id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 500))
  )
  update public.photo_storage_cleanup_jobs jobs
  set lease_token = gen_random_uuid(),
      lease_expires_at = clock_timestamp()
        + make_interval(secs => greatest(1, least(coalesce(p_lease_seconds, 300), 3600))),
      attempt_count = attempt_count + 1,
      last_error = null
  from candidates
  where jobs.id = candidates.id
  returning jobs.id, jobs.object_key, jobs.lease_token;
$$;

comment on function public.claim_photo_storage_cleanup_jobs(integer, integer) is
  '短租约领取到期的图片清理任务；for update skip locked 保证多实例不重复领取';

create or replace function public.complete_photo_storage_cleanup_job(
  p_job_id bigint,
  p_lease_token uuid
)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $$
  with updated as (
    update public.photo_storage_cleanup_jobs
    set completed_at = clock_timestamp(), lease_token = null, lease_expires_at = null
    where id = p_job_id
      and lease_token = p_lease_token
      and completed_at is null
    returning 1
  )
  select exists (select 1 from updated);
$$;

comment on function public.complete_photo_storage_cleanup_job(bigint, uuid) is
  '租约仍有效时标记任务完成；返回 false 表示租约已过期，不得当作成功';

create or replace function public.retry_photo_storage_cleanup_job(
  p_job_id bigint,
  p_lease_token uuid,
  p_error text
)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $$
  with updated as (
    update public.photo_storage_cleanup_jobs
    set available_at = clock_timestamp()
        + make_interval(
            secs => least(86400, 60 * power(2::numeric, least(attempt_count - 1, 10)))::integer
          ),
        last_error = left(p_error, 2000),
        lease_token = null,
        lease_expires_at = null
    where id = p_job_id
      and lease_token = p_lease_token
      and completed_at is null
    returning 1
  )
  select exists (select 1 from updated);
$$;

comment on function public.retry_photo_storage_cleanup_job(bigint, uuid, text) is
  '释放租约并按指数退避（60s 起、上限 24h）重新排期';

-- 只对应用角色开放这三个函数；队列表本身继续完全不可达。
revoke all on function public.claim_photo_storage_cleanup_jobs(integer, integer) from public;
revoke all on function public.complete_photo_storage_cleanup_job(bigint, uuid) from public;
revoke all on function public.retry_photo_storage_cleanup_job(bigint, uuid, text) from public;

grant execute on function public.claim_photo_storage_cleanup_jobs(integer, integer) to app_user;
grant execute on function public.complete_photo_storage_cleanup_job(bigint, uuid) to app_user;
grant execute on function public.retry_photo_storage_cleanup_job(bigint, uuid, text) to app_user;

do $$
begin
  -- 0020 的所有权边界必须仍然成立：应用角色不能绕过函数直接碰队列表。
  if has_table_privilege('app_user', 'public.photo_storage_cleanup_jobs', 'select')
     or has_table_privilege('app_user', 'public.photo_storage_cleanup_jobs', 'insert')
     or has_table_privilege('app_user', 'public.photo_storage_cleanup_jobs', 'update')
     or has_table_privilege('app_user', 'public.photo_storage_cleanup_jobs', 'delete') then
    raise exception '0021 自检失败：app_user 仍可直接访问图片清理队列';
  end if;

  -- 而 worker 真正要用的三个函数必须可执行，否则服务端会再次每轮报权限错误。
  if not has_function_privilege(
    'app_user', 'public.claim_photo_storage_cleanup_jobs(integer,integer)', 'execute'
  ) then
    raise exception '0021 自检失败：app_user 无法领取图片清理任务';
  end if;
  if not has_function_privilege(
    'app_user', 'public.complete_photo_storage_cleanup_job(bigint,uuid)', 'execute'
  ) then
    raise exception '0021 自检失败：app_user 无法完成任务';
  end if;
  if not has_function_privilege(
    'app_user', 'public.retry_photo_storage_cleanup_job(bigint,uuid,text)', 'execute'
  ) then
    raise exception '0021 自检失败：app_user 无法重试任务';
  end if;

  -- 入队仍然只允许由 api_remove_photo 内部触发。
  if has_function_privilege(
    'app_user', 'public.enqueue_photo_storage_cleanup(uuid,timestamptz)', 'execute'
  ) then
    raise exception '0021 自检失败：app_user 不应能直接入队';
  end if;
end;
$$;
