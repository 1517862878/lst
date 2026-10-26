-- ============================================================================
-- 工科影展 · 0008 榜单快照：weekly_rank_snapshots / weekly_rank_entries
-- 依据：docs/DATA-MODEL.md §3.5 §3.6 / ROADMAP §6.3
-- 要点：
--   1) 快照不可变（status 恒为 ready）：重算生成新行，不覆盖旧行
--   2) (iso_week, kind, formula_version) 唯一
--   3) entries 主键 (snapshot_id, rank)，rank 在快照内全序唯一
--   4) 排序键与前端 computeWeeklyRanking 逐字一致，保证双跑结果相同
-- ============================================================================

create table if not exists public.weekly_rank_snapshots (
  id              uuid primary key default gen_random_uuid(),
  iso_week        text not null check (iso_week ~ '^\d{4}-W\d{2}$'),
  kind            text not null check (kind in ('daily', 'final')),
  timezone        text not null default 'Asia/Shanghai',
  week_start_utc  timestamptz not null,
  week_end_utc    timestamptz not null,
  captured_at     timestamptz not null default now(),
  formula_version text not null default 'v1',
  entry_count     integer not null default 0 check (entry_count >= 0),
  status          text not null default 'ready' check (status = 'ready'),

  constraint uq_rank_snapshot unique (iso_week, kind, formula_version),
  constraint ck_rank_window check (week_end_utc > week_start_utc)
);

comment on table public.weekly_rank_snapshots is '周榜快照；不可变（重算生成新行）';

create index if not exists idx_rank_snapshots_week on public.weekly_rank_snapshots (iso_week, kind);

create table if not exists public.weekly_rank_entries (
  snapshot_id    uuid not null references public.weekly_rank_snapshots (id) on delete cascade,
  rank           integer not null check (rank >= 1),
  photo_id       uuid not null references public.photos (id) on delete cascade,
  like_count     integer not null default 0 check (like_count >= 0),
  favorite_count integer not null default 0 check (favorite_count >= 0),
  score          numeric(10, 2) not null default 0 check (score >= 0),
  tie_break_key  text not null,

  primary key (snapshot_id, rank),
  -- 同一快照内同一作品只能出现一次
  constraint uq_rank_entry_photo unique (snapshot_id, photo_id)
);

comment on table public.weekly_rank_entries is '榜单条目；(snapshot_id, rank) 主键，rank 全序唯一';
comment on column public.weekly_rank_entries.tie_break_key is '审计键：score:xx|f:x|l:x|publishedAt|id';

create index if not exists idx_rank_entries_photo on public.weekly_rank_entries (photo_id);

-- ----------------------------------------------------------------------------
-- 榜单计算函数（与前端 src/domain/ranking.ts 逐字一致的排序规则）
-- 排序：score DESC → favorite DESC → like DESC → published_at ASC → id ASC
-- 自赞自藏不计（ROADMAP §6.1）
-- ----------------------------------------------------------------------------
create or replace function public.compute_weekly_ranking(
  p_week_start timestamptz,
  p_week_end   timestamptz,
  p_formula    text default 'v1'
)
returns table (
  rank          integer,
  photo_id      uuid,
  like_count    integer,
  favorite_count integer,
  score         numeric(10, 2),
  tie_break_key text
)
language sql
stable
security definer
set search_path = public
as $$
  with like_agg as (
    select l.photo_id, count(*)::int as cnt
      from public.likes l
      join public.photos p on p.id = l.photo_id
     where l.created_at >= p_week_start
       and l.created_at <  p_week_end
       and l.user_id <> p.author_id            -- 自赞不计
     group by l.photo_id
  ),
  fav_agg as (
    select f.photo_id, count(*)::int as cnt
      from public.favorites f
      join public.photos p on p.id = f.photo_id
     where f.created_at >= p_week_start
       and f.created_at <  p_week_end
       and f.user_id <> p.author_id            -- 自藏不计
     group by f.photo_id
  ),
  eligible as (
    select p.id, p.published_at
      from public.photos p
     where p.status = 'published'
       and p.deleted_at is null
       and p.published_at is not null
       and p.published_at < p_week_end           -- 本周结束前已发布（含往期）
  ),
  scored as (
    select e.id as pid,
           e.published_at,
           coalesce(la.cnt, 0) as lc,
           coalesce(fa.cnt, 0) as fc,
           (case when p_formula = 'v1'
                 then (1.0 * coalesce(la.cnt, 0) + 3.0 * coalesce(fa.cnt, 0))
                 else (1.0 * coalesce(la.cnt, 0) + 3.0 * coalesce(fa.cnt, 0))
            end)::numeric(10, 2) as sc
      from eligible e
      left join like_agg la on la.photo_id = e.id
      left join fav_agg  fa on fa.photo_id = e.id
  )
  select
    (row_number() over (
       order by sc desc, fc desc, lc desc, published_at asc, pid asc
     ))::int as rank,
    pid,
    lc,
    fc,
    sc,
    format('score:%s|f:%s|l:%s|%s|%s', to_char(sc, 'FM9999990.00'), fc, lc, published_at, pid) as tie_break_key
  from scored;
$$;

comment on function public.compute_weekly_ranking(timestamptz, timestamptz, text) is '周榜计算：与前端 computeWeeklyRanking 排序规则逐字一致';
