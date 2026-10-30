/**
 * 仓储契约（ROADMAP D-01 / FRONTEND-WORK §0.2）。
 * 页面与 hooks 只能通过这里访问数据；mock 与 supabase 各实现一份，行为一致（契约测试同跑）。
 */
import type {
  AdminAppeal,
  AdminSanction,
  Appeal,
  AppealStatus,
  AppNotification,
  Article,
  ArticleTopic,
  BlockedUser,
  Category,
  Collection,
  CollectionSummary,
  CollectionVisibility,
  Comment,
  CreatorStats,
  FollowCounts,
  HotSearch,
  Interaction,
  IsoDate,
  ModerationAction,
  MyReport,
  MySanction,
  MyThemeEntry,
  NewAuthor,
  Page,
  Photo,
  PhotoItem,
  PhotoLicense,
  PhotoStatus,
  PhotoStats,
  Profile,
  PublishDraft,
  PublishDraftPayload,
  RankingSnapshot,
  RankingEntry,
  Report,
  ReportReason,
  ReportStatus,
  ReportTarget,
  ReportTargetType,
  Session,
  ThemeDetail,
  ThemeEntry,
  ThemeStatus,
  ThemeSummary,
  UserHit,
} from '@/domain/types'
import type {
  ExifVisibility,
  GearKind,
  GearSummary,
  PinnedPhotosResult,
  PlaceSummary,
  SeasonSummary,
} from '@/domain/photography'

/**
 * 治理相关类型在这里再导出一次（8.2）：两套仓储（mock / api）与页面都从
 * `@/data/contracts` 拿类型，避免各自去 domain/types 里翻，导入面收敛成一处。
 */
export type {
  AdminAppeal,
  AdminSanction,
  Appeal,
  AppealStatus,
  ModerationAction,
  MyReport,
  MySanction,
  Report,
  ReportReason,
  ReportStatus,
  ReportTarget,
  ReportTargetType,
}

export type { BlockedUser, FollowCounts, Page, UserHit }

/** 发现页（8.3c）的类型同样从契约层再导出，页面只认一个导入面 */
export type { HotSearch, NewAuthor }

/** 创作者统计（8.3d）的类型同样从契约层再导出 */
export type { CreatorStats, NotificationMeta, PhotoStats } from '@/domain/types'

/** 收藏夹与服务端草稿的类型也从契约层再导出（8.3b），页面只认一个导入面 */
export type {
  Collection,
  CollectionSummary,
  CollectionVisibility,
  PublishDraft,
  PublishDraftPayload,
}

/**
 * 摄影专业化（8.4a）的派生类型同样从契约层再导出。
 *
 * 这些形状由 domain/photography.ts 的纯函数产出 —— 聚合口径只有一份，
 * mock 仓储、页面与单测共用；契约层只负责「页面从哪导入」。
 */
export type {
  ExifVisibility,
  GearKind,
  GearSummary,
  PinnedPhotosResult,
  PlaceSummary,
  Season,
  SeasonSummary,
} from '@/domain/photography'

export type { PinnedPhoto } from '@/domain/types'

/** 组照（8.4c）的类型从契约层再导出：页面与编辑组件只认一个导入面 */
export type { PhotoItem } from '@/domain/types'

// ===== 通用错误（跨适配器一致的错误模型）=====

export class AppError extends Error {
  readonly code: string
  /**
   * 后端 `details` 原样透传（8.2 起 403 用它携带 sanctionKind / endsAt）。
   * 保持 unknown：错误码本身稳定，details 的形状按端点而异，由调用方收窄。
   */
  readonly details: unknown
  constructor(code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
  }
}

export const ErrorCodes = {
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION: 'VALIDATION',
  CONFLICT: 'CONFLICT',
  STORAGE: 'STORAGE',
  /**
   * 超出配额（8.4d：每个主题最多投 3 件）。
   *
   * 后端用它区分「额度用完」（HTTP 422）与「填错了」（VALIDATION 400）：
   * 两者都是 4xx，靠状态码兜底会把它并成 VALIDATION，页面就没法给出
   * 「你已投满 3 件」这种带下一步的提示。列进来后 client.ts 会原样保留该 code。
   */
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
} as const

// ===== 查询参数 DTO =====

