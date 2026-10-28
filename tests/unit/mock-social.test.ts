/**
 * Mock 社交仓储单测（src/data/mock/repositories/social.ts）。
 *
 * 策略：**桩掉 db 模块**，用一个内存表顶替 IndexedDB。
 *
 * 为什么不是跑真的 IndexedDB：jsdom 与 Node 都没有 IDBFactory，而项目不允许为了
 * 单测新增依赖（fake-indexeddb）。但这一层要验的恰恰是「编排」——会话校验、
 * 幂等、写通知、剥离存储层字段、游标翻页——它们都不关心 key 到底存在哪里，
 * 所以一个 30 行的内存表就够。真正的 idb 路径由 E2E 覆盖。
 *
 * 表结构（store → keyPath）与 src/data/mock/db.ts 的 MIGRATIONS 保持一致：
 * 一旦那边改了主键而这里没改，本文件的失败就是最早的信号。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppNotification, Follow, Photo, Profile } from '@/domain/types'
import { SOCIAL_PAGE_SIZE } from '@/domain/social'

type Row = Record<string, unknown>

const h = vi.hoisted(() => {
  /** store → (主键 JSON → 行) */
  const stores = new Map<string, Map<string, Row>>()
  const keyPaths: Record<string, string | string[]> = {
    profiles: 'id',
    photos: 'id',
    notifications: 'id',
    follows: ['followerId', 'followingId'],
    blocks: ['blockerId', 'blockedId'],
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
    async delete(store: string, key: unknown): Promise<void> {
      table(store).delete(JSON.stringify(key))
    },
    async getAll(store: string): Promise<Row[]> {
      return [...table(store).values()]
    },
  }

  return {
    db,
    keyOf,
    /** 当前会话（null = 游客） */
    session: { value: null as { userId: string; username: string } | null },
    /** bumpDataVersion 调用次数（写操作应触发缓存失效） */
    bump: { count: 0 },
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
      h.session.value = null
      h.bump.count = 0
    },
  }
})

vi.mock('@/data/mock/db', () => ({
  getDb: () => Promise.resolve(h.db),
  bumpDataVersion: () => {
    h.bump.count += 1
    return Promise.resolve(h.bump.count)
  },
}))

vi.mock('@/data/mock/repositories/auth', () => ({
  mockAuthRepository: { getSession: () => Promise.resolve(h.session.value) },
}))

const { mockSocialRepository } = await import('@/data/mock/repositories/social')
const { AppError, ErrorCodes } = await import('@/data/contracts')

// ===== 夹具 =====

const NOW = '2026-02-10T12:00:00.000Z'

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

const followRow = (followerId: string, followingId: string, createdAt = NOW): Follow => ({
  followerId,
  followingId,
  createdAt,
})

function seedNotification(id: string, userId: string, overrides: Partial<AppNotification> = {}): Row {
  return {
    id,
    userId,
    kind: 'like',
    actor: null,
    photoId: 'p-a1',
    commentId: null,
    readAt: null,
    createdAt: NOW,
    ...overrides,
  } as Row
}

beforeEach(() => {
  h.reset()
  h.seed('profiles', [
    profile('u-me', 'me') as unknown as Row,
    profile('u-alice', 'alice') as unknown as Row,
    profile('u-bob', 'bob') as unknown as Row,
  ])
  h.seed('photos', [
    photo('p-a1', 'u-alice') as unknown as Row,
    photo('p-b1', 'u-bob') as unknown as Row,
    photo('p-me1', 'u-me') as unknown as Row,
    photo('p-a-draft', 'u-alice', { status: 'draft', publishedAt: null }) as unknown as Row,
  ])
  h.session.value = { userId: 'u-me', username: 'me' }
})

// ===== 关注 =====

