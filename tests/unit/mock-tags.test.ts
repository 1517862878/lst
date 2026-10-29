/**
 * Mock 标签仓储单测（src/data/mock/repositories/tags.ts）。
 *
 * 与 mock-social.test.ts 同一策略：桩掉 db 模块，用内存表顶替 IndexedDB
 * （jsdom 没有 IDBFactory，项目又不允许为单测新增依赖）。
 *
 * 这里要锁住的是 mock 与 api 必须一致的**契约细节**：
 *   · 只统计已发布、未删除的作品；
 *   · 排序稳定（热门按作品数，latest 按发布时间，最后都落到 tag 字典序）；
 *   · 游标翻页不重不漏，最后一页 nextCursor 为 null；
 *   · 非法标签抛 VALIDATION，空前缀 suggest 直接返回空数组（不打库）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Photo } from '@/domain/types'

const h = vi.hoisted(() => {
  const photos = new Map<string, Photo>()
  return {
    photos,
    reset() {
      photos.clear()
    },
    db: {
      async getAll(store: string): Promise<Photo[]> {
        if (store !== 'photos') return []
        return [...photos.values()]
      },
    },
  }
})

vi.mock('@/data/mock/db', () => ({
  getDb: () => Promise.resolve(h.db),
  bumpDataVersion: () => Promise.resolve(0),
}))

const { mockTagRepository } = await import('@/data/mock/repositories/tags')
const { AppError, ErrorCodes } = await import('@/data/contracts')

function photo(
  id: string,
  authorId: string,
  tags: string[],
  overrides: Partial<Photo> = {},
): Photo {
  return {
    id,
    authorId,
    title: id,
    description: '',
    categorySlug: 'landscape',
    tags,
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
    commentCount: 0,
    favoriteCount: 0,
    viewCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    publishedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    credit: null,
    ...overrides,
  }
}

function seed(rows: Photo[]) {
  for (const row of rows) h.photos.set(row.id, row)
}

beforeEach(() => {
  h.reset()
})

describe('mockTagRepository.list', () => {
  it('只统计已发布且未删除的作品，按热门（作品数）降序', async () => {
    seed([
      photo('p1', 'u1', ['夜景', '城市']),
      photo('p2', 'u2', ['夜景', '长曝光']),
      photo('p3', 'u1', ['城市']),
      photo('p4', 'u3', ['夜景'], { status: 'draft' }),
      photo('p5', 'u4', ['城市'], { deletedAt: '2026-02-01T00:00:00.000Z' }),
    ])

    // 作品数相同时按「最近发布」比，再按 tag 字典序（中文按 UTF-16 码位，城市 < 夜景）
    const tags = await mockTagRepository.list({ sort: 'hot' })
    expect(tags.map((item) => item.tag)).toEqual(['城市', '夜景', '长曝光'])
    const byTag = new Map(tags.map((item) => [item.tag, item]))
    expect(byTag.get('夜景')).toMatchObject({ photoCount: 2, authorCount: 2 })
    expect(byTag.get('城市')).toMatchObject({ photoCount: 2, authorCount: 1 })
  })

  it('prefix 过滤大小写不敏感，limit 生效且不改变排序口径', async () => {
    seed([
      photo('p1', 'u1', ['Landscape', 'landscape night', 'street']),
      photo('p2', 'u2', ['Landscape']),
    ])

    const filtered = await mockTagRepository.list({ sort: 'hot', prefix: 'LANDS' })
    expect(filtered.map((item) => item.tag).sort()).toEqual(['Landscape', 'landscape night'])

    const limited = await mockTagRepository.list({ sort: 'latest', limit: 1 })
    expect(limited).toHaveLength(1)
  })

  it('latest 排序把最近发布的标签排前面', async () => {
    seed([
      photo('p1', 'u1', ['旧标签'], { publishedAt: '2025-01-01T00:00:00.000Z' }),
      photo('p2', 'u2', ['新标签'], { publishedAt: '2026-05-01T00:00:00.000Z' }),
    ])
    const tags = await mockTagRepository.list({ sort: 'latest' })
    expect(tags.map((item) => item.tag)).toEqual(['新标签', '旧标签'])
  })
})

describe('mockTagRepository.get', () => {
  it('返回计数与共现相关标签，标签原文按作品里写的那个', async () => {
    seed([
      photo('p1', 'u1', ['Landscape', '夜景']),
      photo('p2', 'u2', ['landscape', '城市']),
    ])
    const detail = await mockTagRepository.get('Landscape')
    expect(detail).toMatchObject({ tag: 'Landscape', photoCount: 2, authorCount: 2 })
    // 共现次数相同 → 按 tag 字典序（城市 < 夜景）
    expect(detail.relatedTags.map((item) => item.tag)).toEqual(['城市', '夜景'])
  })

  it('未知标签返回 0 计数而不是 404', async () => {
    const detail = await mockTagRepository.get('不存在的标签')
    expect(detail).toMatchObject({ photoCount: 0, authorCount: 0, relatedTags: [] })
  })

  it('空标签抛 VALIDATION', async () => {
    await expect(mockTagRepository.get('   ')).rejects.toBeInstanceOf(AppError)
    await expect(mockTagRepository.get('')).rejects.toMatchObject({
      code: ErrorCodes.VALIDATION,
    })
  })
})

describe('mockTagRepository.photos', () => {
  const many = (count: number, tags: string[]) =>
    Array.from({ length: count }, (_, index) =>
      photo(`p${String(index).padStart(2, '0')}`, 'u1', tags, {
        publishedAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
        likeCount: index,
      }),
    )

  it('游标翻页不重不漏，最后一页 nextCursor 为 null', async () => {
    seed(many(5, ['夜景']))
    const first = await mockTagRepository.photos('夜景', { sort: 'latest', limit: 2 })
    expect(first.items).toHaveLength(2)
    const firstCursor = first.nextCursor
    expect(firstCursor).not.toBeNull()
    if (!firstCursor) throw new Error('第一页应有游标')

    const second = await mockTagRepository.photos('夜景', {
      sort: 'latest',
      limit: 2,
      cursor: firstCursor,
    })
    const secondCursor = second.nextCursor
    if (!secondCursor) throw new Error('第二页应有游标')

    const third = await mockTagRepository.photos('夜景', {
      sort: 'latest',
      limit: 2,
      cursor: secondCursor,
    })

    const ids = [...first.items, ...second.items, ...third.items].map((item) => item.id)
    expect(new Set(ids).size).toBe(5)
    expect(third.nextCursor).toBeNull()
  })

  it('popular 按点赞降序，latest 按发布时间降序', async () => {
    seed(many(3, ['夜景']))
    const popular = await mockTagRepository.photos('夜景', { sort: 'popular', limit: 3 })
    expect(popular.items.map((item) => item.likeCount)).toEqual([2, 1, 0])

    const latest = await mockTagRepository.photos('夜景', { sort: 'latest', limit: 3 })
    expect(latest.items.map((item) => item.id)).toEqual(['p02', 'p01', 'p00'])
  })

  it('不带该标签的作品不会混进来', async () => {
    seed([photo('p1', 'u1', ['夜景']), photo('p2', 'u1', ['城市'])])
    const page = await mockTagRepository.photos('夜景', { sort: 'latest' })
    expect(page.items.map((item) => item.id)).toEqual(['p1'])
  })
})

describe('mockTagRepository.suggest', () => {
  it('空前缀返回空数组', async () => {
    seed([photo('p1', 'u1', ['夜景'])])
    expect(await mockTagRepository.suggest('   ')).toEqual([])
  })

  it('前缀匹配并按作品数排序，limit 生效', async () => {
    seed([
      photo('p1', 'u1', ['长曝光', '夜景']),
      photo('p2', 'u2', ['长曝光']),
      photo('p3', 'u3', ['街拍']),
    ])
    const items = await mockTagRepository.suggest('长', { limit: 5 })
    expect(items).toEqual([{ tag: '长曝光', photoCount: 2 }])

    const all = await mockTagRepository.suggest('夜')
    expect(all.map((item) => item.tag)).toEqual(['夜景'])
  })
})