export interface PhotoListQuery {
  sort: 'latest' | 'popular'
  categorySlug?: string
  /**
   * 按作者用户名过滤（个人主页「作品」列表）。
   *
   * 为什么不用 authorId：公开资料接口刻意**不返回** profiles.id（服务端不提供按 UUID
   * 读用户的旁路，见 server/src/routes/profiles.ts），所以主页拿不到 id。
   * 服务端按 username 授权，私密账号或不可见时返回空列表而不是报错。
   */
  authorUsername?: string
  /** 游标（base64url）；首页传 undefined */
  cursor?: string
  /** 每页条数（默认 24） */
  limit?: number
}

export interface SearchQuery {
  text: string
  categorySlug?: string
  tags?: string[]
  locationName?: string
  sort?: 'relevance' | 'latest' | 'hot'
  cursor?: string
  limit?: number
}

/** 评论排序（8.4b）：最新在前 / 最早在前 */
export type CommentSort = 'latest' | 'oldest'

export interface CommentListQuery {
  photoId: string
  cursor?: string
  limit?: number
  /**
   * 排序（8.4b，缺省 latest）。
   *
   * 游标要跟着排序走：同一串 cursor 在两种排序下的含义不同，
   * 所以翻页请求必须带上和首页相同的 sort，否则会重复或漏条。
   */
  sort?: CommentSort
}

export interface ArticleListQuery {
  topicSlug?: string
  difficulty?: string
  cursor?: string
  limit?: number
}

// ===== 仓储接口 =====

export interface PhotoRepository {
  list(query: PhotoListQuery): Promise<Page<Photo>>
  get(id: string): Promise<Photo>
  /** 创建草稿（status=draft）；发布由 publish 方法处理 */
  create(input: PhotoCreateInput, id?: string): Promise<Photo>
  /** 草稿转发布：置 published 并写 publishedAt */
  publish(id: string): Promise<Photo>
  update(id: string, patch: PhotoPatch): Promise<Photo>
  remove(id: string): Promise<void>
  /** 相关作品（同分类，排除自身，按点赞排序） */
  related(id: string, limit?: number): Promise<Photo[]>
  /**
   * 整组替换组照条目（8.4c，作者本人）。
   *
   * 为什么是「整组替换」而不是逐条增删：顺序即封面（position = 0 同步回
   * photos.image_key/thumb_key/width/height），逐条改会让封面在中间态短暂指向
   * 一张将要被删的图。一次替换只有一个原子结果，重排也能用同一条路径表达。
   *
   * 空数组 = 退回单图（保持 photos.image_key 不变，item_count = 0）。
   */
  replaceItems(photoId: string, items: PhotoItemInput[]): Promise<PhotoItemsResult>
}

/** 组照条目入参（与迁移 0033 的 p_items 形状一致：camelCase 键） */
export interface PhotoItemInput {
  imageKey: string
  thumbKey: string
  width: number
  height: number
  blurhash: string | null
  /** ≤200 字，可为空 */
  caption: string
}

/** replaceItems 的返回体（与 PUT /api/photos/:id/items 的响应一致） */
export interface PhotoItemsResult {
  photoId: string
  itemCount: number
  items: PhotoItem[]
}

export interface PhotoCreateInput {
  authorId: string
  title: string
  description: string
  categorySlug: string
  tags: string[]
  locationName: string
  locationLat: number | null
  locationLng: number | null
  locationPrecision: 'exact' | 'district' | 'city' | 'hidden'
  shotAt: IsoDate | null
  exif: Record<string, unknown> | null
  imageKey: string
  thumbKey: string
  width: number
  height: number
  blurhash: string | null
  license: PhotoLicense
  credit: string | null
  /** 发布时是否隐藏这张的拍摄参数（8.4a 逐张覆盖；缺省取账户设置） */
  exifHidden?: boolean
  /**
   * 发布时是否关闭这件作品的评论（8.4b；缺省 false = 允许评论）。
   *
   * 发布页的开关映射到这里；mock 直接落库，api 模式随创建请求一起发，
   * 服务端若尚未接受该字段，发布页会在创建成功后再补一次 comments-lock 写入。
   */
  commentsLocked?: boolean
}

export interface PhotoPatch {
  title?: string
  description?: string
  categorySlug?: string
  tags?: string[]
  locationName?: string
  license?: PhotoLicense
  status?: PhotoStatus
  /**
   * 逐张开关拍摄参数（8.4a，作者本人）。
   *
   * 账户级 exif_visibility='hidden' 时本开关不起作用（见 domain/photography.ts
   * isExifHidden）；作者改成 public 后，这里是唯一能按张恢复的参数。
   */
  exifHidden?: boolean
}

