/**
 * Mock 仓储的「按 username 取列表」（src/data/mock/repositories/photos.ts、
 * src/data/mock/repositories/interactions.ts）。
 *
 * 为什么这两条要和 API 端点映射分开测：改接口最容易伤到的不是真实后端，而是 mock——
 * mock 是 E2E 和本地演示的数据源，一旦 authorUsername 过滤漏了大小写不敏感
 * （真实库是 citext），或者 listByUsername 忘了过滤草稿/撤回件，页面就会在两种模式下
 * 显示不同的东西，而这种偏差只有对着同一组断言跑两边才看得出来。
 *
 * 策略与 mock-social.test.ts 一致：**桩掉 db 模块**，用一个内存表顶替 IndexedDB
 * （项目不允许为单测新增依赖，而这一层要验的是编排：定位作者、过滤状态、游标翻页）。
 * 表结构（store → keyPath）与 src/data/mock/db.ts 的 MIGRATIONS 保持一致。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Interaction, Photo, Profile } from '@/domain/types'

type Row = Record<string, unknown>

const h = vi.hoisted(() => {
  /** store → (主键 JSON → 行) */
  const stores = new Map<string, Map<string, Row>>()
  const keyPaths: Record<string, string | string[]> = {
    profiles: 'id',
    photos: 'id',
    likes: ['userId', 'photoId'],
    favorites: ['userId', 'photoId'],
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
    async put(store: string, value: Row): Promise<string> {
      const key = keyOf(store, value)
      table(store).set(key, value)
      return key
    },
    async getAll(store: string): Promise<Row[]> {
      return [...table(store).values()]
    },
  }

  return {
    db,
    keyOf,
    seed(store: string, rows: readonly object[]) {
      for (const row of rows) {
        const record = row as Row
        table(store).set(keyOf(store, record), record)
      }
    },
    rows(store: string): Row[] {
      return [...table(store).values()]
    },
    reset() {
      stores.clear()
    },
  }
})

vi.mock('@/data/mock/db', () => ({
  getDb: () => Promise.resolve(h.db),
  bumpDataVersion: () => Promise.resolve(1),
}))

const { mockPhotoRepository } = await import('@/data/mock/repositories/photos')
const { mockInteractionRepository } = await import('@/data/mock/repositories/interactions')

// ===== 夹具 =====

function profile(id: string, username: string): Profile {
  return {
    id,
    username,
    displayName: username,
    avatarKey: null,
    bio: '',
    role: 'user',
    links: [],
    licensePreference: 'all_rights_reserved',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }
}

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

const interaction = (userId: string, photoId: string, createdAt: string): Interaction => ({
  userId,
  photoId,
  createdAt,
})

beforeEach(() => {
  h.reset()
  h.seed('profiles', [
    profile('u-alice', 'alice') as unknown as Row,
    profile('u-bob', 'bob') as unknown as Row,
  ])
  h.seed('photos', [
    photo('p-a1', 'u-alice', { publishedAt: '2026-02-03T00:00:00.000Z' }) as unknown as Row,
    photo('p-a2', 'u-alice', { publishedAt: '2026-02-01T00:00:00.000Z' }) as unknown as Row,
    photo('p-a-draft', 'u-alice', { status: 'draft', publishedAt: null }) as unknown as Row,
    photo('p-b1', 'u-bob', { publishedAt: '2026-02-02T00:00:00.000Z' }) as unknown as Row,
  ])
  h.seed('likes', [
    interaction('u-alice', 'p-b1', '2026-02-04T00:00:00.000Z') as unknown as Row,
    interaction('u-alice', 'p-a2', '2026-02-05T00:00:00.000Z') as unknown as Row,
    interaction('u-alice', 'p-a-draft', '2026-02-06T00:00:00.000Z') as unknown as Row,
    interaction('u-bob', 'p-a1', '2026-02-07T00:00:00.000Z') as unknown as Row,
  ])
  h.seed('favorites', [
    interaction('u-alice', 'p-a1', '2026-02-04T00:00:00.000Z') as unknown as Row,
  ])
})

// ===== 作品：作者过滤 =====

describe('mockPhotoRepository.list({ authorUsername })', () => {
  it('只返回该作者的已发布作品（草稿不出现）', async () => {
    const page = await mockPhotoRepository.list({ sort: 'latest', authorUsername: 'alice' })
    expect(page.items.map((p) => p.id)).toEqual(['p-a1', 'p-a2'])
  })

  it('用户名大小写不敏感（对应 Postgres 的 citext）', async () => {
    const page = await mockPhotoRepository.list({ sort: 'latest', authorUsername: 'ALICE' })
    expect(page.items.map((p) => p.id)).toEqual(['p-a1', 'p-a2'])
  })

  it('作者不存在时是空页而不是报错（主页已经处理了 404）', async () => {
    const page = await mockPhotoRepository.list({ sort: 'latest', authorUsername: 'ghost' })
    expect(page.items).toEqual([])
    expect(page.nextCursor).toBeNull()
  })

  it('不传 authorUsername 时保持原行为（作品墙仍然看得到所有已发布作品）', async () => {
    const page = await mockPhotoRepository.list({ sort: 'latest' })
    expect(page.items.map((p) => p.id)).toEqual(['p-a1', 'p-b1', 'p-a2'])
  })
})

// ===== 喜欢 / 收藏：按 username =====

describe('mockInteractionRepository.listByUsername', () => {
  it('likes 只给该用户点过赞的已发布作品，按发布时间倒序', async () => {
    const page = await mockInteractionRepository.listByUsername('alice', 'likes')
    // p-a-draft 虽然被赞过，但它是草稿；访客不该从「喜欢」里看到它
    expect(page.items.map((p) => p.id)).toEqual(['p-b1', 'p-a2'])
  })

  it('favorites 读的是另一张表', async () => {
    const page = await mockInteractionRepository.listByUsername('alice', 'favorites')
    expect(page.items.map((p) => p.id)).toEqual(['p-a1'])
  })

  it('用户不存在时是空页而不是抛错', async () => {
    const page = await mockInteractionRepository.listByUsername('ghost', 'likes')
    expect(page.items).toEqual([])
    expect(page.nextCursor).toBeNull()
  })

  it('limit + cursor 翻页不重不漏', async () => {
    const first = await mockInteractionRepository.listByUsername('alice', 'likes', undefined, 1)
    expect(first.items.map((p) => p.id)).toEqual(['p-b1'])
    expect(first.nextCursor).not.toBeNull()

    const second = await mockInteractionRepository.listByUsername('alice', 'likes', first.nextCursor ?? undefined, 1)
    expect(second.items.map((p) => p.id)).toEqual(['p-a2'])
    expect(second.nextCursor).toBeNull()
  })

  it('未知游标按首页处理（游标过期不该把翻页卡死）', async () => {
    const page = await mockInteractionRepository.listByUsername('alice', 'likes', 'not-a-cursor', 1)
    expect(page.items.map((p) => p.id)).toEqual(['p-b1'])
  })

  it('/me 仍在用「本人」接口：listLikesByUser / listFavoritesByUser 行为不变', async () => {
    await expect(mockInteractionRepository.listLikesByUser('u-alice')).resolves.toEqual([
      expect.objectContaining({ id: 'p-b1' }),
      expect.objectContaining({ id: 'p-a2' }),
    ])
    await expect(mockInteractionRepository.listFavoritesByUser('u-alice')).resolves.toEqual([
      expect.objectContaining({ id: 'p-a1' }),
    ])
  })
})
