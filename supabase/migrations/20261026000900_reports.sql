-- ============================================================================
-- 工科影展 · 0009 reports：举报
-- 依据：docs/DATA-MODEL.md §3.9
-- 要点：
--   1) 允许匿名举报（reporter_id 可空）
--   2) target_type + target_id 多态关联（photo / comment / profile）
--   3) 状态机：open → reviewing → upheld / rejected
-- ============================================================================

create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('photo', 'comment', 'profile')),
  target_id   uuid not null,
  reason      text not null check (reason in ('copyright', 'explicit', 'spam', 'abuse', 'other')),
  detail      text not null default '' check (char_length(detail) <= 500),
  reporter_id uuid references public.profiles (id) on delete set null,
  status      text not null default 'open'
                check (status in ('open', 'reviewing', 'upheld', 'rejected')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

comment on table public.reports is '举报；多态关联 target_type+target_id；允许匿名';

create index if not exists idx_reports_target on public.reports (target_type, target_id);
create index if not exists idx_reports_status on public.reports (status, created_at desc);

-- 同一举报人对同一目标的重复举报（防刷）：已存在 open/reviewing 则不再新建
create unique index if not exists uq_reports_open_dedup
  on public.reports (coalesce(reporter_id, '00000000-0000-0000-0000-000000000000'::uuid), target_type, target_id)
  where status in ('open', 'reviewing');
