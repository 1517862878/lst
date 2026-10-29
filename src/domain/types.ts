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
  /**
   * 当前访客与该用户之间是否存在拉黑（任一方向为 true）。
   *
   * 可选：mock 侧按需填充，api 侧由公开资料接口返回；「本人」与「匿名」
   * 都可能拿不到这个字段，所以页面必须容忍 undefined。
   */
  isBlocked?: boolean
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

/**
 * 用户搜索结果里的一行（二期「用户搜索」）。
 *
 * 刻意不复用 Profile：搜索结果不返回 UUID、不需要 links/role 等字段，
 * 且必须带上「我是否已关注」——它在列表里就要能直接点关注按钮。
 */
export interface UserHit {
  username: string
  displayName: string
  avatarKey: string | null
  bio: string
  followerCount: number
  isFollowing: boolean
}

/**
 * 我拉黑的一个人（设置中心「黑名单」页）。
 *
 * 只保留展示与解除拉黑所需的字段；后端不返回被拉黑者的 UUID。
 */
export interface BlockedUser {
  username: string
  displayName: string
  avatarKey: string | null
  bio: string
  blockedAt: IsoDate
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
  status: ReportStatus
  /** 认领该举报的审核员（profiles.id）；未认领为 null */
  assignedTo: string | null
  reviewNote: string | null
  /** 裁定码（如 content_hidden / no_violation），供后台与回执展示 */
  resolutionCode: string | null
  createdAt: IsoDate
  updatedAt: IsoDate
  resolvedAt: IsoDate | null
}

// ===== 治理（8.2：举报 / 处罚 / 申诉）=====

/** 处罚种类（与 user_sanctions.kind 逐字一致） */
export type SanctionKind = 'warning' | 'content_restriction' | 'suspension' | 'ban'

/** 申诉状态；取值集合与举报一致，故复用 ReportStatus */
export type AppealStatus = ReportStatus

/** 举报人视角的一条举报（GET /api/reports/mine） */
export interface MyReport {
  id: string
  targetType: ReportTargetType
  targetId: string
  reason: ReportReason
  detail: string
  status: ReportStatus
  resolutionCode: string | null
  reviewNote: string | null
  /** 该举报关联的最新申诉状态；没有申诉为 null */
  appealStatus: AppealStatus | null
  createdAt: IsoDate
  resolvedAt: IsoDate | null
}

/** 申诉（GET /api/me/appeals）；reportId 与 sanctionId 恰好一个非空 */
export interface Appeal {
  id: string
  reportId: string | null
  sanctionId: string | null
  message: string
  status: AppealStatus
  reviewNote: string
  createdAt: IsoDate
  reviewedAt: IsoDate | null
}

/** 被处罚用户看到的处罚（GET /api/me/sanctions） */
export interface MySanction {
  id: string
  kind: SanctionKind
  reasonCode: string
  reasonDetail: string
  /** user_sanctions.status：active | expired | revoked */
  status: string
  startsAt: IsoDate
  endsAt: IsoDate | null
  revokedAt: IsoDate | null
  /** 该处罚关联的最新申诉状态；没有申诉为 null */
  appealStatus: AppealStatus | null
  createdAt: IsoDate
}

/** 举报目标的上下文快照（后台详情面板） */
export interface ReportTarget {
  kind: ReportTargetType
  id: string
  title: string
  excerpt: string
  authorId: string | null
  authorUsername: string | null
  authorDisplayName: string | null
  hidden: boolean
}

/** 不可变审计条目（moderation_actions） */
export interface ModerationAction {
  id: string
  action: string
  actorId: string | null
  targetType: string
  targetId: string
  reason: string
  createdAt: IsoDate
}

/** 后台处罚列表项（含被处罚人摘要） */
export interface AdminSanction extends MySanction {
  userId: string
  username: string
  displayName: string
}

/** 后台申诉列表项（含申诉人摘要） */
export interface AdminAppeal extends Appeal {
  appellantId: string
  appellantUsername: string
  appellantDisplayName: string
}

// ===== 会话（静态期伪造，见 ROADMAP §5.1）=====

/**
 * 当前账号仍然生效的处罚中「最重的一条」。
 *
 * 只保留展示所需字段：banner 要说清限制种类、原因与到期时间，
 * 但不需要把 user_sanctions 的完整审计字段（id / startsAt / appealStatus）
 * 塞进每个页面的会话对象。真正的处罚明细仍走 GET /api/me/sanctions。
 */
export interface SessionRestriction {
  kind: SanctionKind
  reasonCode: string
  reasonDetail: string
  /** null = 无固定期限（长期限制） */
  endsAt: IsoDate | null
}

export interface Session {
  userId: string
  username: string
  displayName: string
  avatarKey: string | null
  role: UserRole
  expiresAt: IsoDate
  /**
   * 生效中的限制；无限制为 null，旧后端未返回该字段时为 undefined。
   * 页面必须同时容忍 null 与 undefined（与 Profile.isBlocked 同一约定）。
   */
  restriction?: SessionRestriction | null
}

// ===== 列表/分页辅助（契约层使用）=====

/** 游标分页：opaque cursor + hasMore */
export interface Page<T> {
  items: T[]
  /** 下一页游标；null 表示没有更多 */
  nextCursor: string | null
  total: number
}
