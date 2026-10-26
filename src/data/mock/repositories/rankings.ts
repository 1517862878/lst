/**
 * Mock 榜单仓储。契约：RankingRepository。
 * 静态期：读取实体数据 → domain/ranking.ts 纯函数计算（ROADMAP §5.4）。
 */
import { AppError, ErrorCodes, type RankingRepository } from '@/data/contracts'
import type { RankingEntry, RankingKind, RankingSnapshot } from '@/domain/types'
import { computeWeeklyRanking, RANKING_FORMULA_VERSION, RANKING_TIMEZONE } from '@/domain/ranking'
import { getDb } from '../db'

/** 计算某 ISO 周的起止 UTC（周一开始，Asia/Shanghai 时区，ROADMAP §6.1） */
export function weekRangeUtc(isoWeek: string): { start: string; end: string } {
  const m = /^(\d{4})-W(\d{2})$/.exec(isoWeek)
  if (!m) throw new AppError(ErrorCodes.VALIDATION, `非法周编号：${isoWeek}`)
  const year = Number(m[1])
  const week = Number(m[2])
  // ISO 周：找到该年第 week 周的周一（UTC 表示 Asia/Shanghai 的周一 00:00）
  // Asia/Shanghai = UTC+8；周一 00:00 +08 = 周日 16:00 UTC
  const jan1 = new Date(Date.UTC(year, 0, 1))
  const jan1Day = jan1.getUTCDay() || 7 // 周一=1 … 周日=7
  const firstMonday = new Date(jan1)
  firstMonday.setUTCDate(jan1.getUTCDate() + ((8 - jan1Day) % 7))
  // 周一 00:00 +08 = 前一日 16:00 UTC；week 1 从 firstMonday 的 -8h 开始
  const start = new Date(firstMonday.getTime() - 8 * 3600_000 + (week - 1) * 7 * 24 * 3600_000)
  const end = new Date(start.getTime() + 7 * 24 * 3600_000)
  return { start: start.toISOString(), end: end.toISOString() }
}

function currentIsoWeek(): string {
  // 用 Asia/Shanghai 的当前时间算 ISO 周
  const now = new Date(Date.now() + 8 * 3600_000)
  const thursday = new Date(now)
  thursday.setUTCDate(now.getUTCDate() + 3 - ((now.getUTCDay() + 6) % 7))
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(
    ((thursday.getTime() - yearStart.getTime()) / 86400_000 + 1) / 7,
  )
  return `${thursday.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

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
