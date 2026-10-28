/**
 * 查询键集中定义（FRONTEND-WORK §6.3/§6.5：禁止各处硬编码字符串数组）。
 */
import type { ArticleListQuery, PhotoListQuery, SearchQuery } from '@/data/contracts'

export const queryKeys = {
  photo: (id: string) => ['photo', id] as const,
  photosList: (query: PhotoListQuery) => ['photos', 'list', query] as const,
  relatedPhotos: (id: string) => ['photos', 'related', id] as const,
  sameAuthorPhotos: (authorId: string, currentPhotoId: string, limit: number) =>
    ['photos', 'same-author', authorId, currentPhotoId, limit] as const,
  photosByUser: (userId: string, kind: 'works' | 'likes' | 'favorites') =>
    ['photos', 'user', userId, kind] as const,
  categories: () => ['categories'] as const,
  category: (slug: string) => ['category', slug] as const,
  comments: (photoId: string) => ['comments', photoId] as const,
  likeState: (userId: string, photoId: string) => ['likeState', userId, photoId] as const,
  favoriteState: (userId: string, photoId: string) => ['favoriteState', userId, photoId] as const,
  ranking: (isoWeek: string, kind: 'live' | 'final') => ['ranking', isoWeek, kind] as const,
  rankingWeeks: () => ['rankingWeeks'] as const,
  articles: (query: ArticleListQuery) => ['articles', query] as const,
  article: (slug: string) => ['article', slug] as const,
  topics: () => ['topics'] as const,
  search: (query: SearchQuery) => ['search', query] as const,
  session: () => ['session'] as const,
  profile: (id: string) => ['profile', id] as const,
  profileByUsername: (username: string) => ['profileByUsername', username] as const,
}
