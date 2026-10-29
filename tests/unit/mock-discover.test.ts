/**
 * Mock 发现仓储单测（src/data/mock/repositories/discover.ts，8.3c）。
 *
 * 策略同 mock-tags.test.ts：桩掉 db 模块用内存表顶替 IndexedDB。锁住
 * 「编辑精选」的授权口径（未登录 401 / 非 staff 403 / 不存在 404）与落库行为，
 * 以及三个只读聚合的口径（与 domain/discover.ts 同一份纯函数）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Photo, Profile } from '@/domain/types'

const h = vi.hoisted(() => {
  const stores = new Map<string, Map<string, unknown>>()
  const table = (name: string) => {
    let rows = stores.get(name)
    if (!rows) {
      rows = new Map()
      stores.set(name, rows)
    }
    return rows
  }
  const session = { value: null as { userId: string; role: string } | null }
  return {
    stores,
    table,
    session,
    db: {
      async getAll(name: string): Promise<unknown[]> {
        return [...table(name).values()]
      },
      async get(name: string, key: string): Promise<unknown> {
        return table(name).get(key) ?? undefined
      },
      async put(name: string, value: { id: string }): Promise<void> {
        table(name).set(value.id, value)
      },
    },
    reset() {
      stores.clear()
      session.value = null
    },
  }
})

vi.mock('@/data/mock/db', () => ({
  getDb: () => Promise.resolve(h.db),
  bumpDataVersion: () => Promise.resolve(0),
}))

vi.mock('@/data/mock/repositories/auth', () => ({
  mockAuthRepository: { getSession: () => Promise.resolve(h.session.value) },
}))

const { mockDiscoverRepository } = await import('@/data/mock/repositories/discover')
const { AppError, ErrorCodes } = await import('@/data/contracts')

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.now()

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
    credit: null,
    status: 'published',
    likeCount: 0,
    favoriteCount: 0,
    commentCount: 0,
    viewCount: 0,
    publishedAt: new Date(NOW - DAY).toISOString(),
    createdAt: new Date(NOW - DAY).toISOString(),
    updatedAt: new Date(NOW - DAY).toISOString(),
    deletedAt: null,
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
    createdAt: new Date(NOW - 5 * DAY).toISOString(),
    updatedAt: new Date(NOW - 5 * DAY).toISOString(),
    deletedAt: null,
    ...overrides,
  }
}

function seed() {
  for (const row of [
    photo('p1', { tags: ['夜景'], likeCount: 4 }),
    photo('p2', { tags: ['夜景'] }),
    photo('p3', { tags: ['夜景'] }),
  ]) {
    h.table('photos').set(row.id, row)
  }
  h.table('photos').set('featured', photo('featured', { featuredAt: '2026-10-01T00:00:00.000Z' }))
  for (const row of [profile('u1'), profile('u2', { role: 'editor' })]) {
    h.table('profiles').set(row.id, row)
  }
}

beforeEach(() => {
  h.reset()
})

describe('mockDiscoverRepository.hotSearches', () => {
  it('把作品标签聚合成热门词（mock 用标签近似搜索日志）', async () => {
    seed()
    await expect(mockDiscoverRepository.hotSearches({ days: 7, limit: 10 })).resolves.toEqual([
      { term: '夜景', searchCount: 3 },
    ])
  })

  it('没有足够重复时返回空数组（页面据此整块隐藏）', async () => {
    h.table('photos').set('x', photo('x', { tags: ['独一份'] }))
    await expect(mockDiscoverRepository.hotSearches()).resolves.toEqual([])
  })
})

describe('mockDiscoverRepository.newAuthors', () => {
  it('只返回有在架作品的新作者，并带上作品数与总获赞', async () => {
    seed()
    const authors = await mockDiscoverRepository.newAuthors({ days: 90, limit: 6 })
    expect(authors.map((item) => item.username)).toEqual(['u1'])
    expect(authors[0]).toMatchObject({ photoCount: 4, likeTotal: 4 })
  })
})

describe('mockDiscoverRepository.featured', () => {
  it('只返回 featuredAt 非空且在架的作品', async () => {
    seed()
    const page = await mockDiscoverRepository.featured()
    expect(page.items.map((item) => item.id)).toEqual(['featured'])
    expect(page.nextCursor).toBeNull()
  })

  it('游标翻页不重不漏', async () => {
    for (let i = 0; i < 5; i += 1) {
      const id = `f${i}`
      h.table('photos').set(id, photo(id, { featuredAt: `2026-10-0${i + 1}T00:00:00.000Z` }))
    }
    const first = await mockDiscoverRepository.featured(undefined, 2)
    expect(first.items.map((item) => item.id)).toEqual(['f4', 'f3'])
    const second = await mockDiscoverRepository.featured(first.nextCursor ?? undefined, 2)
    expect(second.items.map((item) => item.id)).toEqual(['f2', 'f1'])
  })
})

describe('mockDiscoverRepository.setEditorChoice', () => {
  it('游客被拒（UNAUTHORIZED）', async () => {
    seed()
    await expect(mockDiscoverRepository.setEditorChoice('p1', true)).rejects.toMatchObject({
      code: ErrorCodes.UNAUTHORIZED,
    })
  })

  it('普通用户被拒（FORBIDDEN），且不落库', async () => {
    seed()
    h.session.value = { userId: 'u1', role: 'user' }
    await expect(mockDiscoverRepository.setEditorChoice('p1', true)).rejects.toBeInstanceOf(AppError)
    expect((h.table('photos').get('p1') as Photo).featuredAt).toBeUndefined()
  })

  it('staff 设为精选取当前时间，取消精选置 null', async () => {
    seed()
    h.session.value = { userId: 'u2', role: 'editor' }
    const set = await mockDiscoverRepository.setEditorChoice('p1', true)
    expect(typeof set.featuredAt).toBe('string')
    expect(h.table('photos').get('p1')).toMatchObject({ featuredAt: set.featuredAt })
    const cleared = await mockDiscoverRepository.setEditorChoice('p1', false)
    expect(cleared.featuredAt).toBeNull()
    expect(h.table('photos').get('p1')).toMatchObject({ featuredAt: null })
  })

  it('作品不存在时 404，即使会话是 staff', async () => {
    seed()
    h.session.value = { userId: 'u2', role: 'admin' }
    await expect(mockDiscoverRepository.setEditorChoice('nope', true)).rejects.toMatchObject({
      code: ErrorCodes.NOT_FOUND,
    })
  })
})
