/**
 * API 创作者统计仓储（8.3d）。
 *
 * 端点清单已冻结：
 *   GET /api/me/stats?          → CreatorStats
 *   GET /api/me/stats/photos?limit=&offset= → { items: PhotoStats[] }
 *
 * 两个端点都是**按当前会话**读的：不带 username/id，未登录 401。
 * 因此这里不做任何「传谁查谁」的参数，页面上也没有越权入口可写。
 *
 * 参数校验：后端对越界（limit>100、offset<0、非数字）返回 400。
 * 前端仍然先夹一次 —— 不是为了绕过 400，而是避免同一个「查看全部」链接
 * 在有人手工改 URL 时把整页打成错误态。
 */
import type { PhotoStatsQuery, StatsRepository } from '@/data/contracts'
import type { CreatorStats, PhotoStats } from '@/domain/types'
import { clampStatsLimit, clampStatsOffset } from '@/domain/stats'
import { qs, request } from './client'

export const apiStatsRepository: StatsRepository = {
  async creatorStats(): Promise<CreatorStats> {
    return request<CreatorStats>('/api/me/stats')
  },

  async photoStats(query?: PhotoStatsQuery): Promise<PhotoStats[]> {
    const data = await request<{ items: PhotoStats[] }>(
      `/api/me/stats/photos${qs({
        limit: query?.limit === undefined ? undefined : clampStatsLimit(query.limit),
        offset: query?.offset === undefined ? undefined : clampStatsOffset(query.offset),
      })}`,
    )
    return data.items ?? []
  },
}
