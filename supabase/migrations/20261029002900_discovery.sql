\encoding UTF8
-- ============================================================================
-- 工科影展 · 0029 发现增强（8.3c 后端）
-- 依据：.tmp/phase83c-freeze.md（绑定契约）· docs/主线与并行工作线汇总报告 §8.3
--
-- 本迁移提供四件事：
--   1) 搜索日志（search_logs）与热门搜索聚合
--   2) 编辑精选（photos.featured_at + 审计）
--   3) 新作者推荐（口径收口在 SQL）
--   4) 精选作品流的读取口径不在这里 —— 见迁移末尾「为什么不加第 5 个函数」
--
-- 口径统一：只统计 status = 'published' and deleted_at is null and published_at is not null。
--
-- 幂等要求（这套迁移会被反复重放做验收）：
--   * 建表用 create table if not exists、加列用 add column if not exists
--   * 函数一律先 drop function if exists 再 create（重放时参数表变了也不会撞）
--   * 授权在 drop 之后重新给（drop 会连带丢掉权限）
--   * 末尾 DO 块自检：RLS、app_user 无直接权限、PUBLIC 不能执行、definer 与 search_path
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 搜索日志
--
-- 为什么落库而不是只放浏览器：热门搜索要能反映「全站真正在搜什么」。
-- 只存 term 与哈希后的 IP，不存原始 IP、不存 referer、不做用户画像拼接。
-- ---------------------------------------------------------------------------
create table if not exists public.search_logs (
  id uuid primary key default gen_random_uuid(),
  term text not null,
  term_key text not null,
  user_id uuid,
  ip_hash text,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_search_logs_term' and conrelid = 'public.search_logs'::regclass
  ) then
    alter table public.search_logs
      add constraint ck_search_logs_term check (char_length(btrim(term)) between 1 and 40);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ck_search_logs_term_key' and conrelid = 'public.search_logs'::regclass
  ) then
    alter table public.search_logs
      add constraint ck_search_logs_term_key check (char_length(term_key) between 1 and 40);
  end if;
end;
$$;

-- user_id 不建外键：搜索日志是「统计用途的匿名流水」，账号注销后把 user_id 置空即可，
-- 不该因为外键让注销流程被日志卡住（0015 的注销函数已经把 user_id 抹成 null）。
create index if not exists idx_search_logs_created on public.search_logs (created_at desc);
create index if not exists idx_search_logs_term on public.search_logs (term_key, created_at desc);
create index if not exists idx_search_logs_user on public.search_logs (user_id, created_at desc) where user_id is not null;

comment on table public.search_logs is
  '搜索词流水（只存 term / term_key / user_id / ip_hash，用于热门搜索聚合）。保留策略由运维按需清理，本项目不做自动 TTL。';

alter table public.search_logs enable row level security;
revoke all on public.search_logs from public, app_user;

-- ---------------------------------------------------------------------------
-- 2. 编辑精选
-- ---------------------------------------------------------------------------
alter table public.photos add column if not exists featured_at timestamptz;

create index if not exists idx_photos_featured
  on public.photos (featured_at desc, id desc)
  where featured_at is not null;

comment on column public.photos.featured_at is
  '编辑精选时间戳；null = 未精选。只允许走 api_set_editor_choice 修改，由 staff 操作并写审计。';

-- ---------------------------------------------------------------------------
-- 2.5 扩展审计动作枚举
--
-- moderation_actions 是只追加审计表，action_type 有白名单约束。编辑精选也需要留痕，
-- 但既有白名单里没有 feature / unfeature —— 直接 insert 会被约束打回
-- （实测报错：新列违反了检查约束 ck_moderation_actions_action_type）。
-- 这里把两个动作补进白名单；只加不减，历史审计行不受影响。
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  -- 全库从零迁移时，action_type 白名单可能叫 moderation_actions_action_type_check
  -- （0025 建表时的默认名），也可能叫 ck_moderation_actions_action_type（后续迁移
  -- 统一改名）。两个名字都要尝试删除，否则会漏掉真正生效的那条。
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = 'public.moderation_actions'::regclass
     and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%action_type%'
   order by (pg_get_constraintdef(c.oid) like '%feature%') desc
   limit 1;

  if v_def is null then
    raise exception '0029 自检失败：找不到 moderation_actions 的 action_type 检查约束';
  end if;

  if v_def not like '%feature%' then
    alter table public.moderation_actions drop constraint if exists moderation_actions_action_type_check;
    alter table public.moderation_actions drop constraint if exists ck_moderation_actions_action_type;
    alter table public.moderation_actions
      add constraint ck_moderation_actions_action_type check (action_type = any (array[
        'claim_report','uphold_report','reject_report',
        'hide_photo','restore_photo','hide_comment','restore_comment',
        'warn_user','restrict_user','suspend_user','ban_user','revoke_sanction',
        'feature','unfeature'
      ]::text[]));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. 记录一次搜索