export interface InteractionRepository {
  listLikesByUser(userId: string): Promise<Photo[]>
  listFavoritesByUser(userId: string): Promise<Photo[]>
  /**
   * 某用户公开的喜欢 / 收藏（个人主页三 Tab 之一；游标分页）。
   *
   * 与 listLikesByUser / listFavoritesByUser 的差别是**授权口径**，不是数据形状：
   * 那一对服务「本人」（API 模式仅限自己，否则 400），主页却要能被任何访客读取，
   * 所以只能按 username 走公开口径（服务端按隐私设置决定返回空页还是内容）。
   * 用户不存在时返回空页而非抛错：主页已经处理了 404，列表不该再制造一个错误态。
   */
  listByUsername(
    username: string,
    kind: 'likes' | 'favorites',
    cursor?: string,
    limit?: number,
  ): Promise<CursorListPage<Photo>>
  /** 当前用户是否已赞/已藏 */
  getLikeState(userId: string, photoId: string): Promise<boolean>
  getFavoriteState(userId: string, photoId: string): Promise<boolean>
  /** 切换（upsert/delete）；返回新状态 */
  toggleLike(userId: string, photoId: string): Promise<boolean>
  toggleFavorite(userId: string, photoId: string): Promise<boolean>
  /** 该作品的所有互动（周榜用） */
  listLikesByPhoto(photoId: string): Promise<Interaction[]>
  listFavoritesByPhoto(photoId: string): Promise<Interaction[]>
}

export interface CommentRepository {
  list(query: CommentListQuery): Promise<Page<Comment>>
  create(input: { photoId: string; authorId: string; parentId: string | null; body: string }): Promise<Comment>
  /**
   * 软删：置 status='removed' + deletedAt，保留占位。
   *
   * 授权（8.4b）：评论作者本人，或该作品的作者。其他人一律 FORBIDDEN；
   * 已删除的评论再删一次不报错（重试幂等）。
   */
  softRemove(id: string): Promise<void>
  /**
   * 作者开关某件作品的评论（8.4b）。仅作品作者可用，其余人 FORBIDDEN。
   *
   * 返回落库后的状态而不是 void：乐观更新失败回滚时，页面需要以服务端
   * 的值为准（两人同时操作时客户端猜的那个值可能就是错的）。
   */
  setLocked(photoId: string, locked: boolean): Promise<{ photoId: string; commentsLocked: boolean }>
}

export interface RankingRepository {
  /** 取某周某类榜单；静态期由本地计算生成，动态期由服务端快照提供 */
  getWeekly(isoWeek: string, kind: 'live' | 'final'): Promise<RankingSnapshot & { entries: RankingEntry[] }>
  /** 可用的周列表（有数据的周） */
  listWeeks(): Promise<Array<{ isoWeek: string; kind: 'live' | 'final' }>>
}

export interface ArticleRepository {
  list(query: ArticleListQuery): Promise<Page<Article>>
  getBySlug(slug: string): Promise<Article>
  listTopics(): Promise<ArticleTopic[]>
}

export interface CategoryRepository {
  list(): Promise<Category[]>
  get(slug: string): Promise<Category>
}

export interface SignUpInput {
  username: string
  displayName: string
  password: string
  phone: string
  code: string
  termsAccepted: boolean
  privacyAccepted: boolean
}

export interface AuthRepository {
  /** 读取当前会话（无会话返回 null） */
  getSession(): Promise<Session | null>
  signIn(username: string, password: string, turnstileToken?: string): Promise<Session>
  requestRegistrationCode(phone: string, turnstileToken?: string): Promise<void>
  signUp(input: SignUpInput): Promise<Session>
  signOut(): Promise<void>
  /** 按 id 取资料 */
  getProfile(id: string): Promise<Profile>
  /** 按用户名取资料（个人主页路径用） */
  getProfileByUsername(username: string): Promise<Profile>
}

export interface StorageRepository {
  /** 存图片（键规则 photos/{authorId}/{photoId}/display.webp 等） */
  put(key: string, blob: Blob): Promise<void>
  get(key: string): Promise<Blob>
}

export interface SearchRepository {
  search(query: SearchQuery): Promise<Page<Photo>>
  /**
   * 搜用户（二期「用户搜索」）：按用户名或昵称模糊匹配。
   *
   * 返回 UserHit[] 而不是 Page<UserHit>：后端只回 items+total，
   * 这里连 total 都不暴露——搜索页是「前 N 条」语义，不是可翻页列表。
   */
  searchUsers(query: string, options?: { limit?: number }): Promise<UserHit[]>
}