describe('mockSocialRepository.follow', () => {
  it('未登录抛 UNAUTHORIZED', async () => {
    h.session.value = null
    await expect(mockSocialRepository.follow('alice')).rejects.toMatchObject({
      code: ErrorCodes.UNAUTHORIZED,
    })
  })

  it('关注自己抛 VALIDATION（并在写库前就拦下）', async () => {
    await expect(mockSocialRepository.follow('me')).rejects.toMatchObject({ code: ErrorCodes.VALIDATION })
    expect(h.rows('follows')).toHaveLength(0)
  })

  it('用户不存在抛 NOT_FOUND', async () => {
    await expect(mockSocialRepository.follow('ghost')).rejects.toMatchObject({ code: ErrorCodes.NOT_FOUND })
  })

  it('成功写入关注关系，并给被关注者留一条通知', async () => {
    await mockSocialRepository.follow('alice')
    const rows = h.rows('follows')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ followerId: 'u-me', followingId: 'u-alice' })

    const notifications = h.rows('notifications')
    expect(notifications).toHaveLength(1)
    // 通知属于**被关注者**，actor 是关注者自己
    expect(notifications[0]).toMatchObject({ userId: 'u-alice', kind: 'follow', photoId: null, readAt: null })
    expect((notifications[0]?.actor as Profile).id).toBe('u-me')
    expect(h.bump.count).toBe(1)
  })

  it('重复关注是幂等的：不重复写行、不重复计数、不刷第二条通知', async () => {
    await mockSocialRepository.follow('alice')
    await mockSocialRepository.follow('alice')
    expect(h.rows('follows')).toHaveLength(1)
    expect(h.rows('notifications')).toHaveLength(1)
    expect(h.bump.count).toBe(1)
  })

  it('用户名大小写不敏感（对应 Postgres 的 citext）', async () => {
    await mockSocialRepository.follow('ALICE')
    await expect(mockSocialRepository.isFollowing('alice')).resolves.toBe(true)
  })
})

describe('mockSocialRepository.unfollow', () => {
  it('取关删除关注行，但保留历史通知', async () => {
    await mockSocialRepository.follow('alice')
    await mockSocialRepository.unfollow('alice')
    expect(h.rows('follows')).toHaveLength(0)
    // 「某人关注过你」是历史事实，取关不该把通知抹掉
    expect(h.rows('notifications')).toHaveLength(1)
  })

  it('没关注过就取关不报错（幂等），也不写库', async () => {
    await expect(mockSocialRepository.unfollow('alice')).resolves.toBeUndefined()
    expect(h.rows('follows')).toHaveLength(0)
    expect(h.bump.count).toBe(0)
  })
})

describe('mockSocialRepository.isFollowing', () => {
  it('未登录返回 false 而不是抛错（游客态按钮要能渲染）', async () => {
    h.session.value = null
    await expect(mockSocialRepository.isFollowing('alice')).resolves.toBe(false)
  })

  it('用户不存在返回 false', async () => {
    await expect(mockSocialRepository.isFollowing('ghost')).resolves.toBe(false)
  })

  it('跟随关注/取关变化', async () => {
    await expect(mockSocialRepository.isFollowing('alice')).resolves.toBe(false)
    await mockSocialRepository.follow('alice')
    await expect(mockSocialRepository.isFollowing('alice')).resolves.toBe(true)
  })
})

// ===== 计数与列表 =====

