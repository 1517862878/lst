/**
 * 标签聚合纯函数层单测（src/domain/tags.ts）。
 *
 * 与 social 同理：jsdom 里没有 IndexedDB，而这一层是 mock / api 两套仓储
 * **共用**的口径（聚合、排序、共现、游标全序），所以规则要在这一层锁死。
 */
import { describe, expect, it } from 'vitest'
import type { Photo } from '@/domain/types'
import {
  TAG_MAX_LENGTH,
  TAG_PAGE_LIMIT_MAX,
  TAG_RELATED_LIMIT,
  filterTagStats,
  isValidTag,
  limitTagStats,
  photosWithTag,
  relatedTags,
  sortTagPhotos,
  sortTagStats,
  tagDetail,
  tagKey,
  tagStats,
} from '@/domain/tags'

function photo(id: string, authorId: string, tags: string[], overrides: Partial<Photo> = {}): Photo {
  return {
    id,
    authorId,
    title: `作品 ${id}`,
    description: '',
    categorySlug: 'landscape',
    tags,
    locationName: '',
    locationLat: null,
    locationLng: null,
    locationPrecision: 'city',
    shotAt: null,
    exif: null,
    imageKey: `photos/${id}.webp`,
    thumbKey: `photos/${id}-thumb.webp`,
    width: 1600,
    height: 1067,
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

const PHOTOS: Photo[] = [
  photo('p1', 'u1', ['夜景', '城市'], { likeCount: 10, favoriteCount: 2 }),
  photo('p2', 'u2', ['夜景', '长曝光'], {
    publishedAt: '2026-03-01T00:00:00.000Z',
    likeCount: 1,
    favoriteCount: 1,
  }),
  photo('p3', 'u1', ['城市', 'Landscape'], { likeCount: 5, favoriteCount: 0 }),
  // 草稿与已删除：绝不能进标签统计（否则标签页泄露未公开内容）
  photo('p4', 'u3', ['夜景'], { status: 'draft' }),
  photo('p5', 'u4', ['夜景'], { deletedAt: '2026-03-02T00:00:00.000Z' }),
]

describe('domain/tags · 归一与合法性', () => {
  it('比较键大小写不敏感，展示值保留原文', () => {
    expect(tagKey('  Landscape ')).toBe('landscape')
    expect(tagKey('夜景')).toBe('夜景')
  })

  it('空标签与超长标签不合法，边界值合法', () => {
    expect(isValidTag('   ')).toBe(false)
    expect(isValidTag('a'.repeat(TAG_MAX_LENGTH))).toBe(true)
    expect(isValidTag('a'.repeat(TAG_MAX_LENGTH + 1))).toBe(false)
  })
})

describe('domain/tags · 聚合', () => {
  it('只统计已发布未删除的作品，作者数去重', () => {
    const stats = tagStats(PHOTOS)
    const night = stats.find((item) => item.tag === '夜景')
    expect(night).toMatchObject({ photoCount: 2, authorCount: 2 })
    expect(night?.latestPublishedAt).toBe('2026-03-01T00:00:00.000Z')

    // 城市 的两件作品同属 u1：作品数 2、作者数必须是 1（去重而不是按作品计）
    const city = stats.find((item) => item.tag === '城市')
    expect(city).toMatchObject({ photoCount: 2, authorCount: 1 })
  })

  it('同一作品里的重复标签只计一次（大小写不敏感）', () => {
    const stats = tagStats([photo('x', 'u1', ['夜景', ' 夜景 ', '夜 景'])])
    expect(stats).toHaveLength(2)
    expect(stats.find((item) => item.tag === '夜景')?.photoCount).toBe(1)
  })

  it('前缀过滤大小写不敏感，空前缀返回全部', () => {
    const stats = tagStats(PHOTOS)
    expect(filterTagStats(stats, 'land')).toHaveLength(1)
    expect(filterTagStats(stats, 'Land')).toHaveLength(1)
    expect(filterTagStats(stats, '')).toHaveLength(stats.length)
  })
})

describe('domain/tags · 排序与截断', () => {
  it('hot 按作品数降序，latest 按最近发布时间降序，tag 作末级稳定键', () => {
    const stats = tagStats(PHOTOS)
    const hot = sortTagStats(stats, 'hot')
    expect(hot[0]?.photoCount).toBe(2)
    // 同计数时按发布时间倒序：夜景(2026-03) 先于 城市(2026-02)
    expect(hot.map((item) => item.tag)).toEqual(['夜景', '城市', '长曝光', 'Landscape'])

    const latest = sortTagStats(stats, 'latest')
    expect(latest[0]?.tag).toBe('夜景')
  })

  it('排序结果稳定：同样输入两次排序结果一致', () => {
    const stats = tagStats(PHOTOS)
    expect(sortTagStats(stats, 'hot')).toEqual(sortTagStats(sortTagStats(stats, 'hot'), 'hot'))
  })

  it('limit 夹在 1..上限之间，非法值退回默认页长', () => {
    const stats = tagStats(PHOTOS)
    expect(limitTagStats(stats, 2)).toHaveLength(2)
    expect(limitTagStats(stats, 0)).toHaveLength(1)
    expect(limitTagStats(stats, 999)).toHaveLength(stats.length)
    expect(limitTagStats(stats, Number.NaN).length).toBeLessThanOrEqual(TAG_PAGE_LIMIT_MAX)
  })
})

describe('domain/tags · 相关标签与详情', () => {
  it('相关标签按共现次数排序且不含自身', () => {
    const related = relatedTags(PHOTOS, '夜景')
    expect(related.map((item) => item.tag)).toEqual(['城市', '长曝光'])
    expect(related.every((item) => item.tag !== '夜景')).toBe(true)
    expect(related.length).toBeLessThanOrEqual(TAG_RELATED_LIMIT)
  })

  it('大小写不同的同一标签能互相找到相关项', () => {
    const related = relatedTags(PHOTOS, 'landscape')
    expect(related).toEqual([{ tag: '城市', count: 1 }])
  })

  it('未知标签返回空详情而不是抛错', () => {
    expect(tagDetail(PHOTOS, '不存在的标签')).toMatchObject({
      tag: '不存在的标签',
      photoCount: 0,
      authorCount: 0,
      relatedTags: [],
    })
  })

  it('详情返回聚合后的展示原文（大小写归到作者写法）', () => {
    expect(tagDetail(PHOTOS, 'LANDSCAPE').tag).toBe('Landscape')
  })
})

describe('domain/tags · 作品流', () => {
  it('只返回带该标签的可发布作品', () => {
    expect(photosWithTag(PHOTOS, '夜景').map((item) => item.id)).toEqual(['p1', 'p2'])
    expect(photosWithTag(PHOTOS, '')).toHaveLength(0)
  })

  it('latest 按发布时间倒序，时间相同时用 id 兜底保证全序', () => {
    const sameTime = [
      photo('b', 'u1', ['t'], { publishedAt: '2026-02-01T00:00:00.000Z' }),
      photo('a', 'u2', ['t'], { publishedAt: '2026-02-01T00:00:00.000Z' }),
    ]
    expect(sortTagPhotos(sameTime, 'latest').map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('popular 按赞＋收藏降序，同分再按发布时间倒序', () => {
    const order = sortTagPhotos(photosWithTag(PHOTOS, '城市'), 'popular')
    expect(order.map((item) => item.id)).toEqual(['p1', 'p3'])
  })
})
