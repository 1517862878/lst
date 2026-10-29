/**
 * Mock 季节仓储（8.4a）。
 *
 * 按 shot_at 的月份划分（3–5 春 / 6–8 夏 / 9–11 秋 / 12–2 冬），
 * 缺失 shot_at 时回落到发布时间 —— 与后端 api_list_seasons 同口径。
 */
import type { SeasonRepository, SeasonSummary } from '@/data/contracts'
import { buildSeasonSummary } from '@/domain/photography'
import { loadMaskedPhotos } from './gear'

export const mockSeasonRepository: SeasonRepository = {
  async list(): Promise<SeasonSummary[]> {
    return buildSeasonSummary(await loadMaskedPhotos())
  },
}