--
-- 去噪：同一个用户（或同一个 IP）对同一个归一化词，10 分钟内只记一条。
-- 不做限流（限流在路由层），因为这里只关心「有没有人搜过」。
-- 空词直接返回（不抛错）：日志失败不该影响搜索本身。
-- ---------------------------------------------------------------------------
drop function if exists public.api_log_search(text, uuid, text);
create function public.api_log_search(
  p_term text,
  p_user_id uuid default null,
  p_ip_hash text default null
) returns void
language plpgsql volatile security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_term text := btrim(coalesce(p_term, ''));
  v_key text;
  v_user uuid := p_user_id;
begin
  if char_length(v_term) = 0 then
    return;
  end if;

  -- 超长词截断而不是拒绝：日志用途，不需要跟用户较劲
  if char_length(v_term) > 40 then
    v_term := left(v_term, 40);
  end if;

  v_key := lower(v_term);

  if v_user is not null and not exists (select 1 from auth.users u where u.id = v_user) then
    v_user := null;
  end if;

  if exists (
    select 1 from public.search_logs s
     where s.term_key = v_key
       and s.created_at > now() - interval '10 minutes'
       and (
         (v_user is not null and s.user_id = v_user)
         or (v_user is null and p_ip_hash is not null and s.ip_hash = p_ip_hash)
       )
  ) then
    return;
  end if;

  insert into public.search_logs (term, term_key, user_id, ip_hash)
  values (v_term, v_key, v_user, nullif(btrim(coalesce(p_ip_hash, '')), ''));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. 热门搜索
--
-- 只统计出现 ≥3 次的词（否则「有人搜过一次的错别字」也会被推荐）；
-- 同一 term_key 展示「最近一次」的原始写法，保留用户更自然的写法（如 Nikon / nikon）。
-- ---------------------------------------------------------------------------
drop function if exists public.api_hot_searches(integer, integer);
create function public.api_hot_searches(
  p_days integer default 7,
  p_limit integer default 10
) returns table(term text, search_count bigint)
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 30);
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 20);
begin
  return query
  select (array_agg(s.term order by s.created_at desc))[1] as term,
         count(*) as search_count
    from public.search_logs s
   where s.created_at >= now() - make_interval(days => v_days)
   group by s.term_key
  having count(*) >= 3
   order by count(*) desc, max(s.created_at) desc
   limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. 编辑精选打标 / 取消（staff）
--
-- 角色在函数内部再校验一次：路由层已经拦过，但函数是 definer，不能被别处顺手调用绕过。
-- 审计写入 moderation_actions（只追加表），既有列：
--   id, report_id, actor_id, action_type, target_type, target_id, reason,
--   before_state, after_state, sanction_id, request_id, created_at
-- ---------------------------------------------------------------------------
drop function if exists public.api_set_editor_choice(uuid, uuid, boolean);
create function public.api_set_editor_choice(
  p_photo_id uuid,
  p_staff_id uuid,
  p_featured boolean
) returns table(photo_id uuid, featured_at timestamptz)
language plpgsql volatile security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_role text;
  v_before timestamptz;
  v_after timestamptz;
begin
  select p.role into v_role
    from public.profiles p
   where p.id = p_staff_id and p.deleted_at is null;
  if v_role is null or v_role not in ('editor', 'admin') then
    raise exception '无权设置编辑精选' using errcode = '42501';
  end if;

  select ph.featured_at into v_before
    from public.photos ph
   where ph.id = p_photo_id
     and ph.status = 'published'
     and ph.deleted_at is null;
  if not found then
    raise exception '作品不存在或不在架' using errcode = 'P0002';
  end if;

  update public.photos
     set featured_at = case when coalesce(p_featured, false) then now() else null end
   where id = p_photo_id
  returning photos.featured_at into v_after;

  insert into public.moderation_actions (actor_id, action_type, target_type, target_id, reason, before_state, after_state)
  values (
    p_staff_id,
    case when coalesce(p_featured, false) then 'feature' else 'unfeature' end,
    'photo',
    p_photo_id,
    'editor_choice',
    jsonb_build_object('featuredAt', v_before),
    jsonb_build_object('featuredAt', v_after)
  );

  return query select p_photo_id, v_after;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. 新作者推荐
--
-- 「新」= profiles.created_at 在窗口内；最少 1 件在架作品（否则点进去是空主页）。
-- 排序：总获赞 → 作品数 → 注册时间倒序。
-- **不返回 UUID**：延续 0018 起「公开载荷不暴露用户 UUID」的约定，前端用 username 做 key。
-- ---------------------------------------------------------------------------
drop function if exists public.api_list_new_authors(integer, integer);
create function public.api_list_new_authors(
  p_days integer default 90,
  p_limit integer default 6
) returns table(
  username citext,
  display_name text,
  avatar_key text,
  photo_count integer,
  like_total bigint,
  member_since timestamptz
)
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 90), 7), 365);
  v_limit integer := least(greatest(coalesce(p_limit, 6), 1), 24);
