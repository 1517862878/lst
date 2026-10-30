\encoding UTF8
-- ============================================================================
-- 工科影展 · 0036 每周主题与活动（8.4d 后端）
--
-- 依据：.tmp/phase84d-freeze.md §1（数据模型）/ §2（接口）、
--       docs/暂定产品完善计划表.md P2-12「每周拍摄主题：主题、投稿期、规则、作品列表、结果展示」、
--       项目交接说明.md §6.5「运营创建主题 → 作者投稿 → 主题页聚合 → 截止与评选」。
--
-- 本迁移做四件事：
--   1) photo_themes / theme_entries 两张表 + 约束 + 「同一时刻只有一个进行中主题」的
--      部分唯一索引（把运营纪律做成数据库事实）；
--   2) 9 个 security definer 函数把读写全部收口（两张表对 app_user 零权限，不写 RLS 策略：
--      策略只有一套，就在函数里，少一份需要同步维护的表达式）；
--   3) 精选投稿时给作品作者写一条 kind='system' 的通知；
--   4) 末尾 DO 块自检 —— 安全边界没落地就让迁移直接失败，而不是等到线上才发现。
--
-- 幂等（验收第 1 条：同一个库连着跑两遍）：
--   · 表：create table if not exists
--   · 约束：drop constraint if exists 之后重加（check 约束删了再加永远安全）
--   · 索引：create [unique] index if not exists
--   · 触发器：drop trigger if exists 之后重加（本迁移没有函数被触发器依赖，
--     不需要「先 drop trigger 再 drop function」那一层）
--   · 函数：一律 create or replace —— **绝不 drop function**：drop 会连带丢掉
--     revoke/grant（0029/0031/0033 都踩过这个坑），而返回类型不变时 create or replace 就够。
-- ============================================================================

-- ============================================================================
-- 1. 表
-- ============================================================================

