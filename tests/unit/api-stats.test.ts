/**
 * API 创作者统计仓储单测（src/data/api/stats.ts）。
 *
 * 只桩最外层的 request：本文件锁的是「端点拼装 + 参数夹取 + 解包 items」这段契约。
 * 冻结端点：GET /api/me/stats 与 GET /api/me/stats/photos?limit=&offset=。
 * 这两个 URL 一旦改动，第一个红的应该是这里而不是 E2E。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreatorStats, PhotoStats } from '@/domain/types'

vi.mock('@/data/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/api/client')>()
  return { ...actual, request: vi.fn() }
})

const { request } = await import('@/data/api/client')
const { apiStatsRepository } = await import('@/data/api/stats')

const requestMock = vi.mocked(request)

const stats: CreatorStats = {
  photoCount: 12,
  publishedCount: 9,
  draftCount: 3,
  likeTotal: 1204,
  favoriteTotal: 87,
  commentTotal: 45,
  viewTotal: 23456,
  followerCount: 31,
  followingCount: 8,
}

const row: PhotoStats = {
  photoId: 'p-1',
  title: '晨雾',
  status: 'published',
  publishedAt: '2026-03-01T00:00:00.000Z',
  likeCount: 12,
  favoriteCount: 3,
  commentCount: 4,
  viewCount: 250,
  featuredAt: null,
}

beforeEach(() => {
  requestMock.mockReset()
})

describe('apiStatsRepository.creatorStats', () => {
  it('打 GET /api/me/stats 并原样返回（不带任何用户参数）', async () => {
    requestMock.mockResolvedValueOnce(stats)
    await expect(apiStatsRepository.creatorStats()).resolves.toEqual(stats)
    expect(requestMock).toHaveBeenCalledWith('/api/me/stats')
  })

  it('401 原样抛出，交给页面降级', async () => {
    const error = new Error('请先登录')
    requestMock.mockRejectedValueOnce(error)
    await expect(apiStatsRepository.creatorStats()).rejects.toBe(error)
  })
})

describe('apiStatsRepository.photoStats', () => {
  it('无参时不带 query 尾巴', async () => {
    requestMock.mockResolvedValueOnce({ items: [row] })
    await expect(apiStatsRepository.photoStats()).resolves.toEqual([row])
    expect(requestMock).toHaveBeenCalledWith('/api/me/stats/photos')
  })

  it('limit/offset 透传成查询串', async () => {
    requestMock.mockResolvedValueOnce({ items: [] })
    await apiStatsRepository.photoStats({ limit: 20, offset: 40 })
    expect(requestMock).toHaveBeenCalledWith('/api/me/stats/photos?limit=20&offset=40')
  })

  it('越界参数先夹一次，不让手工改 URL 打成 400', async () => {
    requestMock.mockResolvedValue({ items: [] })
    await apiStatsRepository.photoStats({ limit: 999, offset: -3 })
    expect(requestMock).toHaveBeenLastCalledWith('/api/me/stats/photos?limit=100&offset=0')
  })

  it('只传 offset 时不塞 limit', async () => {
    requestMock.mockResolvedValueOnce({ items: [] })
    await apiStatsRepository.photoStats({ offset: 10 })
    expect(requestMock).toHaveBeenCalledWith('/api/me/stats/photos?offset=10')
  })

  it('返回体缺 items 时退化成空数组而不是 undefined', async () => {
    requestMock.mockResolvedValueOnce({} as { items: PhotoStats[] })
    const rows = await apiStatsRepository.photoStats()
    expect(rows).toEqual([])
    expect(Array.isArray(rows)).toBe(true)
  })
})
