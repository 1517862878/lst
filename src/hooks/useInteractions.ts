/**
 * 互动 hooks（FRONTEND-WORK §4.3/§4.4）。
 * 点赞/收藏：乐观更新 + 失败回滚 + 跨标签同步。
 * 计数永远由数据派生，不在组件里加减（ROADMAP §5.3）。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CommentSort } from '@/data/contracts'
import type { Photo } from '@/domain/types'
import { createRepositories } from '@/data'
import { queryKeys } from './queryKeys'
import { BUS_EVENTS, emitBusEvent, onBusEvent } from '@/lib/bus'
import { useEffect } from 'react'

const repos = () => createRepositories()

/** 点赞状态（当前用户是否已赞） */
export function useLikeState(userId: string, photoId: string) {
  return useQuery({
    queryKey: queryKeys.likeState(userId, photoId),
    queryFn: () => repos().interactions.getLikeState(userId, photoId),
    enabled: Boolean(userId),
  })
}

/** 收藏状态 */
export function useFavoriteState(userId: string, photoId: string) {
  return useQuery({
    queryKey: queryKeys.favoriteState(userId, photoId),
    queryFn: () => repos().interactions.getFavoriteState(userId, photoId),
    enabled: Boolean(userId),
  })
}

/** 点赞切换（乐观更新：状态与计数同时更新） */
export function useToggleLike(userId: string, photoId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => repos().interactions.toggleLike(userId, photoId),
    onMutate: async () => {
      const stateKey = queryKeys.likeState(userId, photoId)
      const photoKey = queryKeys.photo(photoId)

      await queryClient.cancelQueries({ queryKey: stateKey })
      await queryClient.cancelQueries({ queryKey: photoKey })

      const prevState = queryClient.getQueryData<boolean>(stateKey)
      const prevPhoto = queryClient.getQueryData<Photo>(photoKey)

      // 先把"是否已赞"翻过来
      queryClient.setQueryData(stateKey, (old: boolean | undefined) => !old)

      // 关键：同时把页面上的计数也改掉。
      // 只翻状态不改计数的话，按钮会立刻变色但数字要等重新请求才动，
      // 用户看到的是"已点赞但数字没变"（真实缺陷，由 E2E 发现）。
      if (prevPhoto) {
        queryClient.setQueryData<Photo>(photoKey, {
          ...prevPhoto,
          likeCount: Math.max(0, prevPhoto.likeCount + (prevState ? -1 : 1)),
        })
      }

      return { prevState, prevPhoto }
    },
    onError: (_err, _vars, ctx) => {
      queryClient.setQueryData(queryKeys.likeState(userId, photoId), ctx?.prevState)
      if (ctx?.prevPhoto) queryClient.setQueryData(queryKeys.photo(photoId), ctx.prevPhoto)
    },
    onSettled: () => {
      // 精确失效：赞状态 + 作品计数 + 榜单
      void queryClient.invalidateQueries({ queryKey: queryKeys.likeState(userId, photoId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.photo(photoId) })
      void queryClient.invalidateQueries({ queryKey: ['ranking'] })
      emitBusEvent(BUS_EVENTS.INTERACTION_CHANGED, { photoId })
    },
  })
}

/** 收藏切换（乐观更新：状态与计数同时更新，同点赞） */
export function useToggleFavorite(userId: string, photoId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => repos().interactions.toggleFavorite(userId, photoId),
    onMutate: async () => {
      const stateKey = queryKeys.favoriteState(userId, photoId)
      const photoKey = queryKeys.photo(photoId)

      await queryClient.cancelQueries({ queryKey: stateKey })
      await queryClient.cancelQueries({ queryKey: photoKey })

      const prevState = queryClient.getQueryData<boolean>(stateKey)
      const prevPhoto = queryClient.getQueryData<Photo>(photoKey)

      queryClient.setQueryData(stateKey, (old: boolean | undefined) => !old)

      if (prevPhoto) {
        queryClient.setQueryData<Photo>(photoKey, {
          ...prevPhoto,
          favoriteCount: Math.max(0, prevPhoto.favoriteCount + (prevState ? -1 : 1)),
        })
      }

      return { prevState, prevPhoto }
    },
    onError: (_err, _vars, ctx) => {
      queryClient.setQueryData(queryKeys.favoriteState(userId, photoId), ctx?.prevState)
      if (ctx?.prevPhoto) queryClient.setQueryData(queryKeys.photo(photoId), ctx.prevPhoto)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.favoriteState(userId, photoId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.photo(photoId) })
      void queryClient.invalidateQueries({ queryKey: ['ranking'] })
      emitBusEvent(BUS_EVENTS.INTERACTION_CHANGED, { photoId })
    },
  })
}