// ===== 社交（二期：关注 / 关注动态 / 通知）=====

/**
 * 游标列表（关注列表、动态流、通知流共用）。
 *
 * 刻意不复用 Page<T>：Page 带 total，而这三个接口是「游标流」——
 * 后端不算总数（算总数要全表扫，且实时变化的值对翻页没有意义）。
 * 契约里的形状就是 { items, nextCursor }，多要一个字段就是多一份不一致。
 */
export interface CursorListPage<T> {
  items: T[]
  /** 下一页游标；null 表示没有更多 */
  nextCursor: string | null
}

export interface SocialRepository {
  /** 关注某人（幂等：已关注时直接返回） */
  follow(username: string): Promise<void>
  /** 取消关注（幂等：未关注时直接返回） */
  unfollow(username: string): Promise<void>
  /** 当前登录用户是否关注了此人；未登录返回 false（不抛错，按钮要能渲染） */
  isFollowing(username: string): Promise<boolean>
  /** 粉丝数 / 关注数 */
  counts(username: string): Promise<FollowCounts>
  /** 粉丝列表（游标分页） */
  listFollowers(username: string, cursor?: string): Promise<CursorListPage<Profile>>
  /** 关注列表（游标分页） */
  listFollowing(username: string, cursor?: string): Promise<CursorListPage<Profile>>
  /** 关注动态：我关注的作者发布的已发布作品，按发布时间倒序 */
  feed(cursor?: string): Promise<CursorListPage<Photo>>
  /** 我的通知（游标分页） */
  notifications(cursor?: string): Promise<CursorListPage<AppNotification>>
  /** 我的未读通知数 */
  unreadCount(): Promise<number>
  /** 标记已读；不传 ids = 全部标记为已读 */
  markRead(ids?: string[]): Promise<void>
  /**
   * 拉黑某人（幂等）。
   *
   * 语义（后端为准）：有向存储、对称生效——建立时删掉两人之间双向的关注关系，
   * 之后互相不能关注、不能点赞/收藏/评论对方的作品、不产生通知、列表互相不可见。
   * 返回 removedFollows 供 UI 提示「已解除 N 个关注关系」。
   */
  blockUser(username: string): Promise<{ removedFollows: number }>
  /** 解除拉黑（幂等：没拉黑过也当成功，不抛错） */
  unblockUser(username: string): Promise<void>
  /** 我拉黑的用户列表（游标分页，按拉黑时间倒序） */
  listBlocked(params?: { cursor?: string; limit?: number }): Promise<Page<BlockedUser>>
}

// ===== 治理（8.2：举报 / 审核 / 处罚 / 申诉）=====

/** 举报提交入参（POST /api/reports） */
export interface SubmitReportInput {
  targetType: ReportTargetType
  targetId: string
  reason: ReportReason
  /** 0–500 字符；服务端会再截一次 */
  detail: string
}

/** 提交举报的回执：reportId 用于在「我的举报」和反馈文案里定位这一单 */
export interface ReportReceipt {
  reportId: string
  status: ReportStatus
}

/** 申诉提交入参；reportId 与 sanctionId 恰好给一个 */
export interface SubmitAppealInput {
  reportId?: string
  sanctionId?: string
  /** 10–2000 字符 */
  message: string
}

export interface AppealReceipt {
  appealId: string
  status: AppealStatus
  createdAt: IsoDate
}

/** 可见性动作（隐藏 / 恢复内容） */
export interface VisibilityInput {
  targetType: ReportTargetType
  targetId: string
  hidden: boolean
  reason: string
  reportId?: string
}

/** 裁定（upheld = 举报成立，rejected = 驳回） */
export interface ResolveReportInput {
  status: Extract<ReportStatus, 'upheld' | 'rejected'>
  resolutionCode: string
  reviewNote: string
}

export interface AdminReportDetail {
  report: Report
  target: ReportTarget
  actions: ModerationAction[]
}

/**
 * 治理仓储。
 *
 * 分成「我的」与「后台」两组方法：前者对任何登录用户开放，后者只对 editor|admin
 * 开放（服务端 403，mock 同样抛 FORBIDDEN）。这样页面能做真实的权限门，而不是
 * 靠隐藏按钮假装安全。
 */
