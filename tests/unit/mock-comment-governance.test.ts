/**
 * Mock 评论仓储（8.4b）：排序 / 评论锁 / 删除授权。
 *
 * 这三件事都必须由数据层判定，而不是靠前端把输入框藏起来：
 *   · 排序：latest 与 oldest 是同一批数据的两种视图，游标含义跟着排序走；
 *   · 锁：关掉之后连作者自己提交也要 409，前端据此给出与锁定态一致的文案；
 *   · 删：评论作者或作品作者可删，其余人 FORBIDDEN，重复删幂等（不重复扣计数）。
 * 用内存 db 桩直接驱动仓储（同 tests/unit/moderation-mock-repository.test.ts）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Comment, Photo } from '@/domain/types'

type Row = Record<string, unknown> & { id: string }

const h = vi.hoisted(() => {
  const stores = new Map<string, Map<string, Row>>()

  function table(store: string): Map<string, Row> {
    let t = stores.get(store)
    if (!t) {
      t = new Map()
      stores.set(store, t)
    }
    return t
  }

  const db = {
    get: (store: string, key: string) => Promise.resolve(table(store).get(key)),
    put: (store: string, value: Row) => {
      table(store).set(value.id, value)
      return Promise.resolve(value.id)
    },
    delete: (store: string, key: string) => {
      table(store).delete(key)
      return Promise.resolve()
    },
    getAll: (store: string) => Promise.resolve([...table(store).values()]),
    getAllFromIndex: (store: string, index: string, value: unknown) =>
      Promise.resolve([...table(store).values()].filter((row) => row[index] === value)),
    count: (store: string) => Promise.resolve(table(store).size),
  }

  return {
    db,
    /** 当前会话；null = 游客 */
    session: { value: null as Record<string, unknown> | null },
    seed(store: string, rows: readonly unknown[]) {
      for (const row of rows) {
        const r = row as Row
        table(store).set(r.id, r)
      }
    },
    store(store: string): Map<string, Row> {
      return table(store)
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

const { mockCommentRepository: repo } = await import('@/data/mock/repositories/comments')
const { mockPhotoRepository: photos } = await import('@/data/mock/repositories/photos')
const { AppError, ErrorCodes } = await import('@/data/contracts')

function session(userId: string) {
  return { userId, username: userId, displayName: userId, avatarKey: null, role: 'user', expiresAt: '2026-03-10T00:00:00.000Z' }
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

function comment(id: string, overrides: Partial<Comment> = {}): Comment {
  return {
    id,
    photoId: 'p-1',
    authorId: 'u-commenter',
    parentId: null,
    body: '拍得真好',
    status: 'visible',
    createdAt: '2026-02-02T10:00:00.000Z',
    updatedAt: '2026-02-02T10:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

/** 三条评论，createdAt 递增：c-early < c-mid < c-late */
function seedThread() {
  h.seed('photos', [photo('p-1', 'u-author', { commentCount: 3 })])
  h.seed('comments', [
    comment('c-early', { createdAt: '2026-02-02T10:00:00.000Z' }),
    comment('c-mid', { createdAt: '2026-02-02T11:00:00.000Z' }),
    comment('c-late', { createdAt: '2026-02-02T12:00:00.000Z' }),
  ])
}

beforeEach(() => {
  h.reset()
})

describe('评论排序', () => {
  it('默认 latest：新→旧', async () => {
    seedThread()
    const page = await repo.list({ photoId: 'p-1' })
    expect(page.items.map((c) => c.id)).toEqual(['c-late', 'c-mid', 'c-early'])
    expect(page.total).toBe(3)
  })

  it('oldest：旧→新', async () => {
    seedThread()
    const page = await repo.list({ photoId: 'p-1', sort: 'oldest' })
    expect(page.items.map((c) => c.id)).toEqual(['c-early', 'c-mid', 'c-late'])
  })

  it('游标跟着排序走：latest 翻页不重复也不漏', async () => {
    seedThread()
    const first = await repo.list({ photoId: 'p-1', limit: 2 })
    expect(first.items.map((c) => c.id)).toEqual(['c-late', 'c-mid'])
    expect(first.nextCursor).toBeTypeOf('string')

    const second = await repo.list({ photoId: 'p-1', limit: 2, cursor: first.nextCursor! })
    expect(second.items.map((c) => c.id)).toEqual(['c-early'])
    expect(second.nextCursor).toBeNull()
  })

  it('同一毫秒的评论用 id 兜底，顺序稳定', async () => {
    h.seed('photos', [photo('p-1', 'u-author')])
    h.seed('comments', [
      comment('c-b', { createdAt: '2026-02-02T10:00:00.000Z' }),
      comment('c-a', { createdAt: '2026-02-02T10:00:00.000Z' }),
    ])
    const latest = await repo.list({ photoId: 'p-1' })
    const oldest = await repo.list({ photoId: 'p-1', sort: 'oldest' })
    expect(latest.items.map((c) => c.id)).toEqual(['c-b', 'c-a'])
    expect(oldest.items.map((c) => c.id)).toEqual(['c-a', 'c-b'])
  })
})

describe('评论锁', () => {
  it('作者关闭后被 null 会话的游客提交也要 409，且文案与页面锁定态一致', async () => {
    seedThread()
    h.seed('photos', [photo('p-1', 'u-author', { commentsLocked: true, commentCount: 3 })])

    const error = await repo.create({ photoId: 'p-1', authorId: 'u-commenter', parentId: null, body: '还能评论吗' })
      .catch((err: unknown) => err)

    expect(error).toBeInstanceOf(AppError)
    expect((error as InstanceType<typeof AppError>).code).toBe(ErrorCodes.CONFLICT)
    expect((error as Error).message).toBe('作者已关闭这件作品的评论')
    // 数据没变：评论没写入、计数没动
    expect(await h.db.get('comments', 'c-late')).toBeTruthy()
    expect(h.store('comments').size).toBe(3)
    expect((await h.db.get('photos', 'p-1'))?.commentCount).toBe(3)
  })

  it('未锁时正常发表并累加计数', async () => {
    seedThread()
    const created = await repo.create({ photoId: 'p-1', authorId: 'u-commenter', parentId: null, body: '好光' })
    expect(created.status).toBe('visible')
    expect((await h.db.get('photos', 'p-1'))?.commentCount).toBe(4)
  })

  it('作者可以开关，返回服务端实际状态并落库', async () => {
    seedThread()
    h.session.value = session('u-author')

    expect(await repo.setLocked('p-1', true)).toEqual({ photoId: 'p-1', commentsLocked: true })
    expect((await h.db.get('photos', 'p-1'))?.commentsLocked).toBe(true)

    expect(await repo.setLocked('p-1', false)).toEqual({ photoId: 'p-1', commentsLocked: false })
    expect((await h.db.get('photos', 'p-1'))?.commentsLocked).toBe(false)
  })

  it('非作者改锁：FORBIDDEN，且状态不动', async () => {
    seedThread()
    h.session.value = session('u-commenter')

    await expect(repo.setLocked('p-1', true)).rejects.toMatchObject({
      code: ErrorCodes.FORBIDDEN,
      message: '只有作品作者可以关闭评论',
    })
    expect((await h.db.get('photos', 'p-1'))?.commentsLocked).toBeUndefined()
  })

  it('游客改锁：UNAUTHORIZED', async () => {
    seedThread()
    await expect(repo.setLocked('p-1', true)).rejects.toMatchObject({ code: ErrorCodes.UNAUTHORIZED })
  })

  it('发布时带 commentsLocked 的作品，创建即锁定（发布页开关的落地路径）', async () => {
    const created = await photos.create(
      {
        authorId: 'u-author',
        title: '海边',
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
        width: 1,
        height: 1,
        blurhash: null,
        license: 'all_rights_reserved',
        credit: null,
        commentsLocked: true,
      },
      'p-new',
    )
    expect(created.commentsLocked).toBe(true)
    await expect(
      repo.create({ photoId: 'p-new', authorId: 'u-commenter', parentId: null, body: 'hi' }),
    ).rejects.toMatchObject({ code: ErrorCodes.CONFLICT })
  })
})

describe('删除评论授权', () => {
  it('评论作者能删自己的', async () => {
    seedThread()
    h.session.value = session('u-commenter')

    await repo.softRemove('c-mid')

    const row = await h.db.get('comments', 'c-mid')
    expect(row?.status).toBe('removed')
    expect(row?.deletedAt).toBeTruthy()
    expect((await h.db.get('photos', 'p-1'))?.commentCount).toBe(2)
  })

  it('作品作者能删别人在自己作品下的评论', async () => {
    seedThread()
    h.session.value = session('u-author')

    await repo.softRemove('c-late')
    expect((await h.db.get('comments', 'c-late'))?.status).toBe('removed')
  })

  it('路人删别人的：FORBIDDEN，内容不动', async () => {
    seedThread()
    h.session.value = session('u-stranger')

    await expect(repo.softRemove('c-late')).rejects.toMatchObject({
      code: ErrorCodes.FORBIDDEN,
      message: '只能删除自己的评论，或自己作品下的评论',
    })
    expect((await h.db.get('comments', 'c-late'))?.status).toBe('visible')
    expect((await h.db.get('photos', 'p-1'))?.commentCount).toBe(3)
  })

  it('游客删评论：UNAUTHORIZED', async () => {
    seedThread()
    await expect(repo.softRemove('c-late')).rejects.toMatchObject({ code: ErrorCodes.UNAUTHORIZED })
  })

  it('重复删幂等：不报错、不二次扣计数', async () => {
    seedThread()
    h.session.value = session('u-author')

    await repo.softRemove('c-late')
    await repo.softRemove('c-late')
    expect((await h.db.get('photos', 'p-1'))?.commentCount).toBe(2)
  })

  it('删不存在的评论：NOT_FOUND', async () => {
    seedThread()
    h.session.value = session('u-author')
    await expect(repo.softRemove('c-ghost')).rejects.toMatchObject({ code: ErrorCodes.NOT_FOUND })
  })
})
