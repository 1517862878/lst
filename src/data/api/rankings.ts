/**
 * API 周榜仓储。
 */
import type { RankingRepository } from '@/data/contracts'
import type { RankingEntry, RankingSnapshot } from '@/domain/types'
import { request, qs } from './client'

/** 后端返回的形状（entries 可能附带 photo） */
interface ApiRankingResponse {
  isoWeek: string
  kind: 'live' | 'final'
  timezone: string
  weekStartUtc: string
  weekEndUtc: string
  capturedAt: string
  formulaVersion: string
  entries: Array<{
    rank: number
    photoId: string
    likeCount: number
    favoriteCount: number
    score: number
    tieBreakKey: string
    photo?: unknown
  }>
}

/**
 * 把后端响应转成前端 RankingSnapshot + entries。
 *
 * 为什么需要补 snapshotId：前端 RankingEntry 类型要求该字段，
 * 而后端没返回快照 id（实时榜是现算的，压根没有快照行）。
 * 用 `${isoWeek}-${kind}` 作为稳定标识即可。
 */
function adapt(isoWeek: string, kind: 'live' | 'final', r: ApiRankingResponse) {
  const snapshotId = `${isoWeek}-${kind}`

  const snapshot: RankingSnapshot = {
    id: snapshotId,
    isoWeek: r.isoWeek,
    kind: r.kind,
    timezone: r.timezone,
    weekStartUtc: r.weekStartUtc,
    weekEndUtc: r.weekEndUtc,
    capturedAt: r.capturedAt,
    formulaVersion: r.formulaVersion,
    entryCount: r.entries.length,
    status: 'ready',
  }

  const entries: RankingEntry[] = r.entries.map((e) => ({
    snapshotId,
    rank: e.rank,
    photoId: e.photoId,
    likeCount: e.likeCount,
    favoriteCount: e.favoriteCount,
    score: e.score,
    tieBreakKey: e.tieBreakKey,
  }))

  return { snapshot, entries, rawEntries: r.entries }
}

export const apiRankingRepository: RankingRepository = {
  async getWeekly(isoWeek: string, kind: 'live' | 'final') {
    const r = await request<ApiRankingResponse>(
      `/api/rankings/${encodeURIComponent(isoWeek)}` + qs({ kind }),
    )
    const { snapshot, entries } = adapt(isoWeek, kind, r)
    return { ...snapshot, entries }
  },

  async listWeeks() {
    return request<Array<{ isoWeek: string; kind: 'live' | 'final' }>>('/api/rankings')
  },
}