export interface ModerationRepository {
  /** 提交举报；返回回执编号（前端用它展示「已受理 #编号」） */
  submitReport(input: SubmitReportInput): Promise<ReportReceipt>
  /** 我提交过的举报（含申诉状态） */
  myReports(): Promise<MyReport[]>
  /** 提交申诉；同一目标的未结申诉重复提交 → CONFLICT */
  submitAppeal(input: SubmitAppealInput): Promise<AppealReceipt>
  /** 我提交过的申诉 */
  myAppeals(): Promise<Appeal[]>
  /** 我受到的处罚（含申诉状态） */
  mySanctions(): Promise<MySanction[]>

  /** 后台：举报队列（status 省略 = 全部） */
  listReports(status?: ReportStatus): Promise<Report[]>
  /** 后台：单条举报详情（目标上下文 + 审计时间线） */
  reportDetail(id: string): Promise<AdminReportDetail>
  /** 后台：认领举报（幂等：已认领给本人直接成功） */
  claimReport(id: string): Promise<void>
  /** 后台：隐藏 / 恢复内容 */
  setVisibility(input: VisibilityInput): Promise<void>
  /** 后台：裁定举报 */
  resolveReport(id: string, input: ResolveReportInput): Promise<void>
  /** 后台：处罚列表（status 省略 = 全部） */
  listSanctions(status?: string): Promise<AdminSanction[]>
  /** 后台：撤销处罚 */
  revokeSanction(id: string, reason: string): Promise<void>
  /** 后台：申诉队列（status 省略 = 全部） */
  listAppeals(status?: AppealStatus): Promise<AdminAppeal[]>
  /** 后台：复核申诉（申诉成立 → 关联处罚撤销 / 举报内容恢复由服务端决定） */
  reviewAppeal(
    id: string,
    input: { outcome: Extract<AppealStatus, 'upheld' | 'rejected'>; note: string },
  ): Promise<{ appealId: string; status: AppealStatus; updatedAt: IsoDate }>
}

// ===== 标签（8.3a：标签总览 / 标签详情 / 标签作品流 / 搜索建议）=====

/**
 * 标签的聚合口径（与后端 8.3 的标签视图对齐）。
 *
 * 计数只统计**已发布且未删除**的作品：草稿出现在标签页等于泄露未公开内容，
 * 所以两套实现都必须同一个过滤口径（见 domain/tags.ts 的 isTagEligible）。
 */
export interface TagSummary {
  /** 标签原文（不做大小写归一：展示用作者当时写下的那个） */
  tag: string
  /** 关联作品数 */
  photoCount: number
  /** 关联作者数（去重） */
  authorCount: number
  /** 最近一次发布作品的发布时间；无作品时为 null */
  latestPublishedAt: IsoDate | null
}

/** 相关标签：与当前标签共同出现在同一作品上的其他标签 */
export interface RelatedTag {
  tag: string
  /** 共现作品数 */
  count: number
}

/** 标签详情（总览字段 + 相关标签） */
export interface TagDetail extends TagSummary {
  relatedTags: RelatedTag[]
}

/** 标签列表排序：hot = 作品数降序，latest = 最近更新时间降序 */
export type TagListSort = 'hot' | 'latest'

/** 标签作品流排序：latest = 时间，popular = 点赞 + 收藏 */
export type TagPhotoSort = 'latest' | 'popular'

export interface TagListQuery {
  sort: TagListSort
  /** 默认 20，上限 50（与后端默认 limit 对齐） */
  limit?: number
  /** 前缀过滤（搜索建议 / 搜索页标签 Tab 复用同一端点） */
  prefix?: string
}

export interface TagPhotoQuery {
  sort: TagPhotoSort
  /** 不透明游标；省略 = 第一页 */
  cursor?: string
  limit?: number
}

/** 标签搜索建议项 */
export interface TagSuggestion {
  tag: string
  photoCount: number
}

/**
 * 标签仓储。
 *
 * 四个方法对应后端四个 GET 端点（清单见 api/tags.ts 顶部）。刻意不让 photos()
 * 复用 PhotoRepository.list：标签作品流的排序口径（popular = 赞+藏）与公开列表
 * 不同，硬塞进 PhotoListQuery 会让两种排序在契约里打架。
 */
