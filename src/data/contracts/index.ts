/**
 * 仓储契约（ROADMAP D-01 / FRONTEND-WORK §0.2）。
 * 页面与 hooks 只能通过这里访问数据；mock 与 supabase 各实现一份，行为一致（契约测试同跑）。
 */
import type {
  AppNotification,
  Article,
  ArticleTopic,
  Category,
  Comment,
  FollowCounts,
  Interaction,
  IsoDate,
  Page,
  Photo,
  PhotoLicense,
  PhotoStatus,
  Profile,
  RankingSnapshot,
  RankingEntry,
  Session,
} from '@/domain/types'

export type { FollowCounts, Page }

// ===== 通用错误（跨适配器一致的错误模型）=====

export class AppError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
  }
}

export const ErrorCodes = {
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION: 'VALIDATION',
  CONFLICT: 'CONFLICT',
  STORAGE: 'STORAGE',
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

export interface CommentListQuery {
  photoId: string
  cursor?: string
  limit?: number
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
}

export interface PhotoPatch {
  title?: string
  description?: string
  categorySlug?: string
  tags?: string[]
  locationName?: string
  license?: PhotoLicense
  status?: PhotoStatus
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
  /** 软删：置 status='removed' + deletedAt，保留占位 */
  softRemove(id: string): Promise<void>
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
}

/** 所有仓储的集合（data/index.ts 工厂产出） */
export interface Repositories {
  photos: PhotoRepository
  interactions: InteractionRepository
  comments: CommentRepository
  rankings: RankingRepository
  articles: ArticleRepository
  categories: CategoryRepository
  auth: AuthRepository
  storage: StorageRepository
  search: SearchRepository
  social: SocialRepository
}
