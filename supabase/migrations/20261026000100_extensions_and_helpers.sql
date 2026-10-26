-- ============================================================================
-- 工科影展 · 0001 扩展与通用助手函数
-- 依据：docs/DATA-MODEL.md §0 建模约定
-- 可在 Supabase 托管版或自托管版直接执行（Postgres 15+）
-- ============================================================================

-- citext：用户名大小写不敏感（DATA-MODEL §3.1：username 用 citext 保证 a/B 不撞车）
create extension if not exists citext;

-- pg_trgm：中文模糊搜索与相似度（D2 阶段搜索用，此处先启用，无副作用）
create extension if not exists pg_trgm;

-- ----------------------------------------------------------------------------
-- 通用：自动维护 updated_at
-- 规则：任何 UPDATE 都把 updated_at 推到 now()，禁止应用层手写
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is '通用 updated_at 触发器：UPDATE 时自动写 now()';

-- ----------------------------------------------------------------------------
-- 角色判定助手（供 RLS 策略复用）
-- 为什么用 security definer：避免在 profiles 的 RLS 策略里查 profiles 造成无限递归
-- ----------------------------------------------------------------------------
create or replace function public.current_role_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    'anonymous'
  );
$$;

comment on function public.current_role_name() is '当前登录用户的角色；未登录返回 anonymous';

create or replace function public.is_editor_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role_name() in ('editor', 'admin');
$$;

comment on function public.is_editor_or_admin() is '是否为编辑或管理员（内容治理用）';