export interface TagRepository {
  /** GET /api/tags — 热门 / 最新标签（按 prefix 过滤时用于搜索建议） */
  list(query: TagListQuery): Promise<TagSummary[]>
  /**
   * GET /api/tags/:tag — 标签详情。
   * 未知标签不抛 404（空标签页是合法状态：用户拼错或标签刚被删空），
   * 返回 photoCount 为 0 的空详情即可。
   */
  get(tag: string): Promise<TagDetail>
  /** GET /api/tags/:tag/photos — 游标分页的作品流 */
  photos(tag: string, query: TagPhotoQuery): Promise<CursorListPage<Photo>>
  /** GET /api/search/tags — 输入建议（前缀匹配） */
  suggest(prefix: string, options?: { limit?: number }): Promise<TagSuggestion[]>
}

/** 收藏夹与服务端草稿（8.3b）。可见性与配额由数据库决定，这一层只做形态校验与空集→404 翻译。 */
export interface CollectionRepository {
  /** GET /api/me/publish-draft —— 没有草稿时 payload 为 null，不抛错 */
  getMyDraft(): Promise<PublishDraft>
  /** PUT /api/me/publish-draft —— 整份覆盖（表单是整份提交的） */
  saveMyDraft(payload: PublishDraftPayload): Promise<{ updatedAt: IsoDate }>
  /** DELETE /api/me/publish-draft */
  deleteMyDraft(): Promise<void>
  /** GET /api/me/collections —— 本人全部收藏夹（含私密）；带 photoId 时顺便标注成员关系 */
  listMyCollections(options?: { photoId?: string }): Promise<CollectionSummary[]>
  /** GET /api/u/:username/collections —— 他人只能看到 public */
  listUserCollections(username: string): Promise<CollectionSummary[]>
  /** GET /api/collections/:id —— 不可见时抛 NOT_FOUND（不是 FORBIDDEN，避免确认夹存在） */
  getCollection(id: string): Promise<Collection>
  /** GET /api/collections/:id/items —— 游标分页 */
  listCollectionItems(
    id: string,
    options?: { cursor?: string | null; limit?: number },
  ): Promise<CursorListPage<Photo>>
  /** POST /api/collections */
  createCollection(input: {
    title: string
    description?: string
    visibility?: CollectionVisibility
  }): Promise<CollectionSummary>
  /** PATCH /api/collections/:id */
  updateCollection(
    id: string,
    patch: { title?: string; description?: string; visibility?: CollectionVisibility },
  ): Promise<CollectionSummary>
  /** DELETE /api/collections/:id（软删） */
  deleteCollection(id: string): Promise<void>
  /** POST /api/collections/:id/items —— 重复加入幂等，返回最新数量 */
  addItem(collectionId: string, photoId: string): Promise<{ itemCount: number }>
  /** DELETE /api/collections/:id/items/:photoId —— 幂等 */
  removeItem(collectionId: string, photoId: string): Promise<{ itemCount: number }>
}

/** 所有仓储的集合（data/index.ts 工厂产出） */
// ===== 发现（8.3c：热门搜索 / 新作者 / 编辑精选）=====

/** 热门搜索查询参数（服务端会再夹一次范围，见 domain/discover.ts 的常量） */
export interface HotSearchQuery {
  /** 统计窗口（天）；默认 7，服务端夹到 1–30 */
  days?: number
  /** 条数；默认 10，服务端夹到 1–20 */
  limit?: number
}

/** 新作者查询参数 */
export interface NewAuthorQuery {
  /** 注册时间窗口（天）；默认 90，服务端夹到 7–365 */
  days?: number
  /** 条数；默认 6，服务端夹到 1–20 */
  limit?: number
}

/** 设为 / 取消编辑精选的回执 */
export interface EditorChoiceResult {
  photoId: string
  /** null = 已取消 */
  featuredAt: IsoDate | null
}

export interface DiscoverRepository {
  /**
   * 热门搜索词（近 N 天搜索日志聚合，出现次数 ≥ 3）。
   *
   * 返回空数组是正常状态（新站还没有搜索量），页面必须整块隐藏而不是显示空壳。
   */
  hotSearches(query?: HotSearchQuery): Promise<HotSearch[]>
  /** 新作者推荐（近 N 天注册、非 staff、至少 1 件在架作品） */
  newAuthors(query?: NewAuthorQuery): Promise<NewAuthor[]>
  /** 编辑精选作品流（featuredAt 非空 + 在架，按精选时间倒序；游标分页） */
  featured(cursor?: string, limit?: number): Promise<CursorListPage<Photo>>
  /**
   * 设为 / 取消编辑精选（staff only）。
   *
   * 服务端以「当前会话是否为 editor/admin」授权；非 staff 一律 403（不止是 UI 隐藏），
   * 因此页面也必须在失败时回滚乐观更新，而不是假装成功。
   */
  setEditorChoice(photoId: string, featured: boolean): Promise<EditorChoiceResult>
}

