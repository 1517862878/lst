/**
 * 数据库行 → 前端实体 的映射层。
 *
 * 为什么必须映射，而不是直接返回查询结果：
 *   1) 数据库用 snake_case（published_at）、前端用 camelCase（publishedAt）
 *   2) 数据库时间类型是 timestamptz，前端约定是 ISO-8601 字符串
 *   3) 数据库有内部字段（如 code_hash/salt）绝不能外泄
 *   4) numeric 类型 pg 驱动返回 string，前端要 number
 *
 * 这层是前端"页面零改动"的关键：
 *   只要映射结果与 src/domain/types.ts 的形状一致，前端就感觉不到换了后端。
 */

/** timestamptz → ISO 字符串；null 保持 null */
function iso(value: unknown): string | null {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

/** numeric → number（pg 驱动把 numeric 返回成字符串） */
function num(value: unknown): number {
  if (value == null) return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** 可空 number */
function numOrNull(value: unknown): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export interface ProfileRow {
  id: string
  username: string
  display_name: string
  avatar_key: string | null
  bio: string
  role: string
  links: unknown
  license_preference: string
  phone: string | null
  phone_verified_at: unknown
  created_at: unknown
  updated_at: unknown
  deleted_at: unknown
}

/** 对应前端 Profile */
export function mapProfile(row: ProfileRow) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarKey: row.avatar_key,
    bio: row.bio,
    role: row.role,
    links: Array.isArray(row.links) ? row.links : [],
    licensePreference: row.license_preference,
    phone: row.phone,
    phoneVerifiedAt: iso(row.phone_verified_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    deletedAt: iso(row.deleted_at),
  }
}

export interface PhotoRow {
  id: string
  author_id: string
  title: string
  description: string
  category_slug: string
  tags: string[] | null
  location_name: string
  location_lat: unknown
  location_lng: unknown
  location_precision: string
  shot_at: unknown
  exif: unknown
  image_key: string
  thumb_key: string
  width: number
  height: number
  blurhash: string | null
  license: string
  credit: string | null
  status: string
  like_count: number
  favorite_count: number
  comment_count: number
  view_count: number
  published_at: unknown
  created_at: unknown
  updated_at: unknown
  deleted_at: unknown
}

/** 对应前端 Photo */
export function mapPhoto(row: PhotoRow) {
  return {
    id: row.id,
    authorId: row.author_id,
    title: row.title,
    description: row.description,
    categorySlug: row.category_slug,
    tags: row.tags ?? [],
    locationName: row.location_name,
    locationLat: numOrNull(row.location_lat),
    locationLng: numOrNull(row.location_lng),
    locationPrecision: row.location_precision,
    shotAt: iso(row.shot_at),
    exif: (row.exif as Record<string, unknown> | null) ?? null,
    imageKey: row.image_key,
    thumbKey: row.thumb_key,
    width: row.width,
    height: row.height,
    blurhash: row.blurhash,
    license: row.license,
    credit: row.credit,
    status: row.status,
    likeCount: row.like_count,
    favoriteCount: row.favorite_count,
    commentCount: row.comment_count,
    viewCount: row.view_count,
    publishedAt: iso(row.published_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    deletedAt: iso(row.deleted_at),
  }
}

export interface CategoryRow {
  slug: string
  name: string
  description: string
  sort_order: number
  cover_photo_id: string | null
  is_active: boolean
}

/** 对应前端 Category */
export function mapCategory(row: CategoryRow) {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
    coverPhotoId: row.cover_photo_id,
    isActive: row.is_active,
  }
}

export interface ArticleRow {
  id: string
  slug: string
  topic_slug: string
  title: string
  summary: string
  body_md: string
  cover_key: string | null
  author_id: string
  difficulty: string
  reading_minutes: number
  tags: string[] | null
  equipment: string[] | null
  related_photo_ids: string[] | null
  status: string
  published_at: unknown
  updated_at: unknown
  version: number
}

/** 对应前端 Article */
export function mapArticle(row: ArticleRow) {
  return {
    id: row.id,
    slug: row.slug,
    topicSlug: row.topic_slug,
    title: row.title,
    summary: row.summary,
    bodyMd: row.body_md,
    coverKey: row.cover_key,
    authorId: row.author_id,
    difficulty: row.difficulty,
    readingMinutes: row.reading_minutes,
    tags: row.tags ?? [],
    equipment: row.equipment ?? [],
    relatedPhotoIds: row.related_photo_ids ?? [],
    status: row.status,
    publishedAt: iso(row.published_at),
    updatedAt: iso(row.updated_at),
    version: row.version,
  }
}

export interface ArticleTopicRow {
  slug: string
  name: string
  description: string
  sort_order: number
}

export function mapArticleTopic(row: ArticleTopicRow) {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
  }
}

export interface CommentRow {
  id: string
  photo_id: string
  author_id: string
  parent_id: string | null
  body: string
  status: string
  created_at: unknown
  updated_at: unknown
  deleted_at: unknown
}

/** 对应前端 Comment */
export function mapComment(row: CommentRow) {
  return {
    id: row.id,
    photoId: row.photo_id,
    authorId: row.author_id,
    parentId: row.parent_id,
    body: row.body,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    deletedAt: iso(row.deleted_at),
  }
}

export interface RankingEntryRow {
  rank: number
  photo_id: string
  like_count: number
  favorite_count: number
  score: unknown
  tie_break_key: string
}

/** 对应前端 RankingEntry */
export function mapRankingEntry(row: RankingEntryRow) {
  return {
    rank: row.rank,
    photoId: row.photo_id,
    likeCount: row.like_count,
    favoriteCount: row.favorite_count,
    score: num(row.score),
    tieBreakKey: row.tie_break_key,
  }
}

export { iso, num, numOrNull }
