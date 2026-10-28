/**
 * 照片数据 hooks（FRONTEND-WORK §6.3：TanStack Query 约定）。
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PhotoListQuery, PhotoPatch } from '@/data/contracts'
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

/** 同作者作品；复用公开列表契约，避免为展示切片扩张后端 API。 */
export function useMorePhotosByAuthor(authorId: string, currentPhotoId: string, limit = 4) {
  return useQuery({
    queryKey: queryKeys.sameAuthorPhotos(authorId, currentPhotoId, limit),
    queryFn: async () => {
      const page = await repos().photos.list({ sort: 'latest', limit: 100 })
      return page.items
        .filter((photo) => photo.authorId === authorId && photo.id !== currentPhotoId)
        .slice(0, limit)
    },
    enabled: Boolean(authorId && currentPhotoId),
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
    enabled: Boolean(userId),
  })
}

/** 作者编辑作品。成功后更新详情缓存，并失效所有可能展示旧字段的列表。 */
export function useUpdatePhoto(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: PhotoPatch) => repos().photos.update(id, patch),
    onSuccess: (photo) => {
      queryClient.setQueryData(queryKeys.photo(id), photo)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.photo(id) })
      void queryClient.invalidateQueries({ queryKey: ['photos'] })
      void queryClient.invalidateQueries({ queryKey: ['search'] })
      void queryClient.invalidateQueries({ queryKey: ['ranking'] })
    },
  })
}

/** 作者软撤回作品。服务端与 mock 均保留记录并置为 removed。 */
export function useWithdrawPhoto(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => repos().photos.remove(id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.photo(id), exact: true })
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['photos'] })
      void queryClient.invalidateQueries({ queryKey: ['search'] })
      void queryClient.invalidateQueries({ queryKey: ['ranking'] })
    },
  })
}
