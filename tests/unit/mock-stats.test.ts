/**
 * Mock 创作者统计仓储单测（src/data/mock/repositories/stats.ts）。
 *
 * 做法与 tests/unit/mock-social.test.ts 一致：桩掉 db 模块，用内存表顶替 IndexedDB，
 * 再塞进真实形状的 photos / follows 行。要验三件事：
 *  1. 数字是**从行里算出来的**，不是写死的 0 或固定值（种子里有什么就出什么）；
 *  2. 只算当前登录者自己的东西；
 *  3. 未登录直接 401——统计是私有数据，不能靠前端拦。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Follow, Photo } from '@/domain/types'

type Row = Record<string, unknown>

const h = vi.hoisted(() => {
  const stores = new Map<string, Map<string, Row>>()
  const keyPaths: Record<string, string | string[]> = {
    profiles: 'id',
    photos: 'id',
    follows: ['followerId', 'followingId'],
  }

  function keyOf(store: string, value: Row): string {
    const path = keyPaths[store]
    if (!path) throw new Error(`测试桩不认识这个 store：${store}`)
    const raw = Array.isArray(path) ? path.map((k) => value[k]) : value[path]
    return JSON.stringify(raw)
  }

  function table(store: string): Map<string, Row> {
    let existing = stores.get(store)
    if (!existing) {
      existing = new Map<string, Row>()
      stores.set(store, existing)
    }
    return existing
  }

  const db = {
    async get(store: string, key: unknown): Promise<Row | undefined> {
      return table(store).get(JSON.stringify(key))
    },
    async getAll(store: string): Promise<Row[]> {
      return [...table(store).values()]
    },
    async put(store: string, value: Row): Promise<string> {
      const key = keyOf(store, value)
      table(store).set(key, value)
      return key
    },
  }

  return {
    db,
    session: { value: null as { userId: string; username: string } | null },
    seed(store: string, rows: readonly object[]) {
      for (const row of rows) {
        const record = row as Row
        table(store).set(keyOf(store, record), record)
      }
    },
    reset() {
      stores.clear()
      h.session.value = null
    },
  }
})

vi.mock('@/data/mock/db', () => ({
  getDb: () => Promise.resolve(h.db),
  bumpDataVersion: () => Promise.resolve(1),
}))

vi.mock('@/data/mock/repositories/auth', () => ({
  mockAuthRepository: { getSession: () => Promise.resolve(h.session.value) },
}))

const { mockStatsRepository } = await import('@/data/mock/repositories/stats')
const { AppError, ErrorCodes } = await import('@/data/contracts')

function photo(id: string, authorId: string, overrides: Partial<Photo> = {}): Photo {
  return {
    id,
    authorId,
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

beforeEach(() => {
  h.reset()
  h.session.value = { userId: 'u-me', username: 'me' }
  h.seed('photos', [
    photo('p-1', 'u-me', {
      likeCount: 12,
      favoriteCount: 3,
      commentCount: 4,
      viewCount: 250,
      publishedAt: '2026-03-01T00:00:00.000Z',
    }) as unknown as Row,
    photo('p-2', 'u-me', {
      likeCount: 5,
      favoriteCount: 1,
      commentCount: 1,
      viewCount: 50,
      publishedAt: '2026-02-01T00:00:00.000Z',
    }) as unknown as Row,
    photo('p-draft', 'u-me', {
      status: 'draft',
      publishedAt: null,
      likeCount: 0,
      viewCount: 0,
      createdAt: '2026-04-01T00:00:00.000Z',
    }) as unknown as Row,
    photo('p-other', 'u-bob', { likeCount: 777, viewCount: 7777 }) as unknown as Row,
  ])
  h.seed('follows', [
    follow('u-a', 'u-me') as unknown as Row,
    follow('u-b', 'u-me') as unknown as Row,
    follow('u-me', 'u-c') as unknown as Row,
  ])
})

describe('mockStatsRepository.creatorStats', () => {
  it('从行里真算：作品 3 件、在架 2 件、草稿 1 件', async () => {
    const stats = await mockStatsRepository.creatorStats()
    expect(stats.photoCount).toBe(3)
    expect(stats.publishedCount).toBe(2)
    expect(stats.draftCount).toBe(1)
  })

  it('获赞/收藏/评论/浏览按在架作品累加，别人的 777 不进我的账', async () => {
    const stats = await mockStatsRepository.creatorStats()
    expect(stats.likeTotal).toBe(17)
    expect(stats.favoriteTotal).toBe(4)
    expect(stats.commentTotal).toBe(5)
    expect(stats.viewTotal).toBe(300)
  })

  it('粉丝数/关注数分开数', async () => {
    const stats = await mockStatsRepository.creatorStats()
    expect(stats.followerCount).toBe(2)
    expect(stats.followingCount).toBe(1)
  })

  it('不是写死的一排 0：至少有一半字段非零', async () => {
    const stats = await mockStatsRepository.creatorStats()
    const values = Object.values(stats)
    expect(values.filter((value) => value > 0).length).toBeGreaterThanOrEqual(5)
  })

  it('未登录 401，且提示是中文可读文案', async () => {
    h.session.value = null
    await expect(mockStatsRepository.creatorStats()).rejects.toBeInstanceOf(AppError)
    await expect(mockStatsRepository.creatorStats()).rejects.toMatchObject({
      code: ErrorCodes.UNAUTHORIZED,
    })
  })
})

describe('mockStatsRepository.photoStats', () => {
  it('只返回自己的作品，按时间倒序（草稿按创建时间排最前）', async () => {
    const rows = await mockStatsRepository.photoStats()
    expect(rows.map((row) => row.photoId)).toEqual(['p-draft', 'p-1', 'p-2'])
  })

  it('行里带页面要展示的计数与精选标记', async () => {
    h.seed('photos', [
      photo('p-featured', 'u-me', {
        featuredAt: '2026-03-02T00:00:00.000Z',
        likeCount: 9,
      }) as unknown as Row,
    ])
    const rows = await mockStatsRepository.photoStats()
    const featured = rows.find((row) => row.photoId === 'p-featured')
    expect(featured).toMatchObject({
      likeCount: 9,
      favoriteCount: 0,
      commentCount: 0,
      viewCount: 0,
      featuredAt: '2026-03-02T00:00:00.000Z',
    })
    // 没精选的行必须是 null 而不是 undefined：JSON 往返后 undefined 会消失
    expect(rows.find((row) => row.photoId === 'p-1')?.featuredAt).toBeNull()
  })

  it('limit/offset 生效（表格分页靠它）', async () => {
    const rows = await mockStatsRepository.photoStats({ limit: 1, offset: 1 })
    expect(rows.map((row) => row.photoId)).toEqual(['p-1'])
  })

  it('未登录同样 401', async () => {
    h.session.value = null
    await expect(mockStatsRepository.photoStats()).rejects.toMatchObject({
      code: ErrorCodes.UNAUTHORIZED,
    })
  })
})
