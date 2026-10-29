/**
 * 创作者统计 hooks（8.3d）：/me 页「数据」区。
 *
 * 两条约定：
 *   · 失败不阻塞 —— 调用方用 `isError` 单独降级成一行提示，
 *     作品列表、关注动态等区块照常渲染（统计只是锦上添花）；
 *   · 缓存挂在 ['stats'] 前缀下，发布 / 编辑 / 下架后由各自的 mutation
 *     一次性 invalidate 前缀即可，不需要在这里注册监听。
 */
import { useQuery } from '@tanstack/react-query'
import { createRepositories } from '@/data'
import type { PhotoStatsQuery } from '@/data/contracts'
import { PHOTO_STATS_LIMIT } from '@/domain/stats'
import { queryKeys } from './queryKeys'

const repos = () => createRepositories()

/**
 * 数据卡的汇总数字。
 *
 * staleTime 60s：这些数字由别人的点赞评论改变，而 /me 页开着的时候不需要
 * 逐秒刷新；切回标签页时 react-query 的 refetchOnWindowFocus 会补一次。
 */
export function useCreatorStats() {
  return useQuery({
    queryKey: queryKeys.creatorStats(),
    queryFn: () => repos().stats.creatorStats(),
    staleTime: 60_000,
  })
}

/**
 * 作品数据表。
 *
 * enabled 由调用方按「是否登录」传入：未登录时 /api/me/stats/photos 必然 401，
 * 提前跳过可以避免一个注定失败的请求把页面打成错误态。
 */
export function usePhotoStats(query?: PhotoStatsQuery, enabled = true) {
  // 缺省值在这里先落地：查询键里不能出现 undefined（同一份数据会因为
  // 「显式传 undefined」与「没传」生成两个缓存条目），也满足后端的取值范围
  const limit = query?.limit ?? PHOTO_STATS_LIMIT
  const offset = query?.offset ?? 0
  return useQuery({
    queryKey: queryKeys.photoStats({ limit, offset }),
    queryFn: () => repos().stats.photoStats({ limit, offset }),
    enabled,
    staleTime: 60_000,
  })
}
