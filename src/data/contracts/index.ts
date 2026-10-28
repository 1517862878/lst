/**
 * 仓储契约（ROADMAP D-01 / FRONTEND-WORK §0.2）。
 * 页面与 hooks 只能通过这里访问数据；mock 与 supabase 各实现一份，行为一致（契约测试同跑）。
 */
import type {
  Article,
  ArticleTopic,
  Category,
  Comment,
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

export type { Page }

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
}
