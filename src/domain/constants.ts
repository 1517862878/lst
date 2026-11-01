/**
 * 领域常量 —— 种子数据与白名单（DATA-MODEL §2 / §4 / §10）。
 * 规则：分类与主题在此定稿，S2 之后 slug 不得变更（URL 稳定性）。
 */
import type { ArticleTopic, Category } from './types'

// ===== 分类种子（8 个，定稿）=====
//
// 2026-11 分类体系换代：按「拍摄风格」而不是「题材」重新划分。
// 原先是 风景 / 人文 / 建筑 / 工业 / 科技 / 微距 / 夜景 / 黑白（题材维度），
// 现在改为风格维度（校园清新 … 美式复古），这是产品定位从「工科记录」
// 转向「风格化摄影社区」的直接体现。
//
// slug 命名规则：用英文风格名，保持 URL 可读且稳定（如 /categories/campus-fresh）。
// 旧 slug 的处置见 supabase/migrations/20261101003800_style_categories.sql：
// 迁移会把历史作品的 category_slug 映射到最接近的新分类，
// 保证外键不破、旧链接不出 404。

export const CATEGORIES: readonly Category[] = [
  { slug: 'campus-fresh', name: '校园清新', description: '校园日常、青春感、明亮通透', sortOrder: 1, coverPhotoId: null, isActive: true },
  { slug: 'travel-doc', name: '旅行纪实', description: '旅途见闻、在地生活、纪实叙事', sortOrder: 2, coverPhotoId: null, isActive: true },
  { slug: 'japanese-soft', name: '日系治愈', description: '低对比、柔光、干净留白', sortOrder: 3, coverPhotoId: null, isActive: true },
  { slug: 'hk-retro', name: '港风复古', description: '霓虹、暖调、颗粒感与旧时光', sortOrder: 4, coverPhotoId: null, isActive: true },
  { slug: 'new-chinese', name: '新中式国风', description: '写意留白、东方色、传统意象', sortOrder: 5, coverPhotoId: null, isActive: true },
  { slug: 'korean-clear', name: '韩系清透', description: '高亮低饱和、通透皮肤质感', sortOrder: 6, coverPhotoId: null, isActive: true },
  { slug: 'cinematic-dark', name: '暗调电影感', description: '低光、强影调、叙事感构图', sortOrder: 7, coverPhotoId: null, isActive: true },
  { slug: 'american-retro', name: '美式复古', description: '暖橙、公路、复古颗粒', sortOrder: 8, coverPhotoId: null, isActive: true },
]

// ===== 学习板块主题种子（4 个，定稿）=====

export const ARTICLE_TOPICS: readonly ArticleTopic[] = [
  { slug: 'technique', name: '拍摄技巧', description: '构图、用光、色彩、主题实战', sortOrder: 1 },
  { slug: 'gear', name: '器材', description: '机身、镜头、配件、选购', sortOrder: 2 },
  { slug: 'post', name: '后期', description: '基础调整、色彩管理、导出', sortOrder: 3 },
  { slug: 'ethics', name: '伦理与版权', description: '拍摄伦理、肖像权、署名', sortOrder: 4 },
]

// ===== EXIF 白名单（DATA-MODEL §10：用户已拍板）=====

export const EXIF_WHITELIST = [
  'Make',
  'Model',
  'LensModel',
  'FNumber',
  'ExposureTime',
  'ISO',
  'FocalLength',
  'DateTimeOriginal',
] as const

// ===== 演示账号（ROADMAP §5.1：alice / bob / editor，密码统一 demo1234）=====

export const DEMO_ACCOUNTS = [
  { username: 'alice', displayName: '爱丽丝', role: 'user' as const },
  { username: 'bob', displayName: '鲍勃', role: 'user' as const },
  { username: 'editor', displayName: '编辑小工', role: 'editor' as const },
]

export const DEMO_PASSWORD = 'demo1234'

/**
 * 分类 slug → 中文名映射（从 CATEGORIES 派生成 Map，避免多处硬编码）。
 *
 * 早先 PhotoCard 只对 landscape 做了映射，其余分类直接显示英文 slug
 * （卡片上出现 night / architecture / macro），WorkDetailPage 里又抄了一份表。
 * 现在只在这里生成一次，全站共用。
 */
export const CATEGORY_NAME_BY_SLUG: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.slug, c.name]),
)

/** 取分类中文名；未知 slug 原样返回 */
export function categoryName(slug: string): string {
  return CATEGORY_NAME_BY_SLUG[slug] ?? slug
}

/** 主题 slug → 中文名 */
export const TOPIC_NAME_BY_SLUG: Record<string, string> = Object.fromEntries(
  ARTICLE_TOPICS.map((t) => [t.slug, t.name]),
)

export function topicName(slug: string): string {
  return TOPIC_NAME_BY_SLUG[slug] ?? slug
}
