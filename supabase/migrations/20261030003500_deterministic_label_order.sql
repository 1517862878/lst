-- 0035：把「计数相同则按名称」的次序钉死为字节序（collate "C"）
--
-- 为什么需要这个迁移（不是洁癖，是一个真实的可移植性缺陷）：
--   0031 里 api_list_gear 与 api_list_places 的名称兜底排序是 `label asc`，
--   用的是**数据库默认排序规则**。本机数据库的 datcollate 是
--   `Chinese (Simplified)_China.936`（Windows 中文排序），中文按拼音排：
--       杭州·西湖  <  上海·外滩
--   而生产/Linux/CI 上常见的 en_US.UTF-8 或 C 排序按码位排，结果正好相反。
--   也就是说：同一份代码、同一批数据，在不同机器上「热门地点/器材」的顺序不同，
--   mock 实现（JS localeCompare）也会跟着环境变 —— 本地预览与线上演示不一致。
--
-- 做法：只把名称兜底那一段强制 `collate "C"`（UTF-8 下即码位序），
--   与前端 `compareLabel()`（逐码位比较）逐字一致，任何环境结果都相同。
--   注意**不要**改主排序键：主键仍是 photo_count desc / kind asc。
--
-- 顺带修掉第二处 mock/api 不一致（同一类问题的另一半）：
--   mock 的 places 排序是「作品数 → 最新发布时间 → 名称」，而 0031 的
--   api_list_places 只有「作品数 → 名称」。两套实现的并列次序不同，
--   在作品数相同的地点之间本地预览与线上就会不同序。这里把 SQL 补齐成
--   与 mock 相同的三键次序（latest_published_at desc nulls last）。
--
-- 用 create or replace 而不是 drop+create：签名、返回类型与参数名都没变，
-- 而 drop 会连带丢掉函数上的 grant（0029/0031/0033 都踩过这个坑）。
-- 注意必须是 **or replace**：写成 create function 在第二次执行时直接报
-- 「带相同参数类型的函数 api_list_gear 已经存在」——迁移必须可重放。
-- ----------------------------------------------------------------------------

create or replace function public.api_list_gear(p_limit integer default 30)
returns table(
  kind text,
  label text,
  photo_count integer,
  author_count integer
)
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  return query
    select g.kind, g.label, g.photo_count, g.author_count
      from (
        -- 机身：label = "Make Model"；按归一化键分组，展示取组内最小原始写法
        select 'body'::text as kind,
               min(btrim(coalesce(p.exif ->> 'Make', '') || ' ' || coalesce(p.exif ->> 'Model', ''))) as label,
               count(*)::integer as photo_count,
               count(distinct p.author_id)::integer as author_count
          from public.photos p
          join public.profiles a on a.id = p.author_id
         where p.status = 'published'
           and p.deleted_at is null
           and p.published_at is not null
           and p.exif_hidden = false
           and a.exif_visibility <> 'hidden'
           and btrim(coalesce(p.exif ->> 'Make', '') || ' ' || coalesce(p.exif ->> 'Model', '')) <> ''
         group by lower(btrim(coalesce(p.exif ->> 'Make', '') || ' ' || coalesce(p.exif ->> 'Model', '')))

        union all

        -- 镜头：label = LensModel
        select 'lens'::text as kind,
               min(btrim(coalesce(p.exif ->> 'LensModel', ''))) as label,
               count(*)::integer as photo_count,
               count(distinct p.author_id)::integer as author_count
          from public.photos p
          join public.profiles a on a.id = p.author_id
         where p.status = 'published'
           and p.deleted_at is null
           and p.published_at is not null
           and p.exif_hidden = false
           and a.exif_visibility <> 'hidden'
           and btrim(coalesce(p.exif ->> 'LensModel', '')) <> ''
         group by lower(btrim(coalesce(p.exif ->> 'LensModel', '')))
      ) g
     order by g.photo_count desc, g.kind asc, g.label collate "C" asc
     limit v_limit;
end;
$$;

create or replace function public.api_list_places(p_limit integer default 30)
returns table(
  label text,
  photo_count integer,
  author_count integer,
  latest_published_at timestamptz
)
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  return query
    select min(btrim(p.location_name)) as label,
           count(*)::integer as photo_count,
           count(distinct p.author_id)::integer as author_count,
           max(p.published_at) as latest_published_at
      from public.photos p
     where p.status = 'published'
       and p.deleted_at is null
       and p.published_at is not null
       and p.location_precision <> 'hidden'
       and btrim(p.location_name) <> ''
     group by lower(btrim(p.location_name))
     order by photo_count desc, latest_published_at desc nulls last, label collate "C" asc
     limit v_limit;
end;
$$;

-- 自检：两个函数体内必须都带上 collate "C"，否则等于没改。
do $$
declare
  v_missing text;
begin
  select string_agg(p.proname, ', ') into v_missing
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('api_list_gear', 'api_list_places')
     and p.prosrc not like '%collate "C"%';

  if v_missing is not null then
    raise exception '0035 自检失败：这些函数缺少 collate "C" 兜底 -> %', v_missing;
  end if;

  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'api_list_places') then
    raise exception '0035 自检失败：api_list_places 不存在';
  end if;

  raise notice 'OK: 0035 器材/地点名称兜底排序已固定为 collate "C"';
end $$;
