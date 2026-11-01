\encoding UTF8
-- ============================================================================
-- 工科影展 · 0038 分类体系换代：题材维度 → 风格维度
--
-- 需求：产品把分类从「拍什么」（风景/人文/建筑/工业/科技/微距/夜景/黑白）
--       改为「拍成什么风格」（校园清新/旅行纪实/日系治愈/港风复古/
--       新中式国风/韩系清透/暗调电影感/美式复古）。
--
-- 为什么不能直接从旧行删掉再插新行：
--   photos.category_slug 是 `references public.categories (slug)`（见 0004），
--   只要还有历史作品挂旧 slug，`delete from categories` 就会被外键挡住。
--   所以必须先把历史作品迁移到新分类，再下架旧分类。
--
-- 旧→新映射（按语义最近，宁可归到风格相近的桶，也不让任何作品丢分类）：
--   landscape  风景  → travel-doc     旅行纪实（风光多在旅途中拍）
--   people     人文  → travel-doc     旅行纪实（纪实属性最强）
--   architecture 建筑 → cinematic-dark 暗调电影感（建筑强结构/强影调）
--   industrial 工业  → cinematic-dark 暗调电影感
--   technology 科技  → new-chinese    新中式国风（工科器物→东方意象是唯一弱映射）
--   macro      微距  → japanese-soft  日系治愈（细节特写多为柔光小景）
--   night      夜景  → hk-retro       港风复古（霓虹夜景最贴近港风）
--   monochrome 黑白  → cinematic-dark 暗调电影感（黑白即强影调）
--
-- 旧分类不物理删除，而是 is_active = false（软下架）：
--   1) 未登录访客仍可能持有 /categories/landscape 这类旧链接，
--      软下架后由页面按「分类已下架」处理，比外键报错温和；
--   2) 保留行才能在回滚时把映射还原，不用重建数据。
--   迁移末尾把历史作品的 category_slug 全部指向新分类，
--   因此下架后不会有作品挂在 is_active = false 的分类上（自检会验证这一点）。
--
-- 幂等（同一个库连着跑两遍）：
--   · 新分类用 insert ... on conflict (slug) do update
--   · 旧分类用 update ... where slug in (...)
--   · 数据迁移用 update ... where category_slug = <旧 slug>（第二次跑时已无匹配行）
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 插入 8 个新分类（与 src/domain/constants.ts 的 CATEGORIES 逐字段对齐）
--
-- sort_order 有唯一索引（uq_categories_sort_order，见 0002），
-- 而旧分类仍占着 1–8，所以插入前先把旧分类的 sort_order 挪到 100+，
-- 否则新分类插不进去。
-- ----------------------------------------------------------------------------

update public.categories
   set sort_order = sort_order + 100
 where slug in ('landscape','people','architecture','industrial',
                'technology','macro','night','monochrome');

insert into public.categories (slug, name, description, sort_order, is_active) values
  ('campus-fresh',   '校园清新',   '校园日常、青春感、明亮通透',     1, true),
  ('travel-doc',     '旅行纪实',   '旅途见闻、在地生活、纪实叙事',   2, true),
  ('japanese-soft',  '日系治愈',   '低对比、柔光、干净留白',         3, true),
  ('hk-retro',       '港风复古',   '霓虹、暖调、颗粒感与旧时光',     4, true),
  ('new-chinese',    '新中式国风', '写意留白、东方色、传统意象',     5, true),
  ('korean-clear',   '韩系清透',   '高亮低饱和、通透皮肤质感',       6, true),
  ('cinematic-dark', '暗调电影感', '低光、强影调、叙事感构图',       7, true),
  ('american-retro', '美式复古',   '暖橙、公路、复古颗粒',           8, true)
on conflict (slug) do update
   set name        = excluded.name,
       description = excluded.description,
       sort_order  = excluded.sort_order,
       is_active   = excluded.is_active;

-- ----------------------------------------------------------------------------
-- 2. 历史作品按语义映射到新分类
--
-- 必须在「下架旧分类」之前做，否则会出现「作品挂在未启用分类上」的窗口。
-- 用 where + in 一次性覆盖 8 组映射，避免 8 条 update 各自扫一遍表。
-- ----------------------------------------------------------------------------

update public.photos p
   set category_slug = m.new_slug,
       updated_at    = now()
  from (values
    ('landscape',    'travel-doc'),
    ('people',       'travel-doc'),
    ('architecture', 'cinematic-dark'),
    ('industrial',   'cinematic-dark'),
    ('technology',   'new-chinese'),
    ('macro',        'japanese-soft'),
    ('night',        'hk-retro'),
    ('monochrome',   'cinematic-dark')
  ) as m(old_slug, new_slug)
 where p.category_slug = m.old_slug;

-- ----------------------------------------------------------------------------
-- 3. 旧分类软下架
--
-- 只置 is_active = false，不删行：外键仍成立、旧链接可温和提示、
-- 回滚时无需重建数据。
-- ----------------------------------------------------------------------------

update public.categories
   set is_active = false
 where slug in ('landscape','people','architecture','industrial',
                'technology','macro','night','monochrome');

-- ----------------------------------------------------------------------------
-- 4. 自检：任何一条不满足就让迁移直接失败，而不是等线上才发现
-- ----------------------------------------------------------------------------

do $$
declare
  v_count integer;
  v_slug text;
begin
  -- 4.1 新分类必须 8 个且全部启用
  select count(*) into v_count
    from public.categories
   where slug in ('campus-fresh','travel-doc','japanese-soft','hk-retro',
                  'new-chinese','korean-clear','cinematic-dark','american-retro')
     and is_active;
  if v_count <> 8 then
    raise exception '0038 自检失败：启用中的新分类应 8 个，实际 %', v_count;
  end if;

  -- 4.2 旧分类必须全部下架
  select count(*) into v_count
    from public.categories
   where slug in ('landscape','people','architecture','industrial',
                  'technology','macro','night','monochrome')
     and is_active;
  if v_count <> 0 then
    raise exception '0038 自检失败：仍有 % 个旧分类处于启用状态', v_count;
  end if;

  -- 4.3 不得有作品挂在已下架的分类上（这是外键迁移没做完的典型症状）
  select count(*) into v_count
    from public.photos p
    join public.categories c on c.slug = p.category_slug
   where not c.is_active;
  if v_count <> 0 then
    raise exception '0038 自检失败：有 % 件作品仍挂在已下架分类', v_count;
  end if;

  -- 4.4 每个新分类都要存在且 sort_order 落在 1–8
  select count(*) into v_count
    from public.categories
   where slug in ('campus-fresh','travel-doc','japanese-soft','hk-retro',
                  'new-chinese','korean-clear','cinematic-dark','american-retro')
     and sort_order between 1 and 8;
  if v_count <> 8 then
    raise exception '0038 自检失败：新分类的 sort_order 未落在 1–8（实际 % 个）', v_count;
  end if;

  -- 4.5 抽查：任一旧 slug 都必须已经无作品引用（防止映射表漏项）
  for v_slug in
    select unnest(array['landscape','people','architecture','industrial',
                        'technology','macro','night','monochrome'])
  loop
    select count(*) into v_count from public.photos where category_slug = v_slug;
    if v_count <> 0 then
      raise exception '0038 自检失败：旧分类 % 仍有 % 件作品引用', v_slug, v_count;
    end if;
  end loop;

  raise notice '0038 自检通过：8 个风格分类已启用，旧分类已下架，历史作品已迁移';
end
$$;