/** 跨标签页：收到互动事件时失效相关缓存（FRONTEND-WORK §4.5） */
export function useInteractionSync() {
  const queryClient = useQueryClient()
  useEffect(() => {
    return onBusEvent(BUS_EVENTS.INTERACTION_CHANGED, (payload) => {
      const photoId = (payload as { photoId?: string } | null)?.photoId
      if (photoId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.photo(photoId) })
      }
      void queryClient.invalidateQueries({ queryKey: ['ranking'] })
    })
  }, [queryClient])
}

/** 评论列表（sort 进 key：两种排序是两份缓存，切换不闪旧顺序） */
export function useComments(photoId: string, sort: CommentSort = 'latest') {
  return useQuery({
    queryKey: queryKeys.comments(photoId, sort),
    queryFn: () => repos().comments.list({ photoId, sort }),
  })
}

/** 发表评论 */
export function usePostComment(photoId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { authorId: string; body: string; parentId: string | null }) =>
      repos().comments.create({ photoId, ...input }),
    onSettled: () => {
      // 前缀失效：一次刷掉 latest/oldest 两份缓存，否则切过去看不到刚发的
      void queryClient.invalidateQueries({ queryKey: queryKeys.commentsAll(photoId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.photo(photoId) })
      emitBusEvent(BUS_EVENTS.INTERACTION_CHANGED, { photoId })
    },
  })
}

/**
 * 删除评论（8.4b）：评论作者删自己的，作品作者删自己作品下的任意一条。
 *
 * 不做乐观删除：软删后列表里留下「该评论已删除」占位，与真实结果一致，
 * 但先把行抹掉再塞回来会让确认框刚关就闪一下。计数与占位等服务端回来再刷。
 */
export function useDeleteComment(photoId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (commentId: string) => repos().comments.softRemove(commentId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.commentsAll(photoId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.photo(photoId) })
      emitBusEvent(BUS_EVENTS.INTERACTION_CHANGED, { photoId })
    },
  })
}

/**
 * 作者开关评论（8.4b，乐观更新 + 失败回滚）。
 *
 * 乐观的是 photo 缓存里的 commentsLocked：开关、说明文案、输入框的显隐都从
 * 这一个值派生，改一处就整块一致；失败时把整份 photo 快照换回去，
 * 而不是只把布尔值翻回来（翻回来会留下被别处改动过的其他字段）。
 */
export function useSetCommentsLocked(photoId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (locked: boolean) => repos().comments.setLocked(photoId, locked),
    onMutate: async (locked) => {
      const photoKey = queryKeys.photo(photoId)
      await queryClient.cancelQueries({ queryKey: photoKey })
      const prevPhoto = queryClient.getQueryData<Photo>(photoKey)
      if (prevPhoto) {
        queryClient.setQueryData<Photo>(photoKey, { ...prevPhoto, commentsLocked: locked })
      }
      return { prevPhoto }
    },
    onError: (_err, _locked, ctx) => {
      if (ctx?.prevPhoto) queryClient.setQueryData(queryKeys.photo(photoId), ctx.prevPhoto)
    },
    onSuccess: (result) => {
      // 以服务端返回值收口：两人同时操作时，输的那一方要看到真正的状态
      queryClient.setQueryData<Photo>(queryKeys.photo(photoId), (old) =>
        old ? { ...old, commentsLocked: result.commentsLocked } : old,
      )
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.photo(photoId) })
    },
  })
}