// ===== 创作者统计（8.3d）=====

/** 作品数据表的翻页参数（后端：limit 1–100 缺省 50、offset ≥ 0，越界 400） */
export interface PhotoStatsQuery {
  limit?: number
  offset?: number
}

/**
 * 我的创作数据（私有：只有本人能读，未登录 401）。
 *
 * 两个方法都是**读当前会话**的，不带 username/id 参数 —— 与后端
 * /api/me/stats 的授权口径一致：不允许用别人的 username 查别人的经营数据。
 */
export interface StatsRepository {
  /** 汇总：作品数 / 在架 / 草稿 / 获赞 / 收藏 / 评论 / 浏览 / 粉丝 / 关注 */
  creatorStats(): Promise<CreatorStats>
  /** 每件作品一行（按在架优先 + 发布时间倒序） */
  photoStats(query?: PhotoStatsQuery): Promise<PhotoStats[]>
}

// ===== 摄影专业化（8.4a）=====

/** 器材作品流的分页参数（后端：limit 1–50 缺省 24，越界 400） */
export interface GearPhotoQuery {
  cursor?: string | null
  limit?: number
}

/** 地点作品流的分页参数 */
export interface PlacePhotoQuery {
  cursor?: string | null
  limit?: number
}

/**
 * 器材浏览（8.4a）：机身 / 镜头两组聚合 + 对应作品流。
 *
 * 聚合结果**不含作者 UUID**（延续公开接口不暴露 UUID 的约定），只有计数。
 * 隐藏了拍摄参数的作品既不产生器材标签，也不出现在器材作品流里 ——
 * 否则「隐藏 EXIF」就只剩详情页一个洞，聚合页把机型又列了一遍。
 */
export interface GearRepository {
  /** 器材总览（"Make Model" / LensModel，各自带作品数与作者数） */
  list(limit?: number): Promise<GearSummary[]>
  /**
   * 某器材下的作品流（游标分页）。
   *
   * label 走 query 而不是路径：中文/带空格的机型名进路径会引出各种编码坑，
   * 后端也是 GET /api/gear/:kind/photos?label=。
   */
  photos(kind: GearKind, label: string, query?: GearPhotoQuery): Promise<CursorListPage<Photo>>
}

/**
 * 地点浏览（8.4a）。
 *
 * 只聚合 location_precision !== 'hidden' 且地点名非空的作品；
 * 精确坐标（lat/lng）永远不出现在聚合与页面上。
 */
export interface PlaceRepository {
  list(limit?: number): Promise<PlaceSummary[]>
  photos(label: string, query?: PlacePhotoQuery): Promise<CursorListPage<Photo>>
}

/** 季节计数（8.4a）：按 shot_at 的月份划分春夏秋冬 */
export interface SeasonRepository {
  list(): Promise<SeasonSummary[]>
}

/**
 * 资料侧的摄影设置（8.4a）。
 *
 * 单独成一个仓储而不是塞进 AuthRepository：这两个方法是「本人设置」，
 * 与登录/资料读取的授权口径不同（未登录必须 401，而不是返回空资料）。
 */
export interface ProfileRepository {
  /** 账户级拍摄参数默认范围（隐藏时所有作品都不展示 EXIF） */
  setExifVisibility(visibility: ExifVisibility): Promise<void>
  /**
   * 设置主页代表作（最多 3 件、必须都是本人的在架作品）。
   *
   * 传空数组 = 清空。返回服务端规范化后的 id 顺序与作品摘要 —— 以服务端结果
   * 为准，避免前端乐观更新与服务端校验（越权/已撤回）不一致。
   */
  setPinned(photoIds: string[]): Promise<PinnedPhotosResult>
}

// ===== 每周主题与活动（8.4d）=====

/**
 * 公开列表的三个视图（GET /api/themes?status=…）。
 *
 * 三档互不重叠：`active` = 正在征集，`upcoming` = 已排期未开始，
 * `past` = 已结束。草稿不在任何一档里（后台另有入口）。
 */
export type ThemeListFilter = 'active' | 'upcoming' | 'past'

export interface ThemeEntryQuery {
  /** 1–48，默认 24（服务端会夹取） */
  limit?: number
  offset?: number
  /** true = 只看已精选（详情页的「精选」区） */
  selectedOnly?: boolean
}

