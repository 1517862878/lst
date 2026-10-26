/**
 * 领域常量 —— 种子数据与白名单（DATA-MODEL §2 / §4 / §10）。
 * 规则：分类与主题在此定稿，S2 之后 slug 不得变更（URL 稳定性）。
 */
import type { ArticleTopic, Category } from './types'

// ===== 分类种子（8 个，定稿）=====

export const CATEGORIES: readonly Category[] = [
  { slug: 'landscape', name: '风景', description: '自然风光、地貌、天象', sortOrder: 1, coverPhotoId: null, isActive: true },
  { slug: 'people', name: '人文', description: '纪实、街拍、人物与生活', sortOrder: 2, coverPhotoId: null, isActive: true },
  { slug: 'architecture', name: '建筑', description: '建筑外观、室内、结构', sortOrder: 3, coverPhotoId: null, isActive: true },
  { slug: 'industrial', name: '工业', description: '工厂、机械、工程现场', sortOrder: 4, coverPhotoId: null, isActive: true },
  { slug: 'technology', name: '科技', description: '科技产品、实验、数码', sortOrder: 5, coverPhotoId: null, isActive: true },
  { slug: 'macro', name: '微距', description: '微距摄影、细节特写', sortOrder: 6, coverPhotoId: null, isActive: true },
  { slug: 'night', name: '夜景', description: '夜间、长曝、星空', sortOrder: 7, coverPhotoId: null, isActive: true },
  { slug: 'monochrome', name: '黑白', description: '黑白摄影、影调', sortOrder: 8, coverPhotoId: null, isActive: true },
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
