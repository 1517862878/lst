/**
 * Mock 创作者统计仓储（8.3d）。
 *
 * 与 api 实现同一份契约、同一套纯函数（domain/stats.ts），差异只在数据来源：
 * 这里从 IndexedDB 的 photos / follows 现算，api 那边由 Postgres 聚合函数算。
 *
 * 为什么必须现算：/me 的「数据」区是演示页面最容易被判定「坏掉了」的地方，
 * 返回一排 0 会让人以为数据丢了；种子库里每位 demo 作者都有多件作品、若干个
 * 粉丝，按同一口径算出来的数字必然非零，肉眼一眼就能核对（点击作品数 →
 * 「最近作品」里的件数）。
 */
import { AppError, ErrorCodes, type PhotoStatsQuery, type StatsRepository } from '@/data/contracts'
import type { CreatorStats, Follow, Photo, PhotoStats } from '@/domain/types'
import { creatorStatsOf, clampStatsLimit, clampStatsOffset, photoStatsOf } from '@/domain/stats'
import { getDb } from '../db'
import { mockAuthRepository } from './auth'

async function loadPhotos(): Promise<Photo[]> {
  const db = await getDb()
  return db.getAll('photos')
}

async function loadFollows(): Promise<Follow[]> {
  const db = await getDb()
  return db.getAll('follows')
}

/** 统计是本人私有数据：未登录直接 401，与后端 api_my_stats 的授权口径一致 */
async function requireSession() {
  const session = await mockAuthRepository.getSession()
  if (!session) throw new AppError(ErrorCodes.UNAUTHORIZED, '请先登录后再查看创作数据')
  return session
}

export const mockStatsRepository: StatsRepository = {
  async creatorStats(): Promise<CreatorStats> {
    const session = await requireSession()
    const [photos, follows] = await Promise.all([loadPhotos(), loadFollows()])
    return creatorStatsOf(photos, follows, session.userId)
  },

  async photoStats(query?: PhotoStatsQuery): Promise<PhotoStats[]> {
    const session = await requireSession()
    const photos = await loadPhotos()
    return photoStatsOf(photos, session.userId, {
      limit: clampStatsLimit(query?.limit),
      offset: clampStatsOffset(query?.offset),
    })
  },
}
