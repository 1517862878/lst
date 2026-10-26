/**
 * 互动 hooks（FRONTEND-WORK §4.3/§4.4）。
 * 点赞/收藏：乐观更新 + 失败回滚 + 跨标签同步。
 * 计数永远由数据派生，不在组件里加减（ROADMAP §5.3）。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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

/** 评论列表 */
export function useComments(photoId: string) {
  return useQuery({
    queryKey: queryKeys.comments(photoId),
    queryFn: () => repos().comments.list({ photoId }),
  })
}

/** 发表评论 */
export function usePostComment(photoId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { authorId: string; body: string; parentId: string | null }) =>
      repos().comments.create({ photoId, ...input }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.comments(photoId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.photo(photoId) })
      emitBusEvent(BUS_EVENTS.INTERACTION_CHANGED, { photoId })
    },
  })
}
