-- ============================================================================
-- 工科影展 · 0020 撤回作品图片异步清理队列
--
-- 关键边界：
--   1) api_remove_photo 只在数据库事务内软撤回并入队，不调用对象存储。
--   2) (photo_id, object_key) 唯一，重复撤回/重复迁移不会制造重复任务。
--   3) worker 以短租约 claim；失败任务指数退避，到期后可再次领取。
--   4) 图片至少保留 30 天，符合用户协议的线上移除窗口。
-- ============================================================================

create table if not exists public.photo_storage_cleanup_jobs (
  id                bigint generated always as identity primary key,
  photo_id          uuid not null references public.photos (id) on delete cascade,
  object_key        text not null check (char_length(object_key) between 1 and 512),
  available_at      timestamptz not null,
  attempt_count     integer not null default 0 check (attempt_count >= 0),
  lease_token       uuid,
  lease_expires_at  timestamptz,
  completed_at      timestamptz,
  last_error        text check (last_error is null or char_length(last_error) <= 2000),
  created_at        timestamptz not null default clock_timestamp(),
  updated_at        timestamptz not null default clock_timestamp(),
  constraint uq_photo_storage_cleanup_jobs_photo_key unique (photo_id, object_key),
  constraint ck_photo_storage_cleanup_jobs_lease_pair check (
    (lease_token is null and lease_expires_at is null)
    or (lease_token is not null and lease_expires_at is not null)
  )
);

comment on table public.photo_storage_cleanup_jobs is
  '撤回作品的图片删除任务；数据库提交与对象存储删除解耦，由服务端 worker 可重试处理';

create index if not exists idx_photo_storage_cleanup_jobs_ready
  on public.photo_storage_cleanup_jobs (available_at, id)
  where completed_at is null;

drop trigger if exists trg_photo_storage_cleanup_jobs_updated_at on public.photo_storage_cleanup_jobs;
create trigger trg_photo_storage_cleanup_jobs_updated_at
  before update on public.photo_storage_cleanup_jobs
  for each row execute function public.set_updated_at();

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
  insert into public.photo_storage_cleanup_jobs (photo_id, object_key, available_at)
  select p.id, keys.object_key, p_available_at
  from public.photos p
  cross join lateral (
    select p.image_key as object_key
    union
    select p.thumb_key as object_key
  ) as keys
  where p.id = p_photo_id
    and p.status = 'removed'
    and p.deleted_at is not null
  on conflict (photo_id, object_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.api_remove_photo(p_photo_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_deleted_at timestamptz;
begin
  if v_uid is null then
    raise exception '必须登录后撤回作品' using errcode = '42501';
  end if;

  update public.photos
  set status = 'removed', deleted_at = coalesce(deleted_at, clock_timestamp())
  where id = p_photo_id
    and author_id = v_uid
  returning deleted_at into v_deleted_at;

  if not found then
    return false;
  end if;

  perform public.enqueue_photo_storage_cleanup(
    p_photo_id,
    v_deleted_at + interval '30 days'
  );
  return true;
end;
$$;

-- 为迁移前已经撤回的作品补任务；唯一约束使该 backfill 可安全重放。
select public.enqueue_photo_storage_cleanup(
  p.id,
  p.deleted_at + interval '30 days'
)
from public.photos p
where p.status = 'removed'
  and p.deleted_at is not null;

revoke all on table public.photo_storage_cleanup_jobs from public, app_user;
revoke all on function public.enqueue_photo_storage_cleanup(uuid,timestamptz) from public, app_user;
-- owner 撤回仍只暴露原有函数；队列函数与表不暴露给应用角色。
revoke all on function public.api_remove_photo(uuid) from public, app_user;
grant execute on function public.api_remove_photo(uuid) to app_user;

do $$
begin
  if has_table_privilege('app_user', 'public.photo_storage_cleanup_jobs', 'select')
     or has_table_privilege('app_user', 'public.photo_storage_cleanup_jobs', 'insert')
     or has_table_privilege('app_user', 'public.photo_storage_cleanup_jobs', 'update')
     or has_table_privilege('app_user', 'public.photo_storage_cleanup_jobs', 'delete') then
    raise exception '0020 自检失败：app_user 不应直接访问图片清理队列';
  end if;
  if has_function_privilege('app_user', 'public.enqueue_photo_storage_cleanup(uuid,timestamptz)', 'execute') then
    raise exception '0020 自检失败：app_user 不应直接入队图片清理任务';
  end if;
end;
$$;
