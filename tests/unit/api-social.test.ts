/**
 * API 社交仓储单测（src/data/api/social.ts）。
 *
 * 这里只桩掉最外层两件事：http 客户端（request）与当前会话（apiAuthRepository.getSession）。
 * 中间那一层「端点拼装 / 游标透传 / counts 与 isFollowing 的推导」是本文件要锁住的契约——
 * 冻结的端点清单里没有这两个方法的专用端点，一旦后端改形状，第一个红的应该是这里。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppNotification, Photo, Profile, Session } from '@/domain/types'

vi.mock('@/data/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/api/client')>()
  return { ...actual, request: vi.fn() }
})

vi.mock('@/data/api/auth', () => ({
  apiAuthRepository: { getSession: vi.fn() },
}))

const { request } = await import('@/data/api/client')
const { apiAuthRepository } = await import('@/data/api/auth')
const { apiSocialRepository } = await import('@/data/api/social')

const requestMock = vi.mocked(request)
const getSessionMock = vi.mocked(apiAuthRepository.getSession)

const session: Session = {
  userId: 'u-me',
  username: 'me',
  displayName: '我',
  avatarKey: null,
  role: 'user',
  expiresAt: '2099-01-01T00:00:00.000Z',
}

const profile = (id: string, username: string): Profile =>
  ({
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
  }) satisfies Profile

const photo = (id: string): Photo =>
  ({
    id,
    authorId: 'u-a',
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
  }) satisfies Photo

const notice = (id: string): AppNotification => ({
  id,
  kind: 'like',
  actor: null,
  photoId: 'p1',
  commentId: null,
  readAt: null,
  createdAt: '2026-02-01T00:00:00.000Z',
})

beforeEach(() => {
  requestMock.mockReset()
  getSessionMock.mockReset()
  getSessionMock.mockResolvedValue(session)
})

describe('apiSocialRepository 端点映射', () => {
  it('follow 用 PUT，unfollow 用 DELETE，同一个端点', async () => {
    requestMock.mockResolvedValue(undefined)
    await apiSocialRepository.follow('bob')
    expect(requestMock).toHaveBeenCalledWith('/api/profiles/bob/follow', { method: 'PUT' })

    requestMock.mockClear()
    await apiSocialRepository.unfollow('bob')
    expect(requestMock).toHaveBeenCalledWith('/api/profiles/bob/follow', { method: 'DELETE' })
  })

  it('用户名做 URL 编码（用户名允许中文与特殊字符）', async () => {
    requestMock.mockResolvedValue({ items: [], nextCursor: null })
    await apiSocialRepository.listFollowers('林 同学')
    expect(requestMock.mock.calls[0]?.[0]).toBe('/api/profiles/%E6%9E%97%20%E5%90%8C%E5%AD%A6/followers')
  })

  it('游标透传：首页不带 cursor，翻页带上一页返回的 cursor', async () => {
    requestMock.mockResolvedValue({ items: [], nextCursor: null })
    await apiSocialRepository.listFollowers('bob')
    expect(requestMock.mock.calls[0]?.[0]).toBe('/api/profiles/bob/followers')

    requestMock.mockClear()
    await apiSocialRepository.listFollowing('bob', 'CURSOR-1')
    expect(requestMock.mock.calls[0]?.[0]).toBe('/api/profiles/bob/following?cursor=CURSOR-1')
  })

  it('feed / notifications 只做形状归一（items + nextCursor），不额外包装', async () => {
    requestMock.mockResolvedValueOnce({ items: [photo('p1')], nextCursor: 'C1' })
    await expect(apiSocialRepository.feed()).resolves.toEqual({ items: [photo('p1')], nextCursor: 'C1' })
    expect(requestMock.mock.calls[0]?.[0]).toBe('/api/feed')

    requestMock.mockResolvedValueOnce({ items: [notice('n1')], nextCursor: null })
    await expect(apiSocialRepository.notifications('C9')).resolves.toEqual({
      items: [notice('n1')],
      nextCursor: null,
    })
    expect(requestMock.mock.calls[1]?.[0]).toBe('/api/me/notifications?cursor=C9')
  })

  it('unreadCount 同时接受裸数字与 { count }', async () => {
    requestMock.mockResolvedValueOnce(7)
    await expect(apiSocialRepository.unreadCount()).resolves.toBe(7)

    requestMock.mockResolvedValueOnce({ count: 3 })
    await expect(apiSocialRepository.unreadCount()).resolves.toBe(3)
    expect(requestMock.mock.calls[0]?.[0]).toBe('/api/me/notifications/unread-count')
  })

  it('markRead 传 ids 时带 ids；不传（或空数组）时发空对象 = 全部已读', async () => {
    requestMock.mockResolvedValue(undefined)
    await apiSocialRepository.markRead(['n1', 'n2'])
    expect(requestMock).toHaveBeenCalledWith('/api/me/notifications/read', {
      method: 'POST',
      body: { ids: ['n1', 'n2'] },
    })

    requestMock.mockClear()
    await apiSocialRepository.markRead()
    expect(requestMock).toHaveBeenCalledWith('/api/me/notifications/read', { method: 'POST', body: {} })

    requestMock.mockClear()
    await apiSocialRepository.markRead([])
    expect(requestMock).toHaveBeenCalledWith('/api/me/notifications/read', { method: 'POST', body: {} })
  })
})

describe('apiSocialRepository 推导方法', () => {
  it('counts 优先用服务端 total', async () => {
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith('/followers')
          ? { items: [profile('u1', 'a')], nextCursor: null, total: 12 }
          : { items: [profile('u2', 'b')], nextCursor: null, total: 3 },
      ),
    )
    await expect(apiSocialRepository.counts('bob')).resolves.toEqual({ followers: 12, following: 3 })
  })

  it('服务端没给 total 时用本页条数（下界估计，不编造精确值）', async () => {
    requestMock.mockResolvedValue({ items: [profile('u1', 'a')], nextCursor: 'C1' })
    await expect(apiSocialRepository.counts('bob')).resolves.toEqual({ followers: 1, following: 1 })
  })

  it('isFollowing：在「我的关注」里按用户名大小写不敏感查找', async () => {
    requestMock.mockResolvedValue({ items: [profile('u1', 'Alice')], nextCursor: null })
    await expect(apiSocialRepository.isFollowing('alice')).resolves.toBe(true)
    expect(requestMock.mock.calls[0]?.[0]).toBe('/api/profiles/me/following')
  })

  it('isFollowing：没找到且没有下一页时返回 false', async () => {
    requestMock.mockResolvedValue({ items: [profile('u1', 'bob')], nextCursor: null })
    await expect(apiSocialRepository.isFollowing('alice')).resolves.toBe(false)
  })

  it('isFollowing：跨页查找，最多翻 3 页后放弃（端点无 limit，不能无限翻）', async () => {
    let call = 0
    requestMock.mockImplementation(() => {
      call += 1
      return Promise.resolve({
        items: [profile(`u${call}`, `someone${call}`)],
        nextCursor: `C${call}`,
      })
    })
    await expect(apiSocialRepository.isFollowing('alice')).resolves.toBe(false)
    expect(requestMock).toHaveBeenCalledTimes(3)
  })

  it('isFollowing：第二页命中即返回 true，不再继续翻', async () => {
    requestMock
      .mockResolvedValueOnce({ items: [profile('u1', 'bob')], nextCursor: 'C1' })
      .mockResolvedValueOnce({ items: [profile('u2', 'Alice')], nextCursor: 'C2' })
    await expect(apiSocialRepository.isFollowing('alice')).resolves.toBe(true)
    expect(requestMock).toHaveBeenCalledTimes(2)
  })

  it('isFollowing：未登录直接返回 false，不发请求', async () => {
    getSessionMock.mockResolvedValue(null)
    await expect(apiSocialRepository.isFollowing('alice')).resolves.toBe(false)
    expect(requestMock).not.toHaveBeenCalled()
  })
})
