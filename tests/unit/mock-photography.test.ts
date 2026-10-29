/**
 * Mock 摄影仓储单测（src/data/mock/repositories/{gear,places,seasons,profile}.ts，8.4a）。
 *
 * 策略同 mock-tags.test.ts：桩掉 db 模块，用内存表顶替 IndexedDB。
 * 要锁住的是「演示数据也要真算」以及和 api 实现同口径的细节：
 *   · 器材/地点聚合只算公开作品，且隐藏拍摄参数的作者不会在器材页把机型漏出来；
 *   · 地点遵守 location_precision（hidden 不入列表）；
 *   · 代表作：未登录 UNAUTHORIZED、最多 3 件、只能是自己已发布的作品、可清空；
 *   · 拍摄参数默认范围写进 profile 行。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Photo, Profile, Session } from '@/domain/types'
import { makePhoto, makeProfile } from './fixtures'

const h = vi.hoisted(() => {
  const photos = new Map<string, Photo>()
  const profiles = new Map<string, Profile>()
  const session: { value: Session | null } = { value: null }
  return {
    photos,
    profiles,
    session,
    reset() {
      photos.clear()
      profiles.clear()
      session.value = null
    },
    db: {
      async getAll(store: string): Promise<unknown[]> {
        if (store === 'photos') return [...photos.values()]
        if (store === 'profiles') return [...profiles.values()]
        return []
      },
      async get(store: string, key: string): Promise<unknown> {
        if (store === 'profiles') return profiles.get(key)
        return undefined
      },
      async put(store: string, value: unknown): Promise<void> {
        if (store === 'profiles') {
          const profile = value as Profile
          profiles.set(profile.id, profile)
        }
      },
    },
  }
})

vi.mock('@/data/mock/db', () => ({
  getDb: () => Promise.resolve(h.db),
  bumpDataVersion: () => Promise.resolve(0),
}))

vi.mock('@/data/mock/repositories/auth', () => ({
  mockAuthRepository: {
    getSession: () => Promise.resolve(h.session.value),
  },
}))

const { mockGearRepository } = await import('@/data/mock/repositories/gear')
const { mockPlaceRepository } = await import('@/data/mock/repositories/places')
const { mockSeasonRepository } = await import('@/data/mock/repositories/seasons')
const { mockProfileRepository } = await import('@/data/mock/repositories/profile')
const { AppError, ErrorCodes } = await import('@/data/contracts')

function photo(id: string, overrides: Partial<Photo> = {}): Photo {
  return makePhoto(id, {
    authorUsername: 'me',
    locationName: '杭州·西湖',
    exif: { Make: 'Canon', Model: 'EOS R5', LensModel: 'RF 24-70mm F2.8', ISO: 100 },
    ...overrides,
  })
}

function profile(overrides: Partial<Profile> = {}): Profile {
  return makeProfile(overrides)
}

function sessionFor(id: string): Session {
  return {
    userId: id,
    username: 'me',
    displayName: '我',
    avatarKey: null,
    role: 'user',
    expiresAt: '2099-01-01T00:00:00.000Z',
  }
}

beforeEach(() => {
  h.reset()
})

describe('mock 器材仓储', () => {
  it('机身与镜头各自聚合，只算公开作品', async () => {
    h.photos.set('p1', photo('p1'))
    h.photos.set('p2', photo('p2', { authorId: 'u2', publishedAt: '2026-04-01T00:00:00.000Z' }))
    h.photos.set('p3', photo('p3', { status: 'draft' }))

    const list = await mockGearRepository.list()
    expect(list.map((item) => [item.kind, item.label, item.photoCount, item.authorCount])).toEqual([
      ['body', 'Canon EOS R5', 2, 2],
      ['lens', 'RF 24-70mm F2.8', 2, 2],
    ])
  })

  it('作者隐藏拍摄参数时，机型与镜头都不出现在聚合里', async () => {
    h.photos.set('p1', photo('p1'))
    h.profiles.set('u1', profile({ exifVisibility: 'hidden' }))

    expect(await mockGearRepository.list()).toEqual([])
  })

  it('作品流按游标翻页，不重不漏，末页 nextCursor 为 null', async () => {
    for (let i = 0; i < 5; i++) {
      h.photos.set(`p${i}`, photo(`p${i}`, { publishedAt: `2026-03-0${i + 1}T00:00:00.000Z` }))
    }
    const first = await mockGearRepository.photos('body', 'Canon EOS R5', { limit: 2 })
    expect(first.items.map((item) => item.id)).toEqual(['p4', 'p3'])
    expect(first.nextCursor).not.toBeNull()

    const second = await mockGearRepository.photos('body', 'Canon EOS R5', {
      limit: 10,
      cursor: first.nextCursor,
    })
    expect(second.items.map((item) => item.id)).toEqual(['p2', 'p1', 'p0'])
    expect(second.nextCursor).toBeNull()
  })
})

describe('mock 地点仓储', () => {
  it('hidden 精度与空地点不入列表；地点作品流按标签过滤', async () => {
    h.photos.set('p1', photo('p1'))
    h.photos.set('p2', photo('p2', { locationPrecision: 'hidden' }))
    h.photos.set('p3', photo('p3', { locationName: '上海·外滩' }))

    const list = await mockPlaceRepository.list()
    // 作品数相同 → 同发布时间 → 按名称 localeCompare（中文按拼音，杭 < 上）
    expect(list.map((item) => [item.label, item.photoCount])).toEqual([
      ['杭州·西湖', 1],
      ['上海·外滩', 1],
    ])

    const page = await mockPlaceRepository.photos('杭州·西湖')
    expect(page.items.map((item) => item.id)).toEqual(['p1'])
  })
})

describe('mock 季节仓储', () => {
  it('四季都返回，按拍摄时间计数（缺拍摄时间退到发布时间）', async () => {
    h.photos.set('p1', photo('p1', { shotAt: '2026-04-02T00:00:00.000Z' }))
    h.photos.set('p2', photo('p2', { publishedAt: '2026-08-01T00:00:00.000Z' }))

    const list = await mockSeasonRepository.list()
    expect(list.map((item) => item.season)).toEqual(['spring', 'summer', 'autumn', 'winter'])
    expect(list.find((item) => item.season === 'spring')?.photoCount).toBe(1)
    expect(list.find((item) => item.season === 'summer')?.photoCount).toBe(1)
  })
})

describe('mock 资料侧设置', () => {
  it('未登录时两个设置都抛 UNAUTHORIZED', async () => {
    await expect(mockProfileRepository.setPinned(['p1'])).rejects.toBeInstanceOf(AppError)
    await expect(mockProfileRepository.setExifVisibility('hidden')).rejects.toMatchObject({
      code: ErrorCodes.UNAUTHORIZED,
    })
  })

  it('setExifVisibility 写进资料行', async () => {
    h.profiles.set('u1', profile())
    h.session.value = sessionFor('u1')

    await mockProfileRepository.setExifVisibility('hidden')
    expect(h.profiles.get('u1')?.exifVisibility).toBe('hidden')
  })

  it('setPinned 保存顺序并返回摘要；可清空', async () => {
    h.photos.set('p1', photo('p1', { title: '一号' }))
    h.photos.set('p2', photo('p2', { title: '二号' }))
    h.profiles.set('u1', profile())
    h.session.value = sessionFor('u1')

    const result = await mockProfileRepository.setPinned(['p2', 'p1'])
    expect(result.pinnedPhotoIds).toEqual(['p2', 'p1'])
    expect(result.pinned.map((item) => [item.id, item.title])).toEqual([
      ['p2', '二号'],
      ['p1', '一号'],
    ])
    expect(h.profiles.get('u1')?.pinnedPhotoIds).toEqual(['p2', 'p1'])

    const cleared = await mockProfileRepository.setPinned([])
    expect(cleared).toEqual({ pinnedPhotoIds: [], pinned: [] })
  })

  it('超过 3 件、别人的作品、已撤回的作品都抛 VALIDATION', async () => {
    h.photos.set('p1', photo('p1'))
    h.photos.set('p2', photo('p2'))
    h.photos.set('p3', photo('p3'))
    h.photos.set('p4', photo('p4'))
    h.photos.set('other', photo('other', { authorId: 'u2' }))
    h.photos.set('draft', photo('draft', { status: 'draft' }))
    h.photos.set('gone', photo('gone', { deletedAt: '2026-05-01T00:00:00.000Z' }))
    h.profiles.set('u1', profile())
    h.session.value = sessionFor('u1')

    await expect(mockProfileRepository.setPinned(['p1', 'p2', 'p3', 'p4'])).rejects.toMatchObject({
      code: ErrorCodes.VALIDATION,
    })
    await expect(mockProfileRepository.setPinned(['other'])).rejects.toMatchObject({
      code: ErrorCodes.VALIDATION,
    })
    await expect(mockProfileRepository.setPinned(['draft'])).rejects.toMatchObject({
      code: ErrorCodes.VALIDATION,
    })
    await expect(mockProfileRepository.setPinned(['gone'])).rejects.toMatchObject({
      code: ErrorCodes.VALIDATION,
    })
    // 失败不落库：资料行上的代表作仍是空
    expect(h.profiles.get('u1')?.pinnedPhotoIds).toBeUndefined()
  })
})
