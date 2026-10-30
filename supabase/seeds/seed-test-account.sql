-- ============================================================================
-- 创建测试账号：小何 / 1517862878 / 手机 1517862878
--
-- 说明：
--   password_hash 这里用占位字符串，真实哈希由后端 API 用 argon2id 生成。
--   （数据库层不该知道密码算法；API 写入时替换即可）
-- ============================================================================

\echo '=== 清理可能存在的同名账号 ==='
delete from public.profiles where username = '小何';
delete from auth.users where phone = '1517862878';

\echo '=== 创建账号 ==='
insert into auth.users (id, phone, phone_verified_at, raw_user_meta_data, password_hash)
values (
  '11111111-2222-3333-4444-555555555555',
  '1517862878',
  now(),
  '{"display_name": "小何", "username": "小何"}'::jsonb,
  'PLACEHOLDER_WILL_BE_REPLACED_BY_API_ARGON2ID'
);

\echo '=== 验证触发器自动建了 profile ==='
select id, username, display_name, phone, role
  from public.profiles
 where phone = '1517862878';

\echo '=== 修正用户名为「小何」（触发器可能生成了 user 开头的默认名）==='
update public.profiles
   set username = '小何', display_name = '小何'
 where id = '11111111-2222-3333-4444-555555555555';

select id, username, display_name, phone, phone_verified_at is not null as 手机已验证
  from public.profiles
 where id = '11111111-2222-3333-4444-555555555555';

\echo '=== 最终确认 ==='
select
  u.id,
  u.phone                                as auth_手机,
  p.username                             as 用户名,
  p.display_name                         as 显示名,
  char_length(u.password_hash)           as 密码哈希长度
from auth.users u
join public.profiles p on p.id = u.id
where u.phone = '1517862878';