describe('mockSocialRepository.counts / listFollowers / listFollowing', () => {
  beforeEach(() => {
    h.seed('follows', [
      followRow('u-bob', 'u-alice', '2026-02-01T00:00:00.000Z'),
      followRow('u-me', 'u-alice', '2026-02-02T00:00:00.000Z'),
      followRow('u-alice', 'u-me', '2026-02-03T00:00:00.000Z'),
      followRow('u-alice', 'u-bob', '2026-02-04T00:00:00.000Z'),
    ])
  })

  it('粉丝 / 关注数分别统计', async () => {
    await expect(mockSocialRepository.counts('alice')).resolves.toEqual({ followers: 2, following: 2 })
    await expect(mockSocialRepository.counts('bob')).resolves.toEqual({ followers: 1, following: 1 })
  })

  it('用户不存在时计数抛 NOT_FOUND（页面据此显示错误态）', async () => {
    await expect(mockSocialRepository.counts('ghost')).rejects.toBeInstanceOf(AppError)
  })

  it('粉丝列表按关注时间倒序，最近关注的排前面', async () => {
    const page = await mockSocialRepository.listFollowers('alice')
    expect(page.items.map((p) => p.username)).toEqual(['me', 'bob'])
    expect(page.nextCursor).toBeNull()
  })

  it('关注列表同理', async () => {
    const page = await mockSocialRepository.listFollowing('alice')
    expect(page.items.map((p) => p.username)).toEqual(['bob', 'me'])
  })

  it('超过一页时给出 nextCursor，且两页拼起来不重不漏', async () => {
    const many = Array.from({ length: SOCIAL_PAGE_SIZE + 3 }, (_, index) => {
      const id = `u-${index}`
      h.seed('profiles', [profile(id, `user${index}`) as unknown as Row])
      return followRow(id, 'u-alice', `2026-02-${String((index % 27) + 1).padStart(2, '0')}T00:00:00.000Z`)
    })
    h.seed('follows', many)

    const first = await mockSocialRepository.listFollowers('alice')
    expect(first.items).toHaveLength(SOCIAL_PAGE_SIZE)
    expect(first.nextCursor).not.toBeNull()

    const second = await mockSocialRepository.listFollowers('alice', first.nextCursor ?? undefined)
    expect(second.items).toHaveLength(5) // 2 条原数据 + 27 条新数据 − 24
    expect(second.nextCursor).toBeNull()

    const ids = [...first.items, ...second.items].map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// ===== 关注动态 =====

describe('mockSocialRepository.feed', () => {
  it('未登录抛 UNAUTHORIZED（动态流是「我的」视图）', async () => {
    h.session.value = null
    await expect(mockSocialRepository.feed()).rejects.toMatchObject({ code: ErrorCodes.UNAUTHORIZED })
  })

  it('只给我关注的人的作品，且不含草稿、不含我自己的作品', async () => {
    h.seed('follows', [followRow('u-me', 'u-alice')])
    const page = await mockSocialRepository.feed()
    expect(page.items.map((p) => p.id)).toEqual(['p-a1'])
  })

  it('没关注任何人时是空页，而不是报错', async () => {
    const page = await mockSocialRepository.feed()
    expect(page.items).toEqual([])
    expect(page.nextCursor).toBeNull()
  })
})

// ===== 通知 =====

describe('mockSocialRepository 通知', () => {
  beforeEach(() => {
    h.seed('notifications', [
      seedNotification('n-1', 'u-me', { createdAt: '2026-02-03T00:00:00.000Z' }),
      seedNotification('n-2', 'u-me', { createdAt: '2026-02-02T00:00:00.000Z', readAt: '2026-02-05T00:00:00.000Z' }),
      seedNotification('n-3', 'u-me', { createdAt: '2026-02-01T00:00:00.000Z' }),
      seedNotification('n-other', 'u-bob', { createdAt: '2026-02-04T00:00:00.000Z' }),
    ])
  })

  it('只返回我的通知，按时间倒序，并剥掉存储层的 userId', async () => {
    const page = await mockSocialRepository.notifications()
    expect(page.items.map((n) => n.id)).toEqual(['n-1', 'n-2', 'n-3'])
    expect(Object.keys(page.items[0] ?? {})).not.toContain('userId')
  })

  it('未登录抛 UNAUTHORIZED', async () => {
    h.session.value = null
    await expect(mockSocialRepository.notifications()).rejects.toMatchObject({ code: ErrorCodes.UNAUTHORIZED })
  })

  it('unreadCount 只数我的未读', async () => {
    await expect(mockSocialRepository.unreadCount()).resolves.toBe(2)
  })

  it('markRead(ids) 只动指定且未读的那些', async () => {
    await mockSocialRepository.markRead(['n-1', 'n-2', 'n-other'])
    const mine = h.rows('notifications').filter((n) => n.userId === 'u-me')
    expect(mine.find((n) => n.id === 'n-1')?.readAt).toBeTruthy()
    expect(mine.find((n) => n.id === 'n-2')?.readAt).toBe('2026-02-05T00:00:00.000Z') // 已读时间不被覆盖
    expect(mine.find((n) => n.id === 'n-3')?.readAt).toBeNull()
    // 别人的通知一行都不许改
    expect(h.rows('notifications').find((n) => n.id === 'n-other')?.readAt).toBeNull()
    expect(h.bump.count).toBe(1)
  })

  it('markRead(undefined) 把我的未读全部标为已读', async () => {
    await mockSocialRepository.markRead(undefined)
    await expect(mockSocialRepository.unreadCount()).resolves.toBe(0)
  })

  it('没有可标记的行时不 bump dataVersion（避免无意义的缓存失效）', async () => {
    await mockSocialRepository.markRead(['n-2'])
    expect(h.bump.count).toBe(0)
  })
})
