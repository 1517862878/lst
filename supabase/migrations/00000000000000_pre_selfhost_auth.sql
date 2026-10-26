-- ============================================================================
-- 自托管兼容层（0000_pre_selfhost.sql）
--
-- 用途：在【非 Supabase】的原生 PostgreSQL 上跑通这套迁移。
-- 背景：migrations/ 里的 schema 是按 Supabase 写的，依赖两个专有对象：
--   1) auth.users 表            —— profiles.id 的外键目标
--   2) auth.uid() 函数          —— 16 条 RLS 策略用来判断"当前登录用户"
--   3) auth.users 上的注册触发器 —— handle_new_user() 自动建 profile
-- 原生 PG 没有这些，直接跑迁移会在第 3 个文件就因外键失败。
--
-- 本文件建立最小替身，让 10 个业务迁移原样执行、逻辑不变。
-- 【注意】这是本地验证用的骨架，不是生产鉴权方案：
--   - auth.uid() 读 GUC app.user_id，应用层每连接需 SET LOCAL app.user_id = '<uuid>'
--   - 真正的登录、密码、令牌发放由将来的 Node API 负责，不在此文件
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. 扩展
-- ---------------------------------------------------------------------------
create extension if not exists citext;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- 1. auth schema（模拟 Supabase 的 auth 命名空间）
-- ---------------------------------------------------------------------------
create schema if not exists auth;

-- ---------------------------------------------------------------------------
-- 2. auth.users：最小用户表
-- 只保留本套 schema 真正用到的列：
--   id          —— profiles.id 外键目标
--   email       —— handle_new_user() 取邮箱前缀生成 username
--   raw_user_meta_data —— handle_new_user() 读 display_name
--   password_hash / created_at —— 应用层登录用（未来接入）
-- ---------------------------------------------------------------------------
create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  password_hash       text,
  created_at          timestamptz not null default now()
);

comment on table auth.users is '自托管替身：Supabase auth.users 的最小版本（仅 schema 用到的列）';

-- ---------------------------------------------------------------------------
-- 3. auth.uid()：当前请求的用户 id
--
-- Supabase 版从 JWT 里取；自托管版从会话 GUC 取。
-- 应用层每次事务前执行：
--     set local app.user_id = '550e8400-e29b-41d4-a716-446655440000';
-- 未设置时返回 null —— 与 Supabase 匿名请求行为一致，RLS 会按"未登录"处理。
--
-- 为什么用 current_setting(..., true)：
--   第二个参数 true = 变量不存在时返回 NULL 而不是报错。
--   若用默认 false，匿名访问会直接抛 "unrecognized configuration parameter"。
-- ---------------------------------------------------------------------------
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid;
$$;

comment on function auth.uid() is '自托管替身：从会话 GUC app.user_id 取当前用户；未设置返回 null';

-- ---------------------------------------------------------------------------
-- 4. 兼容 Supabase 的 service_role 用法
-- 说明：迁移里只在注释提到 service_role，没有实际引用，此角色仅为将来预留。
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end;
$$;
