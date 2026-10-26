/**
 * 照片数据 hooks（FRONTEND-WORK §6.3：TanStack Query 约定）。
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { PhotoListQuery } from '@/data/contracts'
import { createRepositories } from '@/data'
import { queryKeys } from './queryKeys'

const repos = () => createRepositories()

/** 作品墙/分类墙：游标无限滚动 */
export function usePhotos(query: PhotoListQuery) {
  return useInfiniteQuery({
    queryKey: queryKeys.photosList(query),
    queryFn: async ({ pageParam }) =>
      repos().photos.list(pageParam ? { ...query, cursor: pageParam } : query),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  })
}

/** 作品详情 */
export function usePhoto(id: string) {
  return useQuery({
    queryKey: queryKeys.photo(id),
    queryFn: () => repos().photos.get(id),
    retry: false,
  })
}

/** 相关作品（同分类） */
export function useRelatedPhotos(id: string, limit = 6) {
  return useQuery({
    queryKey: queryKeys.relatedPhotos(id),
    queryFn: () => repos().photos.related(id, limit),
  })
}

/** 某用户的作品（个人主页三 Tab 之一） */
export function usePhotosByUser(userId: string, kind: 'works' | 'likes' | 'favorites') {
  return useQuery({
    queryKey: queryKeys.photosByUser(userId, kind),
    queryFn: async () => {
      if (kind === 'works') {
        const page = await repos().photos.list({ sort: 'latest', limit: 100 })
        return page.items.filter((p) => p.authorId === userId)
      }
      if (kind === 'likes') return repos().interactions.listLikesByUser(userId)
      return repos().interactions.listFavoritesByUser(userId)
    },
  })
}
