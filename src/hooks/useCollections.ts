/**
 * 收藏夹与服务端草稿 hooks（8.3b）。
 *
 * 约定与其它仓储一致：查询走 TanStack Query，写操作成功后失效 ['collections'] 前缀
 * ——加一件作品会同时影响「我的夹列表数量」「夹详情首屏」「公开主页相册」，
 * 逐个点名 key 迟早会漏。
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CollectionVisibility, PublishDraftPayload } from '@/data/contracts'
import { createRepositories } from '@/data'
import { queryKeys } from './queryKeys'

const repos = () => createRepositories()

function invalidateCollections(client: ReturnType<typeof useQueryClient>): void {
  void client.invalidateQueries({ queryKey: ['collections'] })
}

/**
 * 我的服务端草稿。
 *
 * `enabled` 是为了 mock 模式：那段实现虽然也读 localStorage，但发布页在 mock 模式下
 * 走的是自己的本地草稿键（与老行为一致），不该多打一次没有意义的查询。
 */
export function useMyDraft(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.publishDraft(),
    queryFn: () => repos().collections.getMyDraft(),
    enabled: options?.enabled ?? true,
    // 草稿是「这台设备上我自己的东西」，没有跨用户共享，缓存到重新聚焦即可
    staleTime: 0,
    retry: false,
  })
}

export function useSaveMyDraft() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (payload: PublishDraftPayload) => repos().collections.saveMyDraft(payload),
    onSuccess: (data) => {
      // 只把保存时间写回缓存：整份 payload 就在调用方手里，重新拉一次反而会
      // 把「用户刚打完的最后一个字」覆盖成服务端上一版。
      client.setQueryData(queryKeys.publishDraft(), (previous: unknown) => {
        if (!previous || typeof previous !== 'object') return previous
        return { ...(previous as Record<string, unknown>), updatedAt: data.updatedAt }
      })
    },
  })
}

export function useDeleteMyDraft() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => repos().collections.deleteMyDraft(),
    onSuccess: () => {
      client.setQueryData(queryKeys.publishDraft(), { payload: null, updatedAt: null })
    },
  })
}

/** 我的收藏夹（含私密）。带 photoId 时摘要上会标出该作品是否已在夹中 */
export function useMyCollections(photoId?: string) {
  return useQuery({
    queryKey: queryKeys.myCollections(photoId),
    queryFn: () => repos().collections.listMyCollections(photoId ? { photoId } : undefined),
    staleTime: 15_000,
  })
}

/** 某个用户的公开相册（本人访问时含私密） */
export function useUserCollections(username: string) {
  return useQuery({
    queryKey: queryKeys.userCollections(username),
    queryFn: () => repos().collections.listUserCollections(username),
    enabled: Boolean(username),
    staleTime: 15_000,
  })
}

/** 收藏夹详情。不可见时仓储抛 NOT_FOUND，这里不重试，交给页面渲染空态 */
export function useCollection(id: string) {
  return useQuery({
    queryKey: queryKeys.collection(id),
    queryFn: () => repos().collections.getCollection(id),
    enabled: Boolean(id),
    retry: false,
    staleTime: 15_000,
  })
}

/** 夹内作品：游标无限加载 */
export function useCollectionItems(id: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.collectionItems(id),
    queryFn: ({ pageParam }) =>
      repos().collections.listCollectionItems(
        id,
        pageParam ? { cursor: pageParam } : undefined,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(id),
    staleTime: 15_000,
  })
}

export function useCreateCollection() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      title: string
      description?: string
      visibility?: CollectionVisibility
    }) => repos().collections.createCollection(input),
    onSuccess: () => {
      invalidateCollections(client)
    },
  })
}

export function useUpdateCollection() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      id: string
      patch: { title?: string; description?: string; visibility?: CollectionVisibility }
    }) => repos().collections.updateCollection(input.id, input.patch),
    onSuccess: () => {
      invalidateCollections(client)
    },
  })
}

export function useDeleteCollection() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string }) => repos().collections.deleteCollection(input.id),
    onSuccess: () => {
      invalidateCollections(client)
    },
  })
}

export function useAddCollectionItem() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { collectionId: string; photoId: string }) =>
      repos().collections.addItem(input.collectionId, input.photoId),
    onSuccess: () => {
      invalidateCollections(client)
    },
  })
}

export function useRemoveCollectionItem() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { collectionId: string; photoId: string }) =>
      repos().collections.removeItem(input.collectionId, input.photoId),
    onSuccess: () => {
      invalidateCollections(client)
    },
  })
}
