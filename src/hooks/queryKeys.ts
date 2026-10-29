/**
 * 查询键集中定义（FRONTEND-WORK §6.3/§6.5：禁止各处硬编码字符串数组）。
 */
import type {
  ArticleListQuery,
  CommentSort,
  PhotoListQuery,
  PhotoStatsQuery,
  SearchQuery,
  TagListQuery,
  TagPhotoSort,
} from '@/data/contracts'

export const queryKeys = {
  photo: (id: string) => ['photo', id] as const,
  photosList: (query: PhotoListQuery) => ['photos', 'list', query] as const,
  relatedPhotos: (id: string) => ['photos', 'related', id] as const,
  sameAuthorPhotos: (authorId: string, currentPhotoId: string, limit: number) =>
    ['photos', 'same-author', authorId, currentPhotoId, limit] as const,
  photosByUser: (userId: string, kind: 'works' | 'likes' | 'favorites') =>
    ['photos', 'user', userId, kind] as const,
  /**
   * 个人主页三 Tab 的键（按 username 驱动）。
   * 与 photosByUser 分开命名而不是复用：一个按 profiles.id 取（/me 本人视图），
   * 一个按 username 取（访客也能看的公开视图），两者的数据来源与授权口径都不同，
   * 混用会让一份缓存被两种口径读到。
   */
  photosByUsername: (username: string, kind: 'works' | 'likes' | 'favorites') =>
    ['photos', 'username', username, kind] as const,
  categories: () => ['categories'] as const,
  category: (slug: string) => ['category', slug] as const,
  /**
   * 评论列表（8.4b 起带排序）。
   *
   * 排序是缓存的一部分：两种排序同一页的内容完全不同，共用一个 key 会让
   * 切换后先闪出另一份顺序。失效时用 commentsAll（前缀）一次覆盖两种排序，
   * 否则「刚发的评论」只会在当前排序里出现。
   */
  comments: (photoId: string, sort: CommentSort = 'latest') =>
    ['comments', photoId, sort] as const,
  commentsAll: (photoId: string) => ['comments', photoId] as const,
  likeState: (userId: string, photoId: string) => ['likeState', userId, photoId] as const,
  favoriteState: (userId: string, photoId: string) => ['favoriteState', userId, photoId] as const,
  ranking: (isoWeek: string, kind: 'live' | 'final') => ['ranking', isoWeek, kind] as const,
  rankingWeeks: () => ['rankingWeeks'] as const,
  articles: (query: ArticleListQuery) => ['articles', query] as const,
  article: (slug: string) => ['article', slug] as const,
  topics: () => ['topics'] as const,
  search: (query: SearchQuery) => ['search', query] as const,
  userSearch: (query: string) => ['search', 'users', query] as const,
  session: () => ['session'] as const,
  profile: (id: string) => ['profile', id] as const,
  profileByUsername: (username: string) => ['profileByUsername', username] as const,
  // ===== 社交（二期）=====
  // 统一挂在 'social' 前缀下：失效「我关注的人变了」时只需 invalidate ['social']
  followState: (username: string) => ['social', 'follow-state', username] as const,
  followCounts: (username: string) => ['social', 'follow-counts', username] as const,
  followList: (username: string, kind: FollowListKind) => ['social', 'follow-list', username, kind] as const,
  feed: () => ['social', 'feed'] as const,
  notifications: () => ['social', 'notifications'] as const,
  unreadCount: () => ['social', 'unread-count'] as const,
  blockedUsers: () => ['social', 'blocked-users'] as const,
  // ===== 标签（8.3a）=====
  // 统一挂在 'tags' 前缀下：标签是全局聚合视图，任何一次发布/下架都应让
  // ['tags'] 整体失效（计数与作品流一起刷新），而不是逐个 key 点名。
  tags: (query: TagListQuery) => ['tags', 'list', query] as const,
  tag: (tag: string) => ['tags', 'detail', tag] as const,
  tagPhotos: (tag: string, sort: TagPhotoSort) => ['tags', 'photos', tag, sort] as const,
  tagSuggest: (prefix: string, limit: number) => ['tags', 'suggest', prefix, limit] as const,
  // ===== 治理（8.2）=====
  // 与社交一样挂在统一前缀下：举报成功后失效 ['moderation'] 即可让「我的举报」
  // 与后台队列一起刷新（后台在另一个标签页时不至于读到旧列表）。
  myReports: () => ['moderation', 'my-reports'] as const,
  myAppeals: () => ['moderation', 'my-appeals'] as const,
  mySanctions: () => ['moderation', 'my-sanctions'] as const,
  adminReports: (status: string) => ['moderation', 'admin', 'reports', status] as const,
  adminReportDetail: (id: string) => ['moderation', 'admin', 'report', id] as const,
  adminSanctions: (status: string) => ['moderation', 'admin', 'sanctions', status] as const,
  adminAppeals: (status: string) => ['moderation', 'admin', 'appeals', status] as const,
  // ===== 收藏夹与服务端草稿（8.3b）=====
  // 统一挂在 'collections' 前缀下：加入/移出会同时影响「我的夹列表」「夹详情」
  // 与「公开主页相册」，一次 invalidate ['collections'] 全刷，避免逐个点名漏掉一处。
  publishDraft: () => ['collections', 'draft'] as const,
  myCollections: (photoId?: string) => ['collections', 'mine', photoId ?? ''] as const,
  userCollections: (username: string) => ['collections', 'user', username] as const,
  collection: (id: string) => ['collections', 'detail', id] as const,
  collectionItems: (id: string) => ['collections', 'items', id] as const,
  // ===== 发现（8.3c）=====
  // 统一挂在 'discover' 前缀下：设为/取消精选、发布、下架都会影响三个区块，
  // 一次 invalidate ['discover'] 全刷，避免只刷精选而漏掉热门搜索的词频。
  hotSearches: (limit: number) => ['discover', 'hot-searches', limit] as const,
  newAuthors: (limit: number) => ['discover', 'new-authors', limit] as const,
  featured: () => ['discover', 'featured'] as const,
  // ===== 创作者统计（8.3d）=====
  // 统一挂在 'stats' 前缀下：发布 / 下架 / 编辑作品、被别人点赞评论收藏都会
  // 改变这些数字，一次 invalidate ['stats'] 全刷，避免逐个 key 点名漏掉一处
  // （与发现、收藏夹同一约定）。两个方法的额外失效点见 hooks/useStats.ts。
  creatorStats: () => ['stats', 'creator'] as const,
  photoStats: (query: PhotoStatsQuery) => ['stats', 'photos', query] as const,
  // ===== 摄影专业化（8.4a）=====
  // 器材 / 地点 / 季节都是「读时聚合」的派生视图：发布、下架、改 EXIF 隐私
  // 都会让它们同时变化，所以统一挂在 'photography' 前缀下（每个 key 仍带自己的
  // 二级段），一次 invalidate ['photography'] 全刷，不必逐个点名。
  gear: () => ['photography', 'gear', 'list'] as const,
  gearPhotos: (kind: string, label: string) => ['photography', 'gear', kind, label] as const,
  places: () => ['photography', 'places', 'list'] as const,
  placePhotos: (label: string) => ['photography', 'places', label] as const,
  seasons: () => ['photography', 'seasons'] as const,
  photography: () => ['photography'] as const,
}

export type FollowListKind = 'followers' | 'following'