export interface ThemeEntryPage {
  items: ThemeEntry[]
  total: number
  /** 下一页的 offset；null = 没有更多 */
  nextOffset: number | null
}

/**
 * 后台新建/编辑一次提交的字段。
 *
 * slug 只在新建时可写：它是路由的一部分，改掉等于让所有外链失效，
 * 服务端也会拒绝「传了与库中不同的 slug」（400 VALIDATION）。
 */
export interface ThemeInput {
  slug: string
  title: string
  description?: string
  rules?: string
  status?: ThemeStatus
  startsAt: string
  endsAt: string
  coverPhotoId?: string | null
  resultNote?: string
}

/** 后台写入后服务端回的权威结果（以它为准，不做乐观更新） */
export interface ThemeWriteResult {
  id: string
  slug: string
  status: ThemeStatus
}

export interface ThemeSubmitResult {
  photoId: string
  submittedAt: IsoDate
  /** 该主题当前投稿总数（含本次） */
  entryCount: number
}

export interface ThemeSelectResult {
  isSelected: boolean
  selectedCount: number
}

/**
 * 每周主题与活动（8.4d，第 11 个仓储）。
 *
 * 读写分成三层权限，与后端函数一一对应：
 *   · list / get / listEntries —— 任何人可读（草稿主题对非编辑一律 NOT_FOUND）；
 *   · myEntries / submitEntry / withdrawEntry —— 必须登录，只能碰自己的投稿；
 *   · createTheme / updateTheme / selectEntry / adminList —— 仅 editor/admin。
 *
 * 错误口径（与后端逐条对齐，页面据此给不同提示）：
 *   · 重复投稿 → AppError CONFLICT「这件作品已经在主题里了」；
 *   · 超过每人 3 件 → AppError LIMIT_EXCEEDED（HTTP 422）；
 *   · 撤回已入选/主题已结束 → AppError FORBIDDEN。
 */
export interface ThemeRepository {
  /** 公开列表（三档之一），按 startsAt 倒序 */
  list(status: ThemeListFilter): Promise<ThemeSummary[]>
  /** 主题详情；不存在、或草稿而调用者不是编辑 → NOT_FOUND */
  get(slug: string): Promise<ThemeDetail>
  /** 投稿网格（默认按「精选在前、然后按投稿时间倒序」） */
  listEntries(slug: string, query?: ThemeEntryQuery): Promise<ThemeEntryPage>
  /** 我在这个主题里的投稿（必须登录） */
  myEntries(slug: string): Promise<MyThemeEntry[]>
  /** 投稿（只能投自己的已发布作品） */
  submitEntry(slug: string, photoId: string): Promise<ThemeSubmitResult>
  /** 撤回投稿（只能撤自己的、且主题仍在征集、且未被精选） */
  withdrawEntry(slug: string, photoId: string): Promise<void>
  /** 后台新建（POST /api/admin/themes） */
  createTheme(input: ThemeInput): Promise<ThemeWriteResult>
  /** 后台编辑（PATCH /api/admin/themes/:id）；slug 不可改 */
  updateTheme(id: string, patch: Partial<ThemeInput>): Promise<ThemeWriteResult>
  /** 后台精选/取消精选，可同时写评语；精选会通知作者，取消精选不发通知 */
  selectEntry(
    slug: string,
    photoId: string,
    input: { selected: boolean; note?: string },
  ): Promise<ThemeSelectResult>
  /**
   * 后台：列出全部主题**含草稿**。
   *
   * 契约 §2 只定义了三个公开档位，而「新建草稿 → 过几天再开始」是后台的常规
   * 流程：没有这一条，草稿创建完就再也找不到了（公开接口刻意不返回它）。
   * api 实现先试 GET /api/admin/themes，端点不存在（404）时退回三个公开档的
   * 合并 —— 功能降级但不会白屏，等后端补上端点即自动升级。
   */
  adminList(): Promise<ThemeSummary[]>
}

export interface Repositories {
  photos: PhotoRepository
  tags: TagRepository
  collections: CollectionRepository
  interactions: InteractionRepository
  comments: CommentRepository
  rankings: RankingRepository
  articles: ArticleRepository
  categories: CategoryRepository
  auth: AuthRepository
  storage: StorageRepository
  search: SearchRepository
  social: SocialRepository
  moderation: ModerationRepository
  discover: DiscoverRepository
  stats: StatsRepository
  gear: GearRepository
  places: PlaceRepository
  seasons: SeasonRepository
  profile: ProfileRepository
  themes: ThemeRepository
}
