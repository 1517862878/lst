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
--
-- ⚠ 位置说明（本地真机执行后修正）：
--   这两个函数引用 public.profiles，但 profiles 表在 0003 才创建。
--   PostgreSQL 对 language sql 函数会在 CREATE 时校验函数体里的表引用，
--   因此若把函数留在本文件（0001），迁移会直接报
--   "关系 public.profiles 不存在"。
--   实际定义已移到 20261026000310_role_helpers.sql（紧随 profiles 之后）。
-- ----------------------------------------------------------------------------
;
