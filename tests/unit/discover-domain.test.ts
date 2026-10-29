/**
 * 发现页纯函数单测（src/domain/discover.ts，8.3c）。
 *
 * 这些函数是 mock 仓储与 api Postgres 函数共用的「同一份口径」：
 * 阈值（≥3）、窗口（days）、排序（获赞 → 作品数 → 创建时间）都锁在这里。
 * 它们一旦漂移，mock 与线上会给出不同的「热门搜索 / 新作者」列表。
 */
import { describe, expect, it } from 'vitest'
import type { Photo, Profile } from '@/domain/types'
import {
  FEATURED_LIMIT_MAX,
  HOT_SEARCH_MIN_COUNT,
  NEW_AUTHOR_DAYS,
  buildHotSearches,
  buildNewAuthors,
  clampInt,
  normalizeHotTerm,
  sortFeaturedPhotos,
} from '@/domain/discover'

const NOW = Date.parse('2026-10-29T00:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

function photo(id: string, overrides: Partial<Photo> = {}): Photo {
  return {
    id,
    authorId: 'u1',
    title: id,
    description: '',
    categorySlug: 'landscape',
    tags: [],
    locationName: '',
    locationLat: null,
    locationLng: null,
    locationPrecision: 'city',
    shotAt: null,
    exif: null,
    imageKey: `${id}.jpg`,
    thumbKey: `${id}-thumb.jpg`,
    width: 1600,
    height: 1067,
    blurhash: null,
    license: 'cc_by',
    status: 'published',
    likeCount: 0,
    favoriteCount: 0,
    commentCount: 0,
    viewCount: 0,
    publishedAt: new Date(NOW - DAY).toISOString(),
    createdAt: new Date(NOW - DAY).toISOString(),
    updatedAt: new Date(NOW - DAY).toISOString(),
    deletedAt: null,
    credit: null,
    ...overrides,
  }
}

function profile(id: string, overrides: Partial<Profile> = {}): Profile {
  return {
    id,
    username: id,
    displayName: id,
    avatarKey: null,
    bio: '',
    role: 'user',
    links: [],
    licensePreference: 'all_rights_reserved',
    createdAt: new Date(NOW - 10 * DAY).toISOString(),
    updatedAt: new Date(NOW - 10 * DAY).toISOString(),
    deletedAt: null,
    ...overrides,
  }
}

describe('clampInt', () => {
  it('非法值回落默认值', () => {
    expect(clampInt(undefined, 7, 1, 30)).toBe(7)
    expect(clampInt(Number.NaN, 7, 1, 30)).toBe(7)
    expect(clampInt('9' as unknown, 7, 1, 30)).toBe(7)
  })

  it('越界夹到边界，小数截断', () => {
    expect(clampInt(0, 7, 1, 30)).toBe(1)
    expect(clampInt(999, 7, 1, 30)).toBe(30)
    expect(clampInt(9.8, 7, 1, 30)).toBe(9)
  })
})

describe('normalizeHotTerm', () => {
  it('trim + 小写，与搜索日志的 term_key 同口径', () => {
    expect(normalizeHotTerm('  LandScape ')).toBe('landscape')
  })
})

describe('buildHotSearches', () => {
  it(`出现次数低于 ${HOT_SEARCH_MIN_COUNT} 的标签不进热门`, () => {
    const photos = [
      photo('p1', { tags: ['夜景'] }),
      photo('p2', { tags: ['夜景'] }),
      photo('p3', { tags: ['冷门'] }),
      photo('p4', { tags: ['冷门'] }),
    ]
    expect(buildHotSearches(photos, 7, 10, NOW)).toEqual([])
  })

  it('按出现次数降序；同次数时最近发布者优先', () => {
    const photos = [
      photo('p1', { tags: ['夜景'], publishedAt: new Date(NOW - 5 * DAY).toISOString() }),
      photo('p2', { tags: ['夜景'], publishedAt: new Date(NOW - 4 * DAY).toISOString() }),
      photo('p3', { tags: ['夜景'], publishedAt: new Date(NOW - 3 * DAY).toISOString() }),
      photo('p4', { tags: ['街拍'], publishedAt: new Date(NOW - 2 * DAY).toISOString() }),
      photo('p5', { tags: ['街拍'], publishedAt: new Date(NOW - 1 * DAY).toISOString() }),
      photo('p6', { tags: ['街拍'], publishedAt: new Date(NOW - 1 * DAY).toISOString() }),
      photo('p7', { tags: ['城市'], publishedAt: new Date(NOW - 1 * DAY).toISOString() }),
      photo('p8', { tags: ['城市'], publishedAt: new Date(NOW - 6 * DAY).toISOString() }),
      photo('p9', { tags: ['城市'], publishedAt: new Date(NOW - 2 * DAY).toISOString() }),
    ]
    const items = buildHotSearches(photos, 7, 10, NOW)
    expect(items.slice(0, 3).map((item) => item.term)).toEqual(['街拍', '城市', '夜景'])
  })

  it('大小写不同的同一词合并计数，保留最近一次的写法', () => {
    const photos = [
      photo('p1', { tags: ['Night'], publishedAt: new Date(NOW - 3 * DAY).toISOString() }),
      photo('p2', { tags: ['night'], publishedAt: new Date(NOW - 2 * DAY).toISOString() }),
      photo('p3', { tags: ['NIGHT'], publishedAt: new Date(NOW - 1 * DAY).toISOString() }),
    ]
    expect(buildHotSearches(photos, 7, 10, NOW)).toEqual([{ term: 'NIGHT', searchCount: 3 }])
  })

  it('窗口外的作品不计数；非在架作品也不计数', () => {
    const photos = [
      photo('old', { tags: ['夜景'], publishedAt: new Date(NOW - 10 * DAY).toISOString() }),
      photo('draft', { tags: ['夜景'], status: 'draft' }),
      photo('deleted', { tags: ['夜景'], deletedAt: new Date(NOW - DAY).toISOString() }),
      photo('p1', { tags: ['夜景'] }),
    ]
    expect(buildHotSearches(photos, 7, 10, NOW)).toEqual([])
  })

  it('limit 夹到 1..20', () => {
    const photos = Array.from({ length: 30 }, (_, i) =>
      photo(`p${i}`, { tags: [`词 ${i}`] }),
    )
    // 每个词只出现一次 → 不足阈值，先制造跨作品重复
    for (let i = 0; i < 3; i += 1) {
      photos[i] = photo(`rep${i}`, { tags: ['长曝'] })
    }
    expect(buildHotSearches(photos, 7, 999, NOW)).toHaveLength(1)
    expect(buildHotSearches(photos, 7, 0, NOW)).toHaveLength(1)
  })
})

describe('buildNewAuthors', () => {
  it('排除 staff、已删除、以及没有任何在架作品的作者', () => {
    const profiles = [
      profile('fresh'),
      profile('staffer', { role: 'editor' }),
      profile('gone', { deletedAt: new Date(NOW).toISOString() }),
      profile('empty'),
    ]
    const photos = [
      photo('p1', { authorId: 'fresh', likeCount: 5 }),
      photo('p2', { authorId: 'staffer', likeCount: 99 }),
      photo('p3', { authorId: 'gone', likeCount: 99 }),
    ]
    const result = buildNewAuthors(profiles, photos, NEW_AUTHOR_DAYS, 6, NOW)
    expect(result.map((item) => item.username)).toEqual(['fresh'])
    expect(result[0]).toMatchObject({ photoCount: 1, likeTotal: 5 })
  })

  it('排序：总获赞 → 作品数 → 创建时间', () => {
    const profiles = [
      profile('a', { createdAt: new Date(NOW - 3 * DAY).toISOString() }),
      profile('b', { createdAt: new Date(NOW - 2 * DAY).toISOString() }),
      profile('c', { createdAt: new Date(NOW - 1 * DAY).toISOString() }),
      profile('d', { createdAt: new Date(NOW - 4 * DAY).toISOString() }),
    ]
    const photos = [
      photo('a1', { authorId: 'a', likeCount: 2 }),
      photo('b1', { authorId: 'b', likeCount: 5 }),
      photo('b2', { authorId: 'b', likeCount: 0 }),
      photo('c1', { authorId: 'c', likeCount: 5 }),
      photo('d1', { authorId: 'd', likeCount: 5 }),
      photo('d2', { authorId: 'd', likeCount: 1 }),
    ]
    const result = buildNewAuthors(profiles, photos, NEW_AUTHOR_DAYS, 6, NOW)
    // b 与 c 都是 5 赞；b 有 2 件作品 → 排在 c（1 件）前；d 是 6 赞
    expect(result.map((item) => item.username)).toEqual(['d', 'b', 'c', 'a'])
  })

  it('窗口内没人时回落到全部合格作者，演示数据不会空块', () => {
    const old = new Date(NOW - 400 * DAY).toISOString()
    const profiles = [profile('veteran', { createdAt: old })]
    const photos = [photo('p1', { authorId: 'veteran' })]
    expect(buildNewAuthors(profiles, photos, NEW_AUTHOR_DAYS, 6, NOW)).toHaveLength(1)
  })

  it('limit 夹到 1..20 并截断', () => {
    const profiles = Array.from({ length: 30 }, (_, i) => profile(`u${i}`))
    const photos = profiles.map((item, i) => photo(`p${i}`, { authorId: item.id }))
    expect(buildNewAuthors(profiles, photos, NEW_AUTHOR_DAYS, 999, NOW)).toHaveLength(20)
    expect(buildNewAuthors(profiles, photos, NEW_AUTHOR_DAYS, 0, NOW)).toHaveLength(1)
  })
})

describe('sortFeaturedPhotos', () => {
  it('只要在架且 featuredAt 非空的，按精选时间倒序、id 兜底', () => {
    const photos = [
      photo('a', { featuredAt: '2026-10-01T00:00:00.000Z' }),
      photo('b', { featuredAt: '2026-10-03T00:00:00.000Z' }),
      photo('c', { featuredAt: null }),
      photo('d', { featuredAt: '2026-10-03T00:00:00.000Z' }),
      photo('e', { featuredAt: '2026-10-03T00:00:00.000Z', status: 'draft' }),
    ]
    expect(sortFeaturedPhotos(photos).map((item) => item.id)).toEqual(['d', 'b', 'a'])
  })

  it(`常量与页面一致：FEATURED_LIMIT_MAX = ${FEATURED_LIMIT_MAX}`, () => {
    expect(FEATURED_LIMIT_MAX).toBe(50)
  })
})
