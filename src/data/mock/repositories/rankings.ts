/**
 * Mock 榜单仓储。契约：RankingRepository。
 * 静态期：读取实体数据 → domain/ranking.ts 纯函数计算（ROADMAP §5.4）。
 */
import type { RankingRepository } from '@/data/contracts'
import type { RankingEntry, RankingKind, RankingSnapshot } from '@/domain/types'
import { computeWeeklyRanking, RANKING_FORMULA_VERSION, RANKING_TIMEZONE } from '@/domain/ranking'
import { currentIsoWeek, weekRangeUtc } from '@/lib/time'
import { getDb } from '../db'
export const mockRankingRepository: RankingRepository = {
  async getWeekly(
    isoWeek: string,
    kind: 'live' | 'final',
  ): Promise<RankingSnapshot & { entries: RankingEntry[] }> {
    const db = await getDb()
    const [photos, likes, favorites] = await Promise.all([
      db.getAll('photos'),
      db.getAll('likes'),
      db.getAll('favorites'),
    ])

    // 统一用 lib/time 的周窗口计算。
    // 早先这里自己复制了一份实现（用 1 月 1 日推 firstMonday），
    // 算出的窗口整整晚一周 —— 导致榜单永远取到未来一周、分数全是 0（由 E2E 发现）。
    // 同一规则只允许存在一份实现，避免再次分叉。
    const { start, end } = weekRangeUtc(isoWeek)

    const result = computeWeeklyRanking({ photos, likes, favorites }, start, end)
    const now = new Date().toISOString()
    const snapshot: RankingSnapshot = {
      id: `snap-${isoWeek}-${kind}`,
      isoWeek,
      kind: kind as RankingKind,
      timezone: RANKING_TIMEZONE,
      weekStartUtc: start,
      weekEndUtc: end,
      capturedAt: now,
      formulaVersion: RANKING_FORMULA_VERSION,
      entryCount: result.entries.length,
      status: 'ready',
    }
    const entries: RankingEntry[] = result.entries.map((e) => ({
      snapshotId: snapshot.id,
      rank: e.rank,
      photoId: e.photo.id,
      likeCount: e.likeCount,
      favoriteCount: e.favoriteCount,
      score: Number(e.score.toFixed(2)),
      tieBreakKey: e.tieBreakKey,
    }))
    return { ...snapshot, entries }
  },

  async listWeeks(): Promise<Array<{ isoWeek: string; kind: 'live' | 'final' }>> {
    return [{ isoWeek: currentIsoWeek(), kind: 'live' }]
  },
}
