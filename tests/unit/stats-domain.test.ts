/**
 * 创作者统计纯函数（src/domain/stats.ts）+ 数字格式化（src/lib/format.ts）。
 *
 * 这里锁的是**口径**，不是渲染：mock 仓储、后续的 api 实现、页面上的卡片与表格
 * 都读这几个函数，口径一旦漂移，三个地方会一起错且错得一致（最难发现的那种）。
 * 每一条断言都对应 supabase 迁移里 api_creator_stats / api_photo_stats 的一句 SQL。
 */
import { describe, expect, it } from 'vitest'
import {
  PHOTO_STATS_LIMIT,
  clampStatsLimit,
  clampStatsOffset,
  creatorStatsOf,
  photoStatsOf,
  statsStatusOf,
} from '@/domain/stats'
import type { Follow, Photo } from '@/domain/types'
import { formatNumber } from '@/lib/format'

function photo(id: string, authorId: string, overrides: Partial<Photo> = {}): Photo {
  return {
    id,
    authorId,
    title: `作品 ${id}`,
    description: '',
    categorySlug: 'landscape',
    tags: [],
    locationName: '',
    locationLat: null,
    locationLng: null,
    locationPrecision: 'city',
    shotAt: null,
    exif: null,
    imageKey: '',
    thumbKey: '',
    width: 1,
    height: 1,
    blurhash: null,
    license: 'all_rights_reserved',
    credit: null,
    status: 'published',
    likeCount: 0,
    favoriteCount: 0,
    commentCount: 0,
    viewCount: 0,
    publishedAt: '2026-02-01T00:00:00.000Z',
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

const follow = (followerId: string, followingId: string): Follow => ({
  followerId,
  followingId,
  createdAt: '2026-02-01T00:00:00.000Z',
})

describe('clampStatsLimit / clampStatsOffset', () => {
  it('缺省与非法值回落到默认值', () => {
    expect(clampStatsLimit(undefined)).toBe(PHOTO_STATS_LIMIT)
    expect(clampStatsLimit(Number.NaN)).toBe(PHOTO_STATS_LIMIT)
    expect(clampStatsLimit('20')).toBe(PHOTO_STATS_LIMIT)
    expect(clampStatsOffset(undefined)).toBe(0)
    expect(clampStatsOffset(Number.NaN)).toBe(0)
  })

  it('越界夹到 [1,100] 与 ≥0', () => {
    expect(clampStatsLimit(0)).toBe(1)
    expect(clampStatsLimit(500)).toBe(100)
    expect(clampStatsLimit(12.9)).toBe(12)
    expect(clampStatsOffset(-5)).toBe(0)
    expect(clampStatsOffset(7.8)).toBe(7)
  })
})

describe('creatorStatsOf', () => {
  it('只算自己的作品，别人的一概不进', () => {
    const photos = [
      photo('mine-1', 'u-me', { likeCount: 3 }),
      photo('others-1', 'u-bob', { likeCount: 99 }),
    ]
    const stats = creatorStatsOf(photos, [], 'u-me')
    expect(stats.photoCount).toBe(1)
    expect(stats.likeTotal).toBe(3)
  })

  it('已删除的作品不计入作品数', () => {
    const photos = [
      photo('a', 'u-me'),
      photo('b', 'u-me', { deletedAt: '2026-03-01T00:00:00.000Z' }),
    ]
    expect(creatorStatsOf(photos, [], 'u-me').photoCount).toBe(1)
  })

  it('在架 / 草稿分开数，下架与隐藏都落在「不在架」里', () => {
    const photos = [
      photo('p1', 'u-me'),
      photo('d1', 'u-me', { status: 'draft', publishedAt: null }),
      photo('d2', 'u-me', { status: 'draft', publishedAt: null }),
      photo('x1', 'u-me', { status: 'removed' }),
      photo('x2', 'u-me', { status: 'hidden' }),
    ]
    const stats = creatorStatsOf(photos, [], 'u-me')
    expect(stats.photoCount).toBe(5)
    expect(stats.publishedCount).toBe(1)
    expect(stats.draftCount).toBe(2)
  })

  it('获赞/收藏/评论/浏览只累加在架作品：草稿的火不算影响力', () => {
    const photos = [
      photo('p1', 'u-me', { likeCount: 10, favoriteCount: 4, commentCount: 2, viewCount: 100 }),
      photo('d1', 'u-me', {
        status: 'draft',
        publishedAt: null,
        likeCount: 999,
        favoriteCount: 999,
        commentCount: 999,
        viewCount: 999,
      }),
    ]
    const stats = creatorStatsOf(photos, [], 'u-me')
    expect(stats.likeTotal).toBe(10)
    expect(stats.favoriteTotal).toBe(4)
    expect(stats.commentTotal).toBe(2)
    expect(stats.viewTotal).toBe(100)
  })

  it('粉丝数的是「指向我」的关注，关注数的是「由我发出」的', () => {
    const follows = [
      follow('u-a', 'u-me'),
      follow('u-b', 'u-me'),
      follow('u-me', 'u-c'),
      follow('u-a', 'u-b'),
    ]
    const stats = creatorStatsOf([], follows, 'u-me')
    expect(stats.followerCount).toBe(2)
    expect(stats.followingCount).toBe(1)
  })

  it('什么都没有时是九项全 0 而不是 undefined', () => {
    const stats = creatorStatsOf([], [], 'u-me')
    expect(stats).toEqual({
      photoCount: 0,
      publishedCount: 0,
      draftCount: 0,
      likeTotal: 0,
      favoriteTotal: 0,
      commentTotal: 0,
      viewTotal: 0,
      followerCount: 0,
      followingCount: 0,
    })
  })
})

describe('statsStatusOf', () => {
  it('hidden 并入 removed：对作者来说都是「看不到」', () => {
    expect(statsStatusOf(photo('p', 'u-me'))).toBe('published')
    expect(statsStatusOf(photo('d', 'u-me', { status: 'draft' }))).toBe('draft')
    expect(statsStatusOf(photo('r', 'u-me', { status: 'removed' }))).toBe('removed')
    expect(statsStatusOf(photo('h', 'u-me', { status: 'hidden' }))).toBe('removed')
  })
})

describe('photoStatsOf', () => {
  it('按 max(发布时间, 创建时间) 倒序，时间相同按 id 倒序', () => {
    const photos = [
      photo('b', 'u-me', { publishedAt: '2026-02-01T00:00:00.000Z' }),
      photo('a', 'u-me', { publishedAt: '2026-02-01T00:00:00.000Z' }),
      photo('c', 'u-me', { publishedAt: '2026-03-01T00:00:00.000Z' }),
      // 草稿没有发布时间，用创建时间参与排序
      photo('d', 'u-me', {
        status: 'draft',
        publishedAt: null,
        createdAt: '2026-04-01T00:00:00.000Z',
      }),
    ]
    expect(photoStatsOf(photos, 'u-me').map((row) => row.photoId)).toEqual(['d', 'c', 'b', 'a'])
  })

  it('limit/offset 切片，且默认最多 50 行', () => {
    const photos = Array.from({ length: 60 }, (_, index) =>
      photo(`p${String(index).padStart(2, '0')}`, 'u-me', {
        publishedAt: `2026-02-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
      }),
    )
    expect(photoStatsOf(photos, 'u-me')).toHaveLength(PHOTO_STATS_LIMIT)
    expect(photoStatsOf(photos, 'u-me', { limit: 5, offset: 2 })).toHaveLength(5)
    expect(photoStatsOf(photos, 'u-me')[10]).toBeDefined()
  })

  it('行里带精选时间：featuredAt 缺省收敛成 null', () => {
    const photos = [
      photo('f', 'u-me', { featuredAt: '2026-03-02T00:00:00.000Z' }),
      photo('n', 'u-me'),
    ]
    const rows = photoStatsOf(photos, 'u-me')
    expect(rows.find((row) => row.photoId === 'f')?.featuredAt).toBe('2026-03-02T00:00:00.000Z')
    expect(rows.find((row) => row.photoId === 'n')?.featuredAt).toBeNull()
  })

  it('别人的作品不出现在我的表里', () => {
    const photos = [photo('mine', 'u-me'), photo('theirs', 'u-bob')]
    expect(photoStatsOf(photos, 'u-me').map((row) => row.photoId)).toEqual(['mine'])
  })
})

describe('formatNumber', () => {
  it('三位一组加逗号', () => {
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(7)).toBe('7')
    expect(formatNumber(999)).toBe('999')
    expect(formatNumber(1000)).toBe('1,000')
    expect(formatNumber(12345)).toBe('12,345')
    expect(formatNumber(1234567)).toBe('1,234,567')
  })

  it('负数保留符号', () => {
    expect(formatNumber(-1234)).toBe('-1,234')
  })

  it('非有限数与脏数据回落成 0，不显示 NaN', () => {
    expect(formatNumber(Number.NaN)).toBe('0')
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('0')
  })

  it('小数截断（计数没有小数）', () => {
    expect(formatNumber(1234.9)).toBe('1,234')
  })
})
