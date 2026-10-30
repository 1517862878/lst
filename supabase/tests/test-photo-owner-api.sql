-- ============================================================================
-- P0 作品 owner-only 编辑与软撤回可执行回归测试
-- 用法：psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d gongke \
--       -f supabase/test-photo-owner-api.sql
-- 前提：全部 migrations 已执行，landscape 分类存在。
-- ============================================================================
\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000000-0000-0000-0000-000000000001', 'p0-owner@test.local', '{"display_name":"P0 Owner"}'),
  ('b2000000-0000-0000-0000-000000000002', 'p0-other@test.local', '{"display_name":"P0 Other"}')
on conflict (id) do nothing;

-- profiles 由 auth.users 触发器创建；若测试环境禁用了触发器则显式补齐。
insert into public.profiles (id, username, display_name)
values
  ('a1000000-0000-0000-0000-000000000001', 'p0_owner', 'P0 Owner'),
  ('b2000000-0000-0000-0000-000000000002', 'p0_other', 'P0 Other')
on conflict (id) do nothing;

insert into public.photos (
  id, author_id, title, category_slug, image_key, thumb_key, width, height, status, published_at
) values (
  'c3000000-0000-0000-0000-000000000003',
  'a1000000-0000-0000-0000-000000000001',
  'P0 原标题', 'landscape',
  'photos/a1000000-0000-0000-0000-000000000001/c3000000-0000-0000-0000-000000000003/display.webp',
  'photos/a1000000-0000-0000-0000-000000000001/c3000000-0000-0000-0000-000000000003/thumb.webp',
  1200, 800, 'published', clock_timestamp()
) on conflict (id) do update set
  author_id = excluded.author_id,
  title = excluded.title,
  status = excluded.status,
  published_at = excluded.published_at,
  deleted_at = null;

-- 作者可编辑窄字段；不可变字段（authorId/imageKey/计数器等）不在白名单中。
select set_config('app.user_id', 'a1000000-0000-0000-0000-000000000001', true);
set local role app_user;
select public.api_update_photo(
  'c3000000-0000-0000-0000-000000000003',
  '{"title":"P0 新标题","tags":["Night","城市"],"license":"cc_by"}'::jsonb
);

do $$
begin
  if not exists (
    select 1 from public.photos
    where id = 'c3000000-0000-0000-0000-000000000003'
      and title = 'P0 新标题'
      and tags = array['night','城市']::text[]
      and license = 'cc_by'
      and deleted_at is null
  ) then
    raise exception '作者编辑断言失败';
  end if;
end;
$$;

-- 非作者调用必须表现为不存在，避免泄露私有作品是否存在。
reset role;
select set_config('app.user_id', 'b2000000-0000-0000-0000-000000000002', true);
set local role app_user;
do $$
begin
  begin
    perform public.api_update_photo(
      'c3000000-0000-0000-0000-000000000003',
      '{"title":"越权修改"}'::jsonb
    );
    raise exception '非作者修改竟然成功';
  exception when no_data_found then
    null;
  end;

  if public.api_remove_photo('c3000000-0000-0000-0000-000000000003') then
    raise exception '非作者撤回竟然成功';
  end if;
end;
$$;

-- 作者软撤回幂等：保留行和图片键，仅关闭可见性并写 deleted_at。
reset role;
select set_config('app.user_id', 'a1000000-0000-0000-0000-000000000001', true);
set local role app_user;
do $$
declare
  v_image_key text;
begin
  if not public.api_remove_photo('c3000000-0000-0000-0000-000000000003') then
    raise exception '作者首次撤回失败';
  end if;
  if not public.api_remove_photo('c3000000-0000-0000-0000-000000000003') then
    raise exception '作者幂等撤回失败';
  end if;

  select image_key into v_image_key
  from public.photos
  where id = 'c3000000-0000-0000-0000-000000000003'
    and status = 'removed'
    and deleted_at is not null;
  if v_image_key is null then
    raise exception '软撤回状态断言失败';
  end if;

  begin
    perform public.api_update_photo(
      'c3000000-0000-0000-0000-000000000003',
      '{"title":"撤回后修改"}'::jsonb
    );
    raise exception '撤回后修改竟然成功';
  exception when no_data_found then
    null;
  end;
end;
$$;

-- 匿名和其他用户都不可再读；作者仍可通过 RLS 查看自己的撤回记录用于审计。
-- 先复位角色再设置事务 GUC，避免 app_user 被数据库参数 ACL 限制。
reset role;
select set_config('app.user_id', 'b2000000-0000-0000-0000-000000000002', true);
set local role app_user;
do $$
begin
  if exists (select 1 from public.photos where id = 'c3000000-0000-0000-0000-000000000003') then
    raise exception '撤回作品仍对非作者可见';
  end if;
end;
$$;

reset role;
select set_config('app.user_id', 'a1000000-0000-0000-0000-000000000001', true);
set local role app_user;
do $$
begin
  if not exists (select 1 from public.photos where id = 'c3000000-0000-0000-0000-000000000003') then
    raise exception '作者无法查看自己的撤回记录';
  end if;
end;
$$;

rollback;
\echo 'P0 photo owner API tests passed'
