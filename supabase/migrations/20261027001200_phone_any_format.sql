-- ============================================================================
-- 工科影展 · 0012 手机号格式放宽
--
-- 需求变更（用户确认）：手机号「不限格式」
-- 原约束 1[3-9]\d{9} 会把 10 位的 1517862878 拒掉，无法用于测试账号。
--
-- 放宽后的规则（仍保留最小防滥用）：
--   - 长度 4–20 位
--   - 只允许数字、+、-、空格（兼容国际区号与分隔写法）
--   - 不允许纯空字符串
--
-- 仍然保留的约束：
--   - 唯一性（同一号码只能绑一个账号）—— 这是找回密码的基础
-- ============================================================================

-- 1. profiles.phone
alter table public.profiles drop constraint if exists ck_profiles_phone_format;
alter table public.profiles
  add constraint ck_profiles_phone_format
  check (
    phone is null
    or (
      char_length(phone) between 4 and 20
      and phone ~ '^[0-9+\- ]+$'
    )
  );

comment on column public.profiles.phone is
  '绑定手机号：4–20 位，允许数字/加号/连字符/空格（不限国家格式）；唯一';

-- 2. phone_verifications.phone
alter table public.phone_verifications drop constraint if exists phone_verifications_phone_check;
alter table public.phone_verifications
  add constraint ck_phone_verif_phone_format
  check (
    char_length(phone) between 4 and 20
    and phone ~ '^[0-9+\- ]+$'
  );

comment on column public.phone_verifications.phone is
  '手机号：4–20 位，不限国家格式';

-- 3. 验证用例（用 DO 块断言，迁移时可自检）
do $$
begin
  -- 1517862878（10 位）应当可用
  if not ('1517862878' ~ '^[0-9+\- ]+$' and char_length('1517862878') between 4 and 20) then
    raise exception '自检失败：1517862878 应被接受';
  end if;

  -- 带国际区号的写法也应当可用
  if not ('+86 151-7862-8780' ~ '^[0-9+\- ]+$') then
    raise exception '自检失败：国际格式应被接受';
  end if;

  -- 纯字母应当被拒
  if 'abcdefgh' ~ '^[0-9+\- ]+$' then
    raise exception '自检失败：字母应被拒绝';
  end if;

  -- 过短应当被拒
  if char_length('123') between 4 and 20 then
    raise exception '自检失败：3 位应被拒绝';
  end if;

  raise notice 'OK: 手机号格式自检全部通过';
end;
$$;