begin
  return query
  select p.username,
         p.display_name,
         p.avatar_key,
         count(ph.id)::integer as photo_count,
         coalesce(sum(ph.like_count), 0)::bigint as like_total,
         p.created_at as member_since
    from public.profiles p
    join public.photos ph
      on ph.author_id = p.id
     and ph.status = 'published'
     and ph.deleted_at is null
     and ph.published_at is not null
   where p.deleted_at is null
     and p.role not in ('editor', 'admin')
     and p.created_at >= now() - make_interval(days => v_days)
   group by p.id, p.username, p.display_name, p.avatar_key, p.created_at
   order by like_total desc, photo_count desc, p.created_at desc
   limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. 授权（drop function 会连带丢掉权限，所以必须放在函数定义之后重做一遍）
-- ---------------------------------------------------------------------------
revoke all on function public.api_log_search(text, uuid, text) from public, app_user;
grant execute on function public.api_log_search(text, uuid, text) to app_user;

revoke all on function public.api_hot_searches(integer, integer) from public, app_user;
grant execute on function public.api_hot_searches(integer, integer) to app_user;

revoke all on function public.api_set_editor_choice(uuid, uuid, boolean) from public, app_user;
grant execute on function public.api_set_editor_choice(uuid, uuid, boolean) to app_user;

revoke all on function public.api_list_new_authors(integer, integer) from public, app_user;
grant execute on function public.api_list_new_authors(integer, integer) to app_user;

-- ---------------------------------------------------------------------------
-- 8. 为什么不加「精选作品流」的 SQL 函数
--
-- api_list_photos 已经是「作品投影 + 作者公开字段」的唯一出口，精选流只多一个
-- `featured_at is not null` 的过滤条件与一个 featured_at 游标。再写一个 SQL 函数
-- 等于把同一份投影抄第二遍，迟早分叉（8.3a 的标签就吃过这个亏）。
-- 所以精选流在 server/src/repositories/discover.ts 里复用同一套投影与 RLS，
-- 只加过滤与排序键。视图层不可见性仍由 photos 的 RLS 兜底。
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 9. 自检
-- ---------------------------------------------------------------------------
do $$
declare
  v_sig text;
  v_oid oid;
  v_public_can_execute boolean;
begin
  if to_regclass('public.search_logs') is null then
    raise exception '0029 自检失败：表 public.search_logs 不存在';
  end if;

  if not exists (
    select 1 from pg_class c
     where c.oid = 'public.search_logs'::regclass and c.relrowsecurity
  ) then
    raise exception '0029 自检失败：public.search_logs 未启用 RLS';
  end if;

  if has_table_privilege('app_user', 'public.search_logs', 'select')
     or has_table_privilege('app_user', 'public.search_logs', 'insert') then
    raise exception '0029 自检失败：app_user 不应能直接读写 public.search_logs';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'photos' and column_name = 'featured_at'
  ) then
    raise exception '0029 自检失败：public.photos.featured_at 不存在';
  end if;

  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.moderation_actions'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%action_type%'
       and pg_get_constraintdef(c.oid) like '%feature%'
  ) then
    raise exception '0029 自检失败：moderation_actions.action_type 白名单未包含 feature';
  end if;

  foreach v_sig in array array[
    'public.api_log_search(text,uuid,text)',
    'public.api_hot_searches(integer,integer)',
    'public.api_set_editor_choice(uuid,uuid,boolean)',
    'public.api_list_new_authors(integer,integer)'
  ] loop
    v_oid := to_regprocedure(v_sig);
    if v_oid is null then
      raise exception '0029 自检失败：函数 % 不存在', v_sig;
    end if;

    if not exists (
      select 1 from pg_proc p where p.oid = v_oid and p.prosecdef
    ) then
      raise exception '0029 自检失败：函数 % 不是 security definer', v_sig;
    end if;

    if not exists (
      select 1 from pg_proc p
       where p.oid = v_oid
         and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')
    ) then
      raise exception '0029 自检失败：函数 % 没有固定 search_path', v_sig;
    end if;

    if not has_function_privilege('app_user', v_oid, 'execute') then
      raise exception '0029 自检失败：app_user 不能执行 %', v_sig;
    end if;

    select exists (
      select 1 from information_schema.routine_privileges a
       where a.specific_schema = 'public'
         and a.routine_name = split_part(split_part(v_sig, '(', 1), '.', 2)
         and a.grantee = 'PUBLIC'
         and a.privilege_type = 'EXECUTE'
    ) into v_public_can_execute;

    if coalesce(v_public_can_execute, false) then
      raise exception '0029 自检失败：PUBLIC 仍然可以执行 %（revoke 没生效）', v_sig;
    end if;
  end loop;

  raise notice 'OK: 0029 发现增强迁移自检通过（search_logs 收口 / featured_at 就位 / 4 个 definer 函数 definer+search_path+app_user 可执行+PUBLIC 已收口）';
end;
$$;
