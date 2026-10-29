/**
 * 摄影专业化 hooks（8.4a）：器材 / 地点 / 季节 / 拍摄参数隐私 / 主页代表作。
 *
 * 全部走仓储（data/index 决定 mock 还是 api），页面不直接碰实现。
 * 读接口按「空即隐藏」设计：`data` 为空数组时区块整块消失，因此不设 placeholderData，
 * 让「还在加载」与「真的没有数据」在调用方分得清。
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createRepositories } from '@/data'
import type { GearKind } from '@/data/contracts'
import type { ExifVisibility } from '@/domain/photography'
import { queryKeys } from './queryKeys'

const repos = () => createRepositories()

/** 器材总览（机身 + 镜头两组，各自带作品数/作者数） */
export function useGearList(limit?: number) {
  return useQuery({
    queryKey: [...queryKeys.gear(), limit ?? 'default'] as const,
    queryFn: () => repos().gear.list(limit),
    staleTime: 60_000,
  })
}

/** 某器材下的作品流（游标无限滚动） */
export function useGearPhotos(kind: GearKind, label: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.gearPhotos(kind, label),
    queryFn: async ({ pageParam }) =>
      repos().gear.photos(kind, label, pageParam ? { cursor: pageParam } : {}),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: label !== '',
    staleTime: 30_000,
  })
}

/** 地点总览（作品数 / 作者数 / 最近发布） */
export function usePlaces(limit?: number) {
  return useQuery({
    queryKey: [...queryKeys.places(), limit ?? 'default'] as const,
    queryFn: () => repos().places.list(limit),
    staleTime: 60_000,
  })
}

/** 某地点的作品流（游标无限滚动） */
export function usePlacePhotos(label: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.placePhotos(label),
    queryFn: async ({ pageParam }) =>
      repos().places.photos(label, pageParam ? { cursor: pageParam } : {}),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: label !== '',
    staleTime: 30_000,
  })
}

/** 季节计数（chips 上的数字；空数组时页面按 0 补齐槽位） */
export function useSeasons() {
  return useQuery({
    queryKey: queryKeys.seasons(),
    queryFn: () => repos().seasons.list(),
    staleTime: 5 * 60_000,
  })
}

/**
 * 保存账户级拍摄参数默认范围。
 *
 * 失效范围比「只刷设置页」更大：账户级开关会让**所有**作品的 EXIF 一并出现/消失，
 * 器材聚合（按 EXIF 派生）也会跟着变，所以摄影前缀与作品详情一起失效。
 */
export function useSetExifVisibility() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (visibility: ExifVisibility) => repos().profile.setExifVisibility(visibility),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.photography() })
      void queryClient.invalidateQueries({ queryKey: ['photos'] })
      void queryClient.invalidateQueries({ queryKey: ['profile'] })
      void queryClient.invalidateQueries({ queryKey: ['profileByUsername'] })
      void queryClient.invalidateQueries({ queryKey: ['account-center'] })
    },
  })
}

/**
 * 保存主页代表作（最多 3 件，有序）。
 *
 * 以服务端返回为准：越权/已撤回的 id 会被后端拒掉，前端不做「本地先成、再回滚」
 * 的乐观更新——那会让主页短暂展示一件不属于自己的作品。
 */
export function useSetPinned() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (photoIds: string[]) => repos().profile.setPinned(photoIds),
    onSuccess: () => {
      // 只失效、不做乐观写入：上移/下移都走同一条服务端结果，顺序由后端拍板，
      // 本地再拼一份摘要就会与服务端规范化后的顺序打架。
      void queryClient.invalidateQueries({ queryKey: ['profile'] })
      void queryClient.invalidateQueries({ queryKey: ['profileByUsername'] })
    },
  })
}
