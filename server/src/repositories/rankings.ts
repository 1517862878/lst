/**
 * 周榜仓储（只读）。
 *
 * 两种来源：
 *   1) live  —— 当期实时榜：直接调数据库函数 compute_weekly_ranking 现算
 *   2) final —— 历史终榜：读快照表 weekly_rank_snapshots / weekly_rank_entries
 *
 * 为什么分两条路：
 *   实时榜必须反映此刻的数据；终榜是"已经结算、不再变化"的历史记录。
 *   读快照而不是重算，保证历史榜单不会因为后来的点赞而改变（这是公信力问题）。
 */
import type { PoolClient } from 'pg'
import { notFound } from '../lib/errors.js'
import { mapRankingEntry, mapPhoto, type PhotoRow, type RankingEntryRow } from '../lib/mappers.js'

/** ISO 周（2026-W44）→ 该周的起止时间（UTC） */
export function isoWeekRange(isoWeek: string): { start: Date; end: Date } {
  const m = /^(\d{4})-W(\d{2})$/.exec(isoWeek)
  if (!m) throw notFound(`ISO 周格式不正确：${isoWeek}`)
  const year = Number(m[1])
  const week = Number(m[2])

  // ISO 8601：第 1 周是包含 1 月 4 日的那一周，周一开始
  // 计算该年 1 月 4 日，回退到当周周一
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Day = jan4.getUTCDay() || 7 // 周日为 0，转成 7
  const week1Monday = new Date(jan4)
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1))

  const start = new Date(week1Monday)
  start.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7)

  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 7)

  return { start, end }
}

export interface RankingResult {
  isoWeek: string
  kind: 'live' | 'final'
  timezone: string
  weekStartUtc: string
  weekEndUtc: string
  capturedAt: string
  formulaVersion: string
  entries: ReturnType<typeof mapRankingEntry>[]
}

/** 实时榜：现算 */
export async function getLiveRanking(client: PoolClient, isoWeek: string, limit = 100): Promise<RankingResult> {
  const { start, end } = isoWeekRange(isoWeek)

  const res = await client.query<RankingEntryRow & { photo_id: string }>(
    `select rank, photo_id, like_count, favorite_count, score, tie_break_key
       from public.compute_weekly_ranking($1::timestamptz, $2::timestamptz, 'v1')
      order by rank asc
      limit $3`,
    [start.toISOString(), end.toISOString(), limit],
  )

  return {
    isoWeek,
    kind: 'live',
    timezone: 'Asia/Shanghai',
    weekStartUtc: start.toISOString(),
    weekEndUtc: end.toISOString(),
    capturedAt: new Date().toISOString(),
    formulaVersion: 'v1',
    entries: res.rows.map(mapRankingEntry),
  }
}

/** 终榜：读快照 */
export async function getFinalRanking(client: PoolClient, isoWeek: string): Promise<RankingResult> {
  const snap = await client.query<{
    id: string
    iso_week: string
    kind: string
    timezone: string
    week_start_utc: unknown
    week_end_utc: unknown
    captured_at: unknown
    formula_version: string
  }>(
    `select id, iso_week, kind, timezone, week_start_utc, week_end_utc, captured_at, formula_version
       from public.weekly_rank_snapshots
      where iso_week = $1 and kind = 'final'
      order by captured_at desc
      limit 1`,
    [isoWeek],
  )
  const s = snap.rows[0]
  if (!s) throw notFound(`该周终榜尚未结算：${isoWeek}`)

  const entries = await client.query<RankingEntryRow>(
    `select rank, photo_id, like_count, favorite_count, score, tie_break_key
       from public.weekly_rank_entries
      where snapshot_id = $1
      order by rank asc`,
    [s.id],
  )

  return {
    isoWeek: s.iso_week,
    kind: 'final',
    timezone: s.timezone,
    weekStartUtc: new Date(s.week_start_utc as string).toISOString(),
    weekEndUtc: new Date(s.week_end_utc as string).toISOString(),
    capturedAt: new Date(s.captured_at as string).toISOString(),
    formulaVersion: s.formula_version,
    entries: entries.rows.map(mapRankingEntry),
  }
}

/** 有数据的周列表 */
export async function listRankingWeeks(client: PoolClient) {
  const res = await client.query<{ iso_week: string; kind: string }>(
    `select iso_week, kind from public.weekly_rank_snapshots
      order by iso_week desc, kind`,
  )
  return res.rows.map((r) => ({ isoWeek: r.iso_week, kind: r.kind as 'live' | 'final' }))
}

/** 榜单条目附带作品信息（前端榜单页要显示缩略图与标题） */
export async function getPhotosByIds(
  client: PoolClient,
  ids: string[],
): Promise<ReturnType<typeof mapPhoto>[]> {
  if (ids.length === 0) return []
  const res = await client.query<PhotoRow>('select * from public.photos where id = any($1::uuid[])', [ids])
  return res.rows.map(mapPhoto)
}