-- 1.1 每期主题。同一时刻只允许一个 status='active'（见下面的部分唯一索引）。
create table if not exists public.photo_themes (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null,
  title          text not null,
  description    text not null default '',
  rules          text not null default '',
  status         text not null default 'draft',
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  cover_photo_id uuid references public.photos (id) on delete set null,
  result_note    text not null default '',
  created_by     uuid not null references public.profiles (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.photo_themes is
  '每周拍摄主题（8.4d）。status: draft 草稿（仅编辑可见）/ active 进行中 / closed 已结束。';
comment on column public.photo_themes.slug is
  'URL 稳定标识，仅 [a-z0-9-]{2,40}，创建后不可修改（api_admin_upsert_theme 内强制）。';
comment on column public.photo_themes.rules is
  '投稿规则纯文本（允许换行），前端按纯文本/Markdown 渲染，不做富文本编辑器。';
comment on column public.photo_themes.cover_photo_id is
  '主题封面：必须始终指向该主题的一件已投稿作品（没有就用首版作品封面）。';
comment on column public.photo_themes.result_note is '结果展示文案，截止后由编辑填写。';

-- 1.2 投稿：一件作品在一个主题里只能出现一次。
create table if not exists public.theme_entries (
  theme_id     uuid not null references public.photo_themes (id) on delete cascade,
  photo_id     uuid not null references public.photos (id) on delete cascade,
  submitted_by uuid not null references public.profiles (id),
  submitted_at timestamptz not null default now(),
  is_selected  boolean not null default false,
  selected_at  timestamptz,
  selected_by  uuid references public.profiles (id),
  note         text not null default '',
  constraint pk_theme_entries primary key (theme_id, photo_id)
);

comment on table public.theme_entries is
  '主题投稿（8.4d）。is_selected 是编辑精选；note 是编辑给这件作品的精选评语。';
comment on column public.theme_entries.submitted_by is
  '投稿人 = 作品作者（api_submit_theme_entry 里强制取自 auth.uid() 而非入参）。';

-- ============================================================================
-- 2. 约束（drop + add，保证重复执行不会因为「已经存在」而中断）
-- ============================================================================

alter table public.photo_themes drop constraint if exists ck_photo_themes_slug_format;
alter table public.photo_themes add constraint ck_photo_themes_slug_format
  check (slug ~ '^[a-z0-9-]{2,40}$');

alter table public.photo_themes drop constraint if exists ck_photo_themes_status;
alter table public.photo_themes add constraint ck_photo_themes_status
  check (status in ('draft', 'active', 'closed'));

alter table public.photo_themes drop constraint if exists ck_photo_themes_window;
alter table public.photo_themes add constraint ck_photo_themes_window
  check (ends_at > starts_at);

alter table public.photo_themes drop constraint if exists ck_photo_themes_title_len;
alter table public.photo_themes add constraint ck_photo_themes_title_len
  check (char_length(title) between 1 and 40);

alter table public.photo_themes drop constraint if exists ck_photo_themes_desc_len;
alter table public.photo_themes add constraint ck_photo_themes_desc_len
  check (char_length(description) <= 300);

alter table public.photo_themes drop constraint if exists ck_photo_themes_rules_len;
alter table public.photo_themes add constraint ck_photo_themes_rules_len
  check (char_length(rules) <= 1000);

alter table public.photo_themes drop constraint if exists ck_photo_themes_result_len;
alter table public.photo_themes add constraint ck_photo_themes_result_len
  check (char_length(result_note) <= 500);

alter table public.theme_entries drop constraint if exists ck_theme_entries_note_len;
alter table public.theme_entries add constraint ck_theme_entries_note_len
  check (char_length(note) <= 200);

-- 精选的三个字段必须同时有值或同时为空：
-- 不允许出现「精选了但不知道谁选的」或者「取消了精选却还留着精选时间」。
alter table public.theme_entries drop constraint if exists ck_theme_entries_selected;
alter table public.theme_entries add constraint ck_theme_entries_selected
  check (
    (is_selected = false and selected_at is null and selected_by is null)
    or (is_selected = true and selected_at is not null and selected_by is not null)
  );

-- ============================================================================
-- 3. 索引
-- ============================================================================

-- 「同一时刻只有一个进行中主题」——注意这是 (status) 上的部分唯一索引，
-- 所有 status='active' 的行在索引里挤在同一个键上，第二行直接冲突。
-- 把它做进数据库而不是靠运营自觉：新建/激活第二个主题时必然失败。
create unique index if not exists ux_photo_themes_single_active
  on public.photo_themes (status) where status = 'active';

create index if not exists ix_photo_themes_window
  on public.photo_themes (starts_at desc);

create index if not exists ix_theme_entries_theme
  on public.theme_entries (theme_id, is_selected desc, submitted_at desc);

-- 作品侧的级联删除（photos on delete cascade）与「封面必须是本主题投稿」的反查都需要它。
create index if not exists ix_theme_entries_photo
  on public.theme_entries (photo_id);

-- updated_at 由既有触发器函数维护（photos 等表共用）。
drop trigger if exists trg_photo_themes_updated_at on public.photo_themes;
create trigger trg_photo_themes_updated_at
  before update on public.photo_themes
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 4. 权限边界：两张表对 app_user 零权限，读写全部经由函数
-- ============================================================================

alter table public.photo_themes enable row level security;
alter table public.theme_entries enable row level security;
revoke all on table public.photo_themes from public, app_user;
revoke all on table public.theme_entries from public, app_user;

-- ============================================================================
-- 5. 函数
--    统一：security definer + set search_path = pg_catalog, public, auth, pg_temp。
--    编辑身份一律在函数内自校验（不信任调用方），未登录抛 42501 AUTH_REQUIRED。
--    错误码到 HTTP 的映射见 server/src/lib/errors.ts：
--      P0002 → 404 NOT_FOUND      23514 → 400 VALIDATION
--      22023 → 400 VALIDATION     42501 → 403 FORBIDDEN
--      55000 → 409 CONFLICT       53400 → 422 LIMIT_EXCEEDED
--      54000 → 422 LIMIT_EXCEEDED（本迁移新增支持）
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 5.1 公开读：主题列表
--     p_status = 'active'（进行中）| 'upcoming'（即将开始）| 'past'（往期）| null（全部默认视图）
--     draft 主题永不出现在公开列表里。
-- ----------------------------------------------------------------------------
create or replace function public.api_list_themes(p_status text default null)
returns table(
  id uuid,
  slug text,
  title text,
  description text,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  cover_photo_id uuid,
  entry_count integer,
  selected_count integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_now        timestamptz := now();
  v_status     text := nullif(btrim(coalesce(p_status, '')), '');
  v_past_limit integer;
begin
  if v_status is not null and v_status not in ('active', 'upcoming', 'past') then
    raise exception 'INVALID_STATUS:%', v_status using errcode = '22023';
  end if;

  -- 默认视图只回最近 12 期往期（首页/主题页不需要翻旧账）；显式查往期时放宽到 50 期。
  v_past_limit := case when v_status is null then 12 else 50 end;

  return query
    with classified as (
      select
        t.id,
        t.slug,
        t.title,
        t.description,
        t.status,
        t.starts_at,
        t.ends_at,
        t.cover_photo_id,
        case
          when t.status = 'active' and v_now < t.starts_at then 'upcoming'
          when t.status = 'active' and v_now >= t.starts_at and v_now < t.ends_at then 'active'
          else 'past'
        end as bucket
      from public.photo_themes t
      where t.status <> 'draft'
    ),
    ranked as (
      select
        c.*,
        row_number() over (
          partition by c.bucket
          order by c.starts_at desc, c.slug collate "C" asc
        ) as rn
      from classified c
    )
    select
      r.id,
      r.slug,
      r.title,
      r.description,
      r.status,
      r.starts_at,
      r.ends_at,
      r.cover_photo_id,
      (
        select count(*)::integer
        from public.theme_entries e
        join public.photos ph on ph.id = e.photo_id
        where e.theme_id = r.id
          and ph.status = 'published'
          and ph.deleted_at is null
      ) as entry_count,
      (
        select count(*)::integer
        from public.theme_entries e
        join public.photos ph on ph.id = e.photo_id
        where e.theme_id = r.id
          and e.is_selected
          and ph.status = 'published'
          and ph.deleted_at is null
      ) as selected_count
    from ranked r
    where case
            when v_status is null then r.bucket in ('active', 'upcoming') or r.rn <= v_past_limit
            when v_status = 'past' then r.bucket = 'past' and r.rn <= v_past_limit
            else r.bucket = v_status
          end
    order by r.starts_at desc, r.slug collate "C" asc;
end;
$$;

comment on function public.api_list_themes(text) is
  '公开主题列表。entry_count/selected_count 只数「已发布且未删除」的投稿作品。';

-- ----------------------------------------------------------------------------
-- 5.2 公开读：单个主题（draft 对非编辑返回 0 行 → 路由层 404）
-- ----------------------------------------------------------------------------
create or replace function public.api_get_theme(p_slug text)
returns table(
  id uuid,
  slug text,
  title text,
  description text,
  rules text,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  cover_photo_id uuid,
  result_note text,
  entry_count integer,
  selected_count integer,
  is_open boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_slug   text := nullif(btrim(coalesce(p_slug, '')), '');
  v_editor boolean;
begin
  if v_slug is null then
    return;
  end if;

  -- 编辑看得到草稿（后台要编辑它），普通访客与作者看不到。
  v_editor := public.is_editor_or_admin();

  return query
    select
      t.id,
      t.slug,
      t.title,
      t.description,
      t.rules,
      t.status,
      t.starts_at,
      t.ends_at,
      t.cover_photo_id,
      t.result_note,
      (
        select count(*)::integer
        from public.theme_entries e
        join public.photos ph on ph.id = e.photo_id
        where e.theme_id = t.id
          and ph.status = 'published'
          and ph.deleted_at is null
      ) as entry_count,
      (
        select count(*)::integer
        from public.theme_entries e
        join public.photos ph on ph.id = e.photo_id
        where e.theme_id = t.id
          and e.is_selected
          and ph.status = 'published'
          and ph.deleted_at is null
      ) as selected_count,
      (t.status = 'active' and now() >= t.starts_at and now() < t.ends_at) as is_open
    from public.photo_themes t
    where t.slug = v_slug
      and (t.status <> 'draft' or v_editor);
end;
$$;

comment on function public.api_get_theme(text) is
  '单个主题详情。is_open = status=active 且 now() 落在 [starts_at, ends_at)。draft 仅编辑可见。';

-- ----------------------------------------------------------------------------
-- 5.3 公开读：主题投稿列表（分页）
-- ----------------------------------------------------------------------------
create or replace function public.api_list_theme_entries(
  p_slug text,
  p_limit integer default 24,
  p_offset integer default 0,
  p_selected_only boolean default false
)
returns table(
  photo_id uuid,
  is_selected boolean,
  note text,
  selected_at timestamptz,
  submitted_at timestamptz,
  title text,
  author_id uuid,
  author_username text,
  author_display_name text,
  image_key text,
  thumb_key text,
  like_count bigint,
  favorite_count bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_slug          text := nullif(btrim(coalesce(p_slug, '')), '');
  v_limit         integer := least(greatest(coalesce(p_limit, 24), 1), 48);
  v_offset        integer := greatest(coalesce(p_offset, 0), 0);
  v_selected_only boolean := coalesce(p_selected_only, false);
  v_editor        boolean;
begin
  if v_slug is null then
    return;
  end if;

  v_editor := public.is_editor_or_admin();

  return query
    with target as (
      select t.id
      from public.photo_themes t
      where t.slug = v_slug
        and (t.status <> 'draft' or v_editor)
    ),
    base as (
      select
        e.photo_id,
        e.is_selected,
        e.note,
        e.selected_at,
        e.submitted_at,
        ph.title,
        ph.author_id,
        ph.image_key,
        ph.thumb_key,
        ph.like_count,
        ph.favorite_count,
        pr.username::text as author_username,
        pr.display_name as author_display_name
      from public.theme_entries e
      join target tg on tg.id = e.theme_id
      join public.photos ph on ph.id = e.photo_id
      join public.profiles pr on pr.id = ph.author_id
      where ph.status = 'published'
        and ph.deleted_at is null
        and (not v_selected_only or e.is_selected)
    )
    select
      b.photo_id,
      b.is_selected,
      b.note,
      b.selected_at,
      b.submitted_at,
      b.title,
      b.author_id,
      b.author_username,
      b.author_display_name,
      b.image_key,
      b.thumb_key,
      b.like_count::bigint,
      b.favorite_count::bigint,
      (select count(*) from base) as total_count
    from base b
    order by
      b.is_selected desc,
      b.selected_at asc nulls last,
      b.submitted_at desc,
      -- 最后一级兜底，保证分页在「同一秒投稿」时也稳定（否则 offset 会漏/重）
      b.photo_id asc
    limit v_limit
    offset v_offset;
end;
$$;

comment on function public.api_list_theme_entries(text, integer, integer, boolean) is
  '主题投稿列表（只含已发布未删除作品）。limit 夹取 1–48；total_count 是过滤后的总数（不含分页）。';

-- ----------------------------------------------------------------------------
-- 5.4 作者读：我在这个主题的投稿
-- ----------------------------------------------------------------------------
create or replace function public.api_my_theme_entries(p_slug text)
returns table(
  photo_id uuid,
  is_selected boolean,
  note text,
  submitted_at timestamptz,
  title text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_slug text := nullif(btrim(coalesce(p_slug, '')), '');
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if v_slug is null then
    return;
  end if;

  -- 自己的投稿，不论主题是草稿还是已结束都要看得到（作者要能确认自己投过什么）。
  return query
    select e.photo_id, e.is_selected, e.note, e.submitted_at, ph.title
    from public.theme_entries e
    join public.photo_themes t on t.id = e.theme_id
    join public.photos ph on ph.id = e.photo_id
    where t.slug = v_slug
      and e.submitted_by = v_uid
    order by e.submitted_at desc, e.photo_id asc;
end;
$$;

comment on function public.api_my_theme_entries(text) is
  '当前登录用户在某主题下的投稿（含未发布/已删除作品之外的全部本人投稿行）。';

-- ----------------------------------------------------------------------------
-- 5.5 作者写：投稿
--     每人每个主题最多 c_max_entries_per_author 件；重复投稿同一作品 409。
--     不发任何通知（给编辑发太吵，给作者发是自通知）。
-- ----------------------------------------------------------------------------
create or replace function public.api_submit_theme_entry(p_slug text, p_photo_id uuid)
returns table(
  entry_photo_id uuid,
  submitted_at timestamptz,
  entry_count integer
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  c_max_entries_per_author constant integer := 3;
  v_uid          uuid := auth.uid();
  v_slug         text := nullif(btrim(coalesce(p_slug, '')), '');
  v_theme_id     uuid;
  v_status       text;
  v_starts_at    timestamptz;
  v_ends_at      timestamptz;
  v_mine         integer;
  v_submitted_at timestamptz;
  v_count        integer;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if v_slug is null or p_photo_id is null then
    raise exception '参数不完整' using errcode = '22023';
  end if;

  select t.id, t.status, t.starts_at, t.ends_at
    into v_theme_id, v_status, v_starts_at, v_ends_at
  from public.photo_themes t
  where t.slug = v_slug;

  if v_theme_id is null then
    raise exception '主题不存在' using errcode = 'P0002';
  end if;

  if not (v_status = 'active' and now() >= v_starts_at and now() < v_ends_at) then
    raise exception '主题不在投稿期' using errcode = '55000';
  end if;

  -- 作品必须是本人的、未被软删的（别人的作品与不存在的作品给同一个 404，不泄露存在性）
  if not exists (
    select 1
    from public.photos ph
    where ph.id = p_photo_id
      and ph.author_id = v_uid
      and ph.deleted_at is null
  ) then
    raise exception '作品不存在' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.photos ph
    where ph.id = p_photo_id
      and ph.status = 'published'
      and ph.deleted_at is null
  ) then
    raise exception '只能投稿已发布的作品' using errcode = '23514';
  end if;

  -- 重复投稿：先显式查一次，才能给出可读文案（23505 的中文 message 会被
  -- server/src/lib/errors.ts 的 translateDbError 统一覆盖成通用文案）。
  if exists (
    select 1
    from public.theme_entries e
    where e.theme_id = v_theme_id
      and e.photo_id = p_photo_id
  ) then
    raise exception '这件作品已经在主题里了' using errcode = '55000';
  end if;

  select count(*)::integer
    into v_mine
  from public.theme_entries e
  where e.theme_id = v_theme_id
    and e.submitted_by = v_uid;

  if v_mine >= c_max_entries_per_author then
    raise exception '每个主题最多投稿 % 件作品', c_max_entries_per_author using errcode = '54000';
  end if;

  insert into public.theme_entries (theme_id, photo_id, submitted_by)
  values (v_theme_id, p_photo_id, v_uid)
  returning theme_entries.submitted_at into v_submitted_at;

  -- entry_count 与 api_list_themes / api_get_theme 的 entry_count 同名同义：
  -- 主题里「已发布且未删除」的投稿总数（作者自己的进度看 api_my_theme_entries）。
  select count(*)::integer
    into v_count
  from public.theme_entries e
  join public.photos ph on ph.id = e.photo_id
  where e.theme_id = v_theme_id
    and ph.status = 'published'
    and ph.deleted_at is null;

  return query select p_photo_id, v_submitted_at, v_count;
end;
$$;

comment on function public.api_submit_theme_entry(text, uuid) is
  '投稿作品到主题。每人每主题上限 3 件（54000 → 422）；重复投稿 55000 → 409；主题不在投稿期 55000 → 409。';

-- ----------------------------------------------------------------------------
-- 5.6 作者写：撤回投稿
--     投稿期结束后不能撤回；已入选的作品不能由作者自己撤回（联系编辑）。
-- ----------------------------------------------------------------------------
create or replace function public.api_withdraw_theme_entry(p_slug text, p_photo_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_slug      text := nullif(btrim(coalesce(p_slug, '')), '');
  v_theme_id  uuid;
  v_status    text;
  v_starts_at timestamptz;
  v_ends_at   timestamptz;
  v_selected  boolean;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if v_slug is null or p_photo_id is null then
    raise exception '参数不完整' using errcode = '22023';
  end if;

  select t.id, t.status, t.starts_at, t.ends_at
    into v_theme_id, v_status, v_starts_at, v_ends_at
  from public.photo_themes t
  where t.slug = v_slug;

  if v_theme_id is null then
    raise exception '主题不存在' using errcode = 'P0002';
  end if;

  -- 「不是我的投稿」与「投稿不存在」同码：不泄露别人投了什么。
  select e.is_selected
    into v_selected
  from public.theme_entries e
  where e.theme_id = v_theme_id
    and e.photo_id = p_photo_id
    and e.submitted_by = v_uid;

  if not found then
    raise exception '投稿不存在或不属于你' using errcode = 'P0002';
  end if;

  -- 已入选：403 + 用户可读文案。前缀 FORBIDDEN_MSG: 由 translateDbError 剥离，
  -- 否则 42501 的中文 message 会被换成「无权执行该操作（被行级安全策略拒绝）」。
  if v_selected then
    raise exception 'FORBIDDEN_MSG:已入选的作品不能撤回，请联系编辑' using errcode = '42501';
  end if;

  if not (v_status = 'active' and now() >= v_starts_at and now() < v_ends_at) then
    raise exception '投稿期已结束，不能撤回' using errcode = '55000';
  end if;

  delete from public.theme_entries e
  where e.theme_id = v_theme_id
    and e.photo_id = p_photo_id
    and e.submitted_by = v_uid;

  -- 封面必须始终是「该主题的已投稿作品」：撤掉的正好是封面就顺手清空封面指针，
  -- 否则主题页会拿一件已经不在主题里的作品当封面。
  update public.photo_themes t
     set cover_photo_id = null
   where t.id = v_theme_id
     and t.cover_photo_id = p_photo_id;
end;
$$;

comment on function public.api_withdraw_theme_entry(text, uuid) is
  '撤回自己的投稿。已入选 → 42501(FORBIDDEN_MSG) → 403；投稿期已结束 → 55000 → 409。';

-- ----------------------------------------------------------------------------
-- 5.7 编辑写：新建 / 更新主题
--     p_id 为 null 则新建；否则更新（slug 不可改）。
-- ----------------------------------------------------------------------------
create or replace function public.api_admin_upsert_theme(
  p_id uuid,
  p_slug text,
  p_title text,
  p_description text,
  p_rules text,
  p_status text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_cover_photo_id uuid,
  p_result_note text
)
returns table(id uuid, slug text, status text)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_uid          uuid := auth.uid();
  v_role         text;
  v_slug         text := nullif(btrim(coalesce(p_slug, '')), '');
  v_title        text := btrim(coalesce(p_title, ''));
  v_description  text := coalesce(p_description, '');
  v_rules        text := coalesce(p_rules, '');
  v_status       text := nullif(btrim(coalesce(p_status, '')), '');
  v_result_note  text := coalesce(p_result_note, '');
  v_existing_id  uuid;
  v_existing_slug text;
  v_id           uuid;
begin
  -- 编辑身份自校验：函数是 definer，不能靠「路由层已经拦过」当安全边界。
  select pr.role
    into v_role
  from public.profiles pr
  where pr.id = v_uid
    and pr.deleted_at is null;

  if v_role is null or v_role not in ('editor', 'admin') then
    raise exception '无权管理主题' using errcode = '42501';
  end if;

  if p_id is null then
    if v_slug is null then
      raise exception '新建主题必须提供 slug' using errcode = '23514';
    end if;
    v_id := gen_random_uuid();
  else
    select t.id, t.slug
      into v_existing_id, v_existing_slug
    from public.photo_themes t
    where t.id = p_id;

    if v_existing_id is null then
      raise exception '主题不存在' using errcode = 'P0002';
    end if;

    -- slug 是 URL 稳定标识：传了就必须与库里一致，null 表示不动它。
    if v_slug is not null and v_slug <> v_existing_slug then
      raise exception '主题 slug 创建后不可修改' using errcode = '22023';
    end if;

    v_id := v_existing_id;
    v_slug := v_existing_slug;
  end if;

  -- 字段级校验（表约束是最后一道防线；这里给出可读文案与 400 而不是 500）
  if v_slug !~ '^[a-z0-9-]{2,40}$' then
    raise exception 'slug 只能包含小写字母、数字和连字符，长度 2–40' using errcode = '23514';
  end if;
  if char_length(v_title) < 1 or char_length(v_title) > 40 then
    raise exception '主题标题必须是 1–40 个字' using errcode = '23514';
  end if;
  if char_length(v_description) > 300 then
    raise exception '主题说明最多 300 个字' using errcode = '23514';
  end if;
  if char_length(v_rules) > 1000 then
    raise exception '投稿规则最多 1000 个字' using errcode = '23514';
  end if;
  if char_length(v_result_note) > 500 then
    raise exception '结果文案最多 500 个字' using errcode = '23514';
  end if;
  if v_status is null or v_status not in ('draft', 'active', 'closed') then
    raise exception '状态只能是 draft / active / closed' using errcode = '22023';
  end if;
  if p_starts_at is null or p_ends_at is null then
    raise exception '必须提供投稿期起止时间' using errcode = '23514';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception '投稿结束时间必须晚于开始时间' using errcode = '23514';
  end if;

  -- 封面必须是该主题的已投稿作品（新建的主题还没有投稿，所以只能为空）。
  if p_cover_photo_id is not null then
    if not exists (
      select 1
      from public.theme_entries e
      where e.theme_id = v_id
        and e.photo_id = p_cover_photo_id
    ) then
      raise exception '封面必须是该主题的已投稿作品' using errcode = '23514';
    end if;
  end if;

  -- 「同一时刻只有一个进行中主题」：先查一次给出可读的 409，
  -- 再靠 ux_photo_themes_single_active 兜底（并发下唯一索引才是最终裁判）。
  if v_status = 'active' then
    if exists (
      select 1
      from public.photo_themes t
      where t.status = 'active'
        and t.id <> v_id
    ) then
      raise exception '已有一个进行中的主题' using errcode = '55000';
    end if;
  end if;

  begin
    if p_id is null then
      insert into public.photo_themes (
        id, slug, title, description, rules, status,
        starts_at, ends_at, cover_photo_id, result_note, created_by
      ) values (
        v_id, v_slug, v_title, v_description, v_rules, v_status,
        p_starts_at, p_ends_at, p_cover_photo_id, v_result_note, v_uid
      );
    else
      update public.photo_themes t
         set title          = v_title,
             description    = v_description,
             rules          = v_rules,
             status         = v_status,
             starts_at      = p_starts_at,
             ends_at        = p_ends_at,
             cover_photo_id = p_cover_photo_id,
             result_note    = v_result_note
       where t.id = v_id;
    end if;
  exception
    when unique_violation then
      -- 走到这里说明并发插入抢到了 active 名额：把索引错误翻译成人话。
      raise exception '已有一个进行中的主题' using errcode = '55000';
  end;

  return query select v_id, v_slug, v_status;
end;
$$;

comment on function public.api_admin_upsert_theme(uuid, text, text, text, text, text, timestamptz, timestamptz, uuid, text) is
  '编辑新建/更新主题。第二个 active 主题 → 55000 → 409「已有一个进行中的主题」；slug 不可改。';

-- ----------------------------------------------------------------------------
-- 5.8 编辑写：精选 / 取消精选 + 通知作者
-- ----------------------------------------------------------------------------
create or replace function public.api_admin_select_theme_entry(
  p_slug text,
  p_photo_id uuid,
  p_selected boolean,
  p_note text default ''
)
returns table(is_selected boolean, selected_count integer)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_uid           uuid := auth.uid();
  v_role          text;
  v_slug          text := nullif(btrim(coalesce(p_slug, '')), '');
  v_note          text := btrim(coalesce(p_note, ''));
  v_theme_id      uuid;
  v_theme_title   text;
  v_author_id     uuid;
  v_was_selected  boolean;
  v_selected      boolean := coalesce(p_selected, false);
  v_count         integer;
begin
  select pr.role
    into v_role
  from public.profiles pr
  where pr.id = v_uid
    and pr.deleted_at is null;

  if v_role is null or v_role not in ('editor', 'admin') then
    raise exception '无权精选主题投稿' using errcode = '42501';
  end if;

  if v_slug is null or p_photo_id is null then
    raise exception '参数不完整' using errcode = '22023';
  end if;

  if char_length(v_note) > 200 then
    raise exception '精选评语最多 200 个字' using errcode = '23514';
  end if;

  select t.id, t.title
    into v_theme_id, v_theme_title
  from public.photo_themes t
  where t.slug = v_slug;

  if v_theme_id is null then
    raise exception '主题不存在' using errcode = 'P0002';
  end if;

  select e.is_selected, ph.author_id
    into v_was_selected, v_author_id
  from public.theme_entries e
  join public.photos ph on ph.id = e.photo_id
  where e.theme_id = v_theme_id
    and e.photo_id = p_photo_id;

  if not found then
    raise exception '投稿不存在' using errcode = 'P0002';
  end if;

  -- 精选的三个字段一起写、一起清（ck_theme_entries_selected 要求同进同出）。
  update public.theme_entries e
     set is_selected = v_selected,
         selected_at = case when v_selected then now() else null end,
         selected_by = case when v_selected then v_uid else null end,
         note        = case when v_selected then v_note else '' end
   where e.theme_id = v_theme_id
     and e.photo_id = p_photo_id;

  -- 只有「从未入选 → 入选」才发通知：编辑改一句评语不该重新炸一次作者，
  -- 取消精选按契约不发通知；作者恰好是操作者本人时也不发（自通知无意义）。
  if v_selected
     and not coalesce(v_was_selected, false)
     and v_author_id is not null
     and v_author_id <> v_uid then
    insert into public.notifications (user_id, kind, actor_id, photo_id, comment_id, meta)
    values (
      v_author_id,
      'system',
      v_uid,
      p_photo_id,
      null,
      jsonb_build_object(
        'kind', 'theme_selected',
        'themeSlug', v_slug,
        'themeTitle', v_theme_title,
        'photoId', p_photo_id
      )
    );
  end if;

  select count(*)::integer
    into v_count
  from public.theme_entries e
  join public.photos ph on ph.id = e.photo_id
  where e.theme_id = v_theme_id
    and e.is_selected
    and ph.status = 'published'
    and ph.deleted_at is null;

  return query select v_selected, v_count;
end;
$$;

comment on function public.api_admin_select_theme_entry(text, uuid, boolean, text) is
  '编辑精选/取消精选主题投稿；首次精选给作者写一条 kind=system 通知（meta.type=theme_selected）。';

-- ----------------------------------------------------------------------------
-- 5.9 编辑读：主题全量列表（含 draft）
--     公开的 api_list_themes 有意不返回 draft，后台 Tab 否则永远看不到草稿；
--     PATCH 的「局部更新」也需要按 id 取到原值再合并回写。
-- ----------------------------------------------------------------------------
create or replace function public.api_admin_list_themes(p_status text default null)
returns table(
  id uuid,
  slug text,
  title text,
  description text,
  rules text,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  cover_photo_id uuid,
  result_note text,
  entry_count integer,
  selected_count integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_role   text;
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
begin
  select pr.role
    into v_role
  from public.profiles pr
  where pr.id = v_uid
    and pr.deleted_at is null;

  if v_role is null or v_role not in ('editor', 'admin') then
    raise exception '无权管理主题' using errcode = '42501';
  end if;

  if v_status is not null and v_status not in ('draft', 'active', 'closed') then
    raise exception 'INVALID_STATUS:%', v_status using errcode = '22023';
  end if;

  return query
    select
      t.id,
      t.slug,
      t.title,
      t.description,
      t.rules,
      t.status,
      t.starts_at,
      t.ends_at,
      t.cover_photo_id,
      t.result_note,
      (
        select count(*)::integer
        from public.theme_entries e
        join public.photos ph on ph.id = e.photo_id
        where e.theme_id = t.id
          and ph.status = 'published'
          and ph.deleted_at is null
      ) as entry_count,
      (
        select count(*)::integer
        from public.theme_entries e
        join public.photos ph on ph.id = e.photo_id
        where e.theme_id = t.id
          and e.is_selected
          and ph.status = 'published'
          and ph.deleted_at is null
      ) as selected_count
    from public.photo_themes t
    where v_status is null or t.status = v_status
    order by t.starts_at desc, t.slug collate "C" asc;
end;
$$;

comment on function public.api_admin_list_themes(text) is
  '编辑用的主题全量列表（含 draft 与完整字段），供 /admin 主题 Tab 与 PATCH 合并原值。';

-- ============================================================================
-- 6. 授权：函数可被 app_user 执行，表仍然零权限
-- ============================================================================

revoke all on function public.api_list_themes(text) from public, app_user;
grant execute on function public.api_list_themes(text) to app_user;

revoke all on function public.api_get_theme(text) from public, app_user;
grant execute on function public.api_get_theme(text) to app_user;

revoke all on function public.api_list_theme_entries(text, integer, integer, boolean) from public, app_user;
grant execute on function public.api_list_theme_entries(text, integer, integer, boolean) to app_user;

revoke all on function public.api_my_theme_entries(text) from public, app_user;
grant execute on function public.api_my_theme_entries(text) to app_user;

revoke all on function public.api_submit_theme_entry(text, uuid) from public, app_user;
grant execute on function public.api_submit_theme_entry(text, uuid) to app_user;

revoke all on function public.api_withdraw_theme_entry(text, uuid) from public, app_user;
grant execute on function public.api_withdraw_theme_entry(text, uuid) to app_user;

revoke all on function public.api_admin_upsert_theme(uuid, text, text, text, text, text, timestamptz, timestamptz, uuid, text) from public, app_user;
grant execute on function public.api_admin_upsert_theme(uuid, text, text, text, text, text, timestamptz, timestamptz, uuid, text) to app_user;

revoke all on function public.api_admin_select_theme_entry(text, uuid, boolean, text) from public, app_user;
grant execute on function public.api_admin_select_theme_entry(text, uuid, boolean, text) to app_user;

revoke all on function public.api_admin_list_themes(text) from public, app_user;
grant execute on function public.api_admin_list_themes(text) to app_user;

-- ============================================================================
-- 7. 自检：迁移必须把「数据模型 + 安全边界」真正落地，否则直接失败
-- ============================================================================

do $$
declare
  v_oid      oid;
  v_func     text;
  v_table    text;
  v_priv     text;
  v_count    integer;
begin
  -- 7.1 两张表：RLS 打开、没有任何 policy、app_user 没有任何表权限
  foreach v_table in array array['photo_themes', 'theme_entries'] loop
    if to_regclass('public.' || v_table) is null then
      raise exception '自检失败：表 public.% 不存在', v_table;
    end if;

    if not (select relrowsecurity from pg_class where oid = to_regclass('public.' || v_table)) then
      raise exception '自检失败：public.% 未启用 row level security', v_table;
    end if;

    select count(*) into v_count
    from pg_policies
    where schemaname = 'public' and tablename = v_table;
    if v_count <> 0 then
      raise exception '自检失败：public.% 不该有 RLS policy（策略写在函数里），却有 % 条', v_table, v_count;
    end if;

    foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege('app_user', 'public.' || v_table, v_priv) then
        raise exception '自检失败：app_user 不该对 public.% 有 % 权限', v_table, v_priv;
      end if;
    end loop;
  end loop;

  -- 7.2 「同一时刻只有一个 active 主题」必须是数据库事实
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'photo_themes'
      and indexname = 'ux_photo_themes_single_active'
  ) then
    raise exception '自检失败：缺少部分唯一索引 ux_photo_themes_single_active';
  end if;

  if not exists (
    select 1 from pg_index i
    join pg_class c on c.oid = i.indexrelid
    where c.relname = 'ux_photo_themes_single_active' and i.indisunique
  ) then
    raise exception '自检失败：ux_photo_themes_single_active 不是唯一索引';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'photo_themes' and indexname = 'ix_photo_themes_window'
  ) then
    raise exception '自检失败：缺少 ix_photo_themes_window';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'theme_entries' and indexname = 'ix_theme_entries_theme'
  ) then
    raise exception '自检失败：缺少 ix_theme_entries_theme';
  end if;

  -- 7.3 约束齐全
  select count(*) into v_count
  from pg_constraint
  where conrelid = 'public.photo_themes'::regclass
    and conname in (
      'ck_photo_themes_slug_format', 'ck_photo_themes_status', 'ck_photo_themes_window',
      'ck_photo_themes_title_len', 'ck_photo_themes_desc_len', 'ck_photo_themes_rules_len',
      'ck_photo_themes_result_len', 'photo_themes_pkey'
    );
  if v_count < 8 then
    raise exception '自检失败：photo_themes 约束不全（期望 8 条，实际 %）', v_count;
  end if;

  select count(*) into v_count
  from pg_constraint
  where conrelid = 'public.theme_entries'::regclass
    and conname in ('pk_theme_entries', 'ck_theme_entries_note_len', 'ck_theme_entries_selected');
  if v_count < 3 then
    raise exception '自检失败：theme_entries 约束不全（期望 3 条，实际 %）', v_count;
  end if;

  -- 7.4 触发器（updated_at）
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.photo_themes'::regclass
      and tgname = 'trg_photo_themes_updated_at'
      and not tgisinternal
  ) then
    raise exception '自检失败：缺少 trg_photo_themes_updated_at';
  end if;

  -- 7.5 9 个函数：security definer + 固定 search_path + 只有 app_user 能执行
  --     （用 to_regprocedure 逐个断言，顺带防止「函数签名被改窄了却没人发现」）
  foreach v_func in array array[
    'public.api_list_themes(text)',
    'public.api_get_theme(text)',
    'public.api_list_theme_entries(text, integer, integer, boolean)',
    'public.api_my_theme_entries(text)',
    'public.api_submit_theme_entry(text, uuid)',
    'public.api_withdraw_theme_entry(text, uuid)',
    'public.api_admin_upsert_theme(uuid, text, text, text, text, text, timestamptz, timestamptz, uuid, text)',
    'public.api_admin_select_theme_entry(text, uuid, boolean, text)',
    'public.api_admin_list_themes(text)'
  ] loop
    v_oid := to_regprocedure(v_func);
    if v_oid is null then
      raise exception '自检失败：函数 % 不存在', v_func;
    end if;

    if not (select prosecdef from pg_proc where oid = v_oid) then
      raise exception '自检失败：% 不是 security definer', v_func;
    end if;

    if not exists (
      select 1 from pg_proc p
      where p.oid = v_oid
        and exists (
          select 1 from unnest(coalesce(p.proconfig, array[]::text[])) as cfg
          where cfg like 'search_path=%'
        )
    ) then
      raise exception '自检失败：% 没有固定 search_path', v_func;
    end if;

    if not has_function_privilege('app_user', v_oid, 'EXECUTE') then
      raise exception '自检失败：app_user 不能执行 %', v_func;
    end if;

    if has_function_privilege('public', v_oid, 'EXECUTE') then
      raise exception '自检失败：PUBLIC 不该能执行 %', v_func;
    end if;
  end loop;

  -- 7.6 名称类排序必须显式 collate "C"（跨环境 collation 不同会给出不同顺序，见 0035）。
  --     只有「按 slug/标题并列排序」的两个列表函数需要它；投稿列表的并列键全是
  --     时间戳与 uuid，加 collate 反而会误导后来者以为那里也在比名称。
  select count(*) into v_count
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('api_list_themes', 'api_admin_list_themes')
    and p.prosrc like '%collate "C"%';
  if v_count < 2 then
    raise exception '自检失败：主题列表函数缺少 collate "C" 兜底排序（实际 % 个）', v_count;
  end if;

  raise notice 'OK: 0036 每周主题与活动（2 张表 / 9 个 security definer 函数 / 单一 active 主题约束）';
end;
$$;
