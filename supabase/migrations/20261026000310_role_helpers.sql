-- ============================================================================
-- 工科影展 · 0003b 角色判定助手（供 RLS 策略复用）
--
-- 为什么单列一个文件（本地真机执行后修正）：
--   这两个函数引用 public.profiles，但 PostgreSQL 对 language sql 函数
--   会在 CREATE 时校验函数体中的表是否存在。
--   原先放在 0001（建 profiles 之前）会在执行时报：
--     ERROR: 关系 "public.profiles" 不存在
--   故移到 profiles 之后，保证依赖顺序正确。
--
-- 何时需要 security definer：
--   RLS 策略里若要查 profiles 判断角色，直接查会再次触发 profiles 的 RLS
--   策略 → 无限递归。security definer 以属主身份执行，绕过该递归。
-- ============================================================================

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
