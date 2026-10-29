/**
 * API 季节仓储（8.4a）。
 *
 * 契约：SeasonRepository（src/data/contracts）；后端 public.api_list_seasons。
 * 接口只返回「有作品的季节」，页面负责把缺的季节补成 0（chips 槽位不能跳动）。
 */
import type { SeasonRepository, SeasonSummary } from '@/data/contracts'
import { isSeason } from '@/domain/photography'
import { request } from './client'

export const apiSeasonRepository: SeasonRepository = {
  async list(): Promise<SeasonSummary[]> {
    const data = await request<{ items: SeasonSummary[] }>('/api/seasons')
    return (data.items ?? []).filter((item) => isSeason(item.season))
  },
}
