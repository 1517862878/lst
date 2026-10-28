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

/**
 * 某用户的作品（/me 本人视图，按 profiles.id 取）。
 *
 * 保留按 id 的口径：/me 拿得到自己的 id，works 用公开列表过滤即可，likes/favorites
 * 走「本人」专用的 listLikesByUser / listFavoritesByUser（API 模式仅限自己）。
 * 个人主页不要用这个 hook —— 那里拿不到 id，见 usePhotosByUsername。
 */
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

/**
 * 个人主页三 Tab：按 username 取（访客与本人同一套接口）。
 *
 * 为什么必须按 username 而不是 id：公开资料接口**不返回** profiles.id
 * （服务端不提供按 UUID 读用户的旁路），API 模式下主页永远拿不到 id，
 * 于是「拉最新 100 件再客户端过滤」就成了永远命不中的空查询 —— 任何主页都显示
 * 「还没有作品」。username 是主页唯一的稳定标识，服务端也按它授权（私密账号返回空页）。
 *
 * 一次性拉满 PROFILE_PAGE_SIZE 件而不是无限滚动：主页三个 Tab 是切换展示，
 * 滚动加载的收益很低，却要让每个 Tab 都维护一套分页状态。上限仍由服务端决定。
 */
const PROFILE_PAGE_SIZE = 100

export function usePhotosByUsername(username: string, kind: 'works' | 'likes' | 'favorites') {
  return useQuery({
    queryKey: queryKeys.photosByUsername(username, kind),
    queryFn: async () => {
      if (kind === 'works') {
        const page = await repos().photos.list({
          sort: 'latest',
          authorUsername: username,
          limit: PROFILE_PAGE_SIZE,
        })
        return page.items
      }
      const page = await repos().interactions.listByUsername(username, kind, undefined, PROFILE_PAGE_SIZE)
      return page.items
    },
    enabled: Boolean(username),
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
