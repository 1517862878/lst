/**
 * 领域类型定义 —— 数据模型唯一事实源（DATA-MODEL §5 / ROADMAP L-1）。
 * 规则：实体类型只在本文定义；组件不得重复定义实体形状。
 * 枚举取值与 Postgres check 约束逐字一致；时间一律 ISO-8601 UTC 字符串。
 */

// ===== 通用 =====

/** UTC ISO-8601 字符串；禁止 Date 对象穿透到组件（ROADMAP §4.5） */
export type IsoDate = string

// ===== 枚举（与 DATA-MODEL §1 逐字一致）=====

export type UserRole = 'user' | 'editor' | 'admin'

export type PhotoStatus = 'draft' | 'published' | 'hidden' | 'removed'

export type PhotoLicense =
  | 'all_rights_reserved'
  | 'cc_by'
  | 'cc_by_nc'
  | 'cc_by_nc_nd'
  | 'cc0'

export type LocationPrecision = 'exact' | 'district' | 'city' | 'hidden'

export type CommentStatus = 'visible' | 'hidden' | 'removed'

/** 榜单类型：live = 当期实时榜（未结算），final = 已结算终榜 */
export type RankingKind = 'live' | 'final'

export type ArticleDifficulty = 'beginner' | 'intermediate' | 'advanced'

export type ArticleStatus = 'draft' | 'published'

export type ReportTargetType = 'photo' | 'comment' | 'profile'

export type ReportReason = 'copyright' | 'explicit' | 'spam' | 'abuse' | 'other'

export type ReportStatus = 'open' | 'reviewing' | 'upheld' | 'rejected'

// ===== 实体 =====

export interface Profile {
  id: string
  /** 2–20 字符，^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$（列类型 citext，大小写不敏感） */
  username: string
  /** 1–30 字符 */
  displayName: string
  avatarKey: string | null
  /** 0–160 字符 */
  bio: string
  role: UserRole
  /** 最多 3 条主页链接 */
  links: { label: string; url: string }[]
  licensePreference: PhotoLicense
  createdAt: IsoDate
  updatedAt: IsoDate
  deletedAt: IsoDate | null
}

export interface Photo {
  id: string
  authorId: string
  /** 1–60 字符 */
  title: string
  /** 0–2000 字符（拍摄心得） */
  description: string
  categorySlug: string
  /** ≤5，全小写 */
  tags: string[]
  /** 0–80 字符（拍摄地点文本） */
  locationName: string
  locationLat: number | null
  locationLng: number | null
  locationPrecision: LocationPrecision
  shotAt: IsoDate | null
  /** 仅白名单键（DATA-MODEL §10）：Make/Model/LensModel/FNumber/ExposureTime/ISO/FocalLength/DateTimeOriginal */
  exif: Record<string, unknown> | null
  imageKey: string
  thumbKey: string
  /** >0，防 CLS 占位 */
  width: number
  height: number
  blurhash: string | null
  license: PhotoLicense
  /** 非本人拍摄时的来源署名；示例素材固定 '示例素材' */
  credit: string | null
  status: PhotoStatus
  /** 以下四个计数只读派生（DATA-MODEL §0） */
  likeCount: number
  favoriteCount: number
  commentCount: number
  viewCount: number
  publishedAt: IsoDate | null
  createdAt: IsoDate
  updatedAt: IsoDate
  deletedAt: IsoDate | null
}

/** likes 与 favorites 共用结构 */
export interface Interaction {
  userId: string
  photoId: string
  /** 周榜按此落窗（ROADMAP §6.1） */
  createdAt: IsoDate
}

/**
 * 关注关系（follower 关注 following）。
 * 主键是 (followerId, followingId) —— 同一对用户只有一行，重复关注是幂等的。
 */
export interface Follow {
  followerId: string
  followingId: string
  createdAt: IsoDate
}

/** 某用户的关注数（粉丝数 / 关注数） */
export interface FollowCounts {
  followers: number
  following: number
}

/** 通知类型：点赞 / 评论 / 关注 / 系统 */
export type NotificationKind = 'like' | 'comment' | 'follow' | 'system'

/**
 * 站内通知（DATA-MODEL 二期）。
 *
 * 注意：契约里**没有** userId 字段 —— 后端只返回「当前登录用户」的通知，
 * 「这条通知属于谁」由会话决定，不在数据里。actor 直接内联资料对象，
 * 列表页因此不需要再按 id 批量取用户（避免 N+1）。
 */
export interface AppNotification {
  id: string
  kind: NotificationKind
  /** 触发者；系统通知为 null */
  actor: Profile | null
  photoId: string | null
  commentId: string | null
  /** null = 未读 */
  readAt: IsoDate | null
  createdAt: IsoDate
}

export interface Comment {
  id: string
  photoId: string
  authorId: string
  /** 仅指向顶层评论（一级回复，不盖楼） */
  parentId: string | null
  /** 1–500 字符，纯文本 */
  body: string
  status: CommentStatus
  createdAt: IsoDate
  updatedAt: IsoDate
  deletedAt: IsoDate | null
}

export interface Category {
  slug: string
  name: string
  description: string
  sortOrder: number
  coverPhotoId: string | null
  isActive: boolean
}

export interface RankingSnapshot {
  id: string
  /** 如 '2026-W44' */
  isoWeek: string
  kind: RankingKind
  timezone: string
  weekStartUtc: IsoDate
  weekEndUtc: IsoDate
  capturedAt: IsoDate
  formulaVersion: string
  entryCount: number
  status: 'ready'
}

export interface RankingEntry {
  snapshotId: string
  /** ≥1，全序唯一（score→favorite→like→publishedAt→id） */
  rank: number
  photoId: string
  likeCount: number
  favoriteCount: number
  score: number
  /** 审计键：`score:xx|f:x|l:x|publishedAt|id` */
  tieBreakKey: string
}

export interface ArticleTopic {
  slug: string
  name: string
  description: string
  sortOrder: number
}

export interface Article {
  id: string
  slug: string
  topicSlug: string
  title: string
  summary: string
  bodyMd: string
  coverKey: string | null
  authorId: string
  difficulty: ArticleDifficulty
  readingMinutes: number
  tags: string[]
  equipment: string[]
  relatedPhotoIds: string[]
  status: ArticleStatus
  publishedAt: IsoDate | null
  updatedAt: IsoDate
  version: number
}

export interface Report {
  id: string
  targetType: ReportTargetType
  targetId: string
  reason: ReportReason
  /** 0–500 字符 */
  detail: string
  /** 允许匿名举报 */
  reporterId: string | null
  status: ReportStatus
  createdAt: IsoDate
  resolvedAt: IsoDate | null
}

// ===== 会话（静态期伪造，见 ROADMAP §5.1）=====

export interface Session {
  userId: string
  username: string
  displayName: string
  avatarKey: string | null
  role: UserRole
  expiresAt: IsoDate
}

// ===== 列表/分页辅助（契约层使用）=====

/** 游标分页：opaque cursor + hasMore */
export interface Page<T> {
  items: T[]
  /** 下一页游标；null 表示没有更多 */
  nextCursor: string | null
  total: number
}
