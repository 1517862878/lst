-- ============================================================================
-- 演示数据：作品 + 互动 + 文章
-- 用于验证 API 查询与分页
-- ============================================================================

\echo '=== 清理旧演示数据 ==='
delete from public.weekly_rank_entries;
delete from public.weekly_rank_snapshots;
delete from public.comments;
delete from public.likes;
delete from public.favorites;
delete from public.photos;
delete from public.articles;

\echo '=== 确认测试账号存在 ==='
select id, username, phone from public.profiles where username = '小何';

-- 作品：20 条，分散在不同分类与时间
insert into public.photos (
  author_id, title, description, category_slug, tags, location_name,
  location_precision, image_key, thumb_key, width, height,
  license, credit, status, published_at
)
select
  '11111111-2222-3333-4444-555555555555',
  t.title,
  t.descr,
  t.cat,
  t.tags,
  t.loc,
  'city',
  'photos/xiaohe/' || t.n || '/display.webp',
  'photos/xiaohe/' || t.n || '/thumb.webp',
  1200,
  800,
  'all_rights_reserved',
  null,
  'published',
  now() - (t.n || ' hours')::interval
from (
  values
    (1,  '晨雾中的山脊',   '清晨五点上山，等到第一缕光。', 'landscape',  array['风光','晨雾'], '四川·四姑娘山'),
    (2,  '老厂房的窗',     '午后的光穿过锈蚀的窗框。',     'industrial', array['工业','光影'], '重庆·钢铁厂'),
    (3,  '街角的修鞋匠',   '他在这里干了三十年。',         'people',     array['街拍','人文'], '成都·玉林路'),
    (4,  '钢结构之美',     '仰视时才发现线条如此有秩序。', 'architecture', array['建筑','结构'], '深圳·市民中心'),
    (5,  '电路板微距',     '一根比头发丝还细的走线。',     'technology', array['微距','科技'], '工作台'),
    (6,  '雨后的蛛网',     '水珠挂在网上，像一串灯。',     'macro',      array['微距','自然'], '小区花园'),
    (7,  '城市的夜',       '霓虹与车流拉扯成长线。',       'night',      array['夜景','长曝'], '上海·外滩'),
    (8,  '楼梯的螺旋',     '黑白让结构感更强。',           'monochrome', array['黑白','建筑'], '杭州·美术馆'),
    (9,  '山谷里的云海',   '等了三个小时才等到云开。',     'landscape',  array['风光','云海'], '云南·梅里'),
    (10, '焊接的火花',     '飞溅的铁水像流星。',           'industrial', array['工业','瞬间'], '船舶厂'),
    (11, '地铁上的人',     '每个人都在自己的世界里。',     'people',     array['街拍','人文'], '北京·十号线'),
    (12, '玻璃幕墙倒影',   '城市被折叠在玻璃里。',         'architecture', array['建筑','反射'], '陆家嘴'),
    (13, '芯片的纹理',     '放大二十倍后的集成电路。',     'technology', array['科技','微距'], '实验室'),
    (14, '花瓣上的露',     '清晨六点，露水还没散。',       'macro',      array['微距','花卉'], '公园'),
    (15, '星轨',           '四十分钟的曝光，地球在转。',   'night',      array['夜景','星空'], '青海·茶卡'),
    (16, '影调的层次',     '黑白里藏着丰富灰度。',         'monochrome', array['黑白','影调'], '摄影棚'),
    (17, '雪后的小径',     '没有人走过的雪地。',           'landscape',  array['风光','雪景'], '哈尔滨'),
    (18, '管道的秩序',     '工业设施也有构成美。',         'industrial', array['工业','构成'], '化工厂'),
    (19, '集市的热气',     '早点摊的蒸汽很有人间味。',     'people',     array['街拍','生活'], '西安·回民街'),
    (20, '图书馆穹顶',     '对称带来的安定感。',           'architecture', array['建筑','室内'], '天津')
) as t(n, title, descr, cat, tags, loc);

\echo '=== 作品数量 ==='
select count(*) as 作品数 from public.photos;

\echo '=== 点赞：给前 8 个作品随机点赞（制造热度差异）==='
insert into public.likes (user_id, photo_id, created_at)
select
  '11111111-2222-3333-4444-555555555555',
  p.id,
  now() - (random() * interval '5 days')
from public.photos p
where p.title in ('晨雾中的山脊','老厂房的窗','城市的夜','山谷里的云海')
on conflict do nothing;

\echo '=== 收藏：少量收藏（权重 3 倍）==='
insert into public.favorites (user_id, photo_id, created_at)
select
  '11111111-2222-3333-4444-555555555555',
  p.id,
  now() - (random() * interval '5 days')
from public.photos p
where p.title in ('晨雾中的山脊','街角的修鞋匠')
on conflict do nothing;

\echo '=== 计数是否被触发器更新 ==='
select title, like_count, favorite_count
  from public.photos
 where like_count > 0 or favorite_count > 0
 order by like_count desc;

\echo '=== 文章：4 篇 ==='
insert into public.articles (
  slug, topic_slug, title, summary, body_md, author_id,
  difficulty, reading_minutes, tags, status, published_at
)
values
  ('composition-basics', 'technique', '构图的三个基本问题',
   '主体在哪、视线往哪走、边缘有没有干扰。',
   '# 构图的三个基本问题

## 1. 主体在哪
## 2. 视线往哪走
## 3. 边缘有没有干扰',
   '11111111-2222-3333-4444-555555555555', 'beginner', 5,
   array['构图'], 'published', now() - interval '2 days'),

  ('lens-choice', 'gear', '第一支镜头怎么选',
   '别急着买，先问自己拍什么。',
   '# 第一支镜头怎么选

看拍什么，不看参数。',
   '11111111-2222-3333-4444-555555555555', 'beginner', 4,
   array['器材','镜头'], 'published', now() - interval '1 day'),

  ('color-grading', 'post', '从灰片到成片',
   '先用示波器定曝光，再谈风格。',
   '# 从灰片到成片

风格建立在准确之上。',
   '11111111-2222-3333-4444-555555555555', 'intermediate', 8,
   array['后期','调色'], 'published', now() - interval '3 hours'),

  ('photo-ethics', 'ethics', '街头拍摄的边界',
   '先有人，再有照片。',
   '# 街头拍摄的边界

尊重比作品重要。',
   '11111111-2222-3333-4444-555555555555', 'beginner', 3,
   array['伦理'], 'published', now() - interval '5 hours');

\echo '=== 文章数量 ==='
select count(*) as 文章数 from public.articles;

\echo '=== 周榜实时计算（验证函数）==='
select rank, photo_id, like_count, favorite_count, score
  from public.compute_weekly_ranking(
    date_trunc('week', now())::timestamptz,
    (date_trunc('week', now()) + interval '7 days')::timestamptz,
    'v1'
  )
 limit 5;

\echo '=== 完成 ==='
