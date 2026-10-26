import { describe, expect, it } from 'vitest'
import { computeWeeklyRanking } from '@/domain/ranking'
import type { Interaction, Photo } from '@/domain/types'

const ISO = (t: string) => t

function makePhoto(overrides: Partial<Photo>): Photo {
  return {
    id: 'p1',
    authorId: 'u1',
    title: '测试作品',
    description: '',
    categorySlug: 'landscape',
    tags: [],
    locationName: '',
    locationLat: null,
    locationLng: null,
    locationPrecision: 'city',
    shotAt: null,
    exif: null,
    imageKey: 'k',
    thumbKey: 't',
    width: 1600,
    height: 900,
    blurhash: null,
    license: 'all_rights_reserved',
    credit: null,
    status: 'published',
    likeCount: 0,
    favoriteCount: 0,
    commentCount: 0,
    viewCount: 0,
    publishedAt: ISO('2026-10-20T00:00:00Z'),
    createdAt: ISO('2026-10-20T00:00:00Z'),
    updatedAt: ISO('2026-10-20T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  }
}

function like(userId: string, photoId: string, createdAt: string): Interaction {
  return { userId, photoId, createdAt }
}

describe('computeWeeklyRanking（周榜纯函数）', () => {
  const weekStart = '2026-10-19T00:00:00Z'
  const weekEnd = '2026-10-26T00:00:00Z'

  it('空输入返回空榜单', () => {
    const r = computeWeeklyRanking({ photos: [], likes: [], favorites: [] }, weekStart, weekEnd)
    expect(r.entries).toEqual([])
  })

  it('按公式计分：1×赞 + 3×藏，排序正确', () => {
    const a = makePhoto({ id: 'a', publishedAt: ISO('2026-10-20T00:00:00Z') })
    const b = makePhoto({ id: 'b', publishedAt: ISO('2026-10-21T00:00:00Z') })
    const likes = [
      like('u9', 'a', '2026-10-20T12:00:00Z'),
      like('u9', 'b', '2026-10-21T12:00:00Z'),
      like('u8', 'b', '2026-10-21T13:00:00Z'),
    ]
    const favorites = [like('u9', 'a', '2026-10-20T13:00:00Z')]
    const r = computeWeeklyRanking({ photos: [a, b], likes, favorites }, weekStart, weekEnd)
    // a: 1赞+1藏=4；b: 2赞+0藏=2
    expect(r.entries[0]!.photo.id).toBe('a')
    expect(r.entries[0]!.score).toBe(4)
    expect(r.entries[1]!.photo.id).toBe('b')
    expect(r.entries[1]!.score).toBe(2)
  })

  it('窗口外的互动不计入（半开区间）', () => {
    const a = makePhoto({ id: 'a' })
    const likes = [like('u9', 'a', '2026-10-26T00:00:00Z')] // 恰好在 end，应排除
    const r = computeWeeklyRanking({ photos: [a], likes, favorites: [] }, weekStart, weekEnd)
    expect(r.entries[0]!.likeCount).toBe(0)
  })

  it('作者自赞不计分', () => {
    const a = makePhoto({ id: 'a', authorId: 'u1' })
    const likes = [like('u1', 'a', '2026-10-20T12:00:00Z')] // 作者自己
    const r = computeWeeklyRanking({ photos: [a], likes, favorites: [] }, weekStart, weekEnd)
    expect(r.entries[0]!.likeCount).toBe(0)
  })

  it('非 published 作品不上榜', () => {
    const a = makePhoto({ id: 'a', status: 'draft', publishedAt: null })
    const likes = [like('u9', 'a', '2026-10-20T12:00:00Z')]
    const r = computeWeeklyRanking({ photos: [a], likes, favorites: [] }, weekStart, weekEnd)
    expect(r.entries).toEqual([])
  })

  it('名次唯一：同分按全序决定且两次计算一致', () => {
    const a = makePhoto({ id: 'a', publishedAt: ISO('2026-10-20T00:00:00Z') })
    const b = makePhoto({ id: 'b', publishedAt: ISO('2026-10-20T00:00:00Z') })
    const likes = [like('u9', 'a', '2026-10-20T12:00:00Z'), like('u9', 'b', '2026-10-20T12:00:00Z')]
    const input = { photos: [a, b], likes, favorites: [] }
    const r1 = computeWeeklyRanking(input, weekStart, weekEnd)
    const r2 = computeWeeklyRanking(input, weekStart, weekEnd)
    expect(r1.entries.map((e) => e.rank)).toEqual(r2.entries.map((e) => e.rank))
    expect(new Set(r1.entries.map((e) => e.rank)).size).toBe(2)
  })
})
