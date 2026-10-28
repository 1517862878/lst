/**
 * 个人主页列表的 API 端点映射（src/data/api/photos.ts、src/data/api/interactions.ts）。
 *
 * 为什么这些断言值得单独存在：主页三 Tab 在 API 模式下一度全空——works 拿最新 100 件
 * 再按 profiles.id 客户端过滤，而公开资料**不返回** id；likes/favorites 走的是仅限本人的
 * GET /api/interactions。修好之后，「按 username 取」这件事就只剩下端点拼接一层可测，
 * 所以这里把 query string 钉死：谁来改参数名或漏掉 authorUsername，第一个红的应该是这里。
 *
 * 只桩掉最外层的 http 客户端；拼装、URL 编码、游标透传都是本文件要锁住的契约。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Photo } from '@/domain/types'

vi.mock('@/data/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/api/client')>()
  return { ...actual, request: vi.fn() }
})

const { request } = await import('@/data/api/client')
const { apiPhotoRepository } = await import('@/data/api/photos')
const { apiInteractionRepository } = await import('@/data/api/interactions')

const requestMock = vi.mocked(request)

const photo = (id: string): Photo =>
  ({
    id,
    authorId: 'u-alice',
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

const firstCall = () => requestMock.mock.calls[0]?.[0]

beforeEach(() => {
  requestMock.mockReset()
})

describe('apiPhotoRepository.list 的 authorUsername', () => {
  it('传 authorUsername 时拼进 query string（主页「作品」靠它取数）', async () => {
    requestMock.mockResolvedValue({ items: [photo('p1')], nextCursor: null })
    await apiPhotoRepository.list({ sort: 'latest', authorUsername: 'alice', limit: 100 })
    expect(firstCall()).toBe('/api/photos?sort=latest&authorUsername=alice&limit=100')
  })

  it('不传时整条参数不出现（作品墙/分类墙的既有请求形状不变）', async () => {
    requestMock.mockResolvedValue({ items: [], nextCursor: null })
    await apiPhotoRepository.list({ sort: 'latest' })
    expect(firstCall()).toBe('/api/photos?sort=latest')

    requestMock.mockClear()
    await apiPhotoRepository.list({ sort: 'popular', categorySlug: 'portrait', cursor: 'C1' })
    expect(firstCall()).toBe('/api/photos?sort=popular&categorySlug=portrait&cursor=C1')
  })
})

describe('apiInteractionRepository.listByUsername', () => {
  it('likes 走 /api/profiles/:username/interactions?kind=likes', async () => {
    requestMock.mockResolvedValue({ items: [], nextCursor: null })
    await apiInteractionRepository.listByUsername('alice', 'likes')
    expect(firstCall()).toBe('/api/profiles/alice/interactions?kind=likes')
  })

  it('favorites 只用 kind 区分，端点相同', async () => {
    requestMock.mockResolvedValue({ items: [], nextCursor: null })
    await apiInteractionRepository.listByUsername('alice', 'favorites')
    expect(firstCall()).toBe('/api/profiles/alice/interactions?kind=favorites')
  })

  it('用户名做 URL 编码（用户名允许中文与特殊字符）', async () => {
    requestMock.mockResolvedValue({ items: [], nextCursor: null })
    await apiInteractionRepository.listByUsername('林 同学', 'likes')
    expect(firstCall()).toBe('/api/profiles/%E6%9E%97%20%E5%90%8C%E5%AD%A6/interactions?kind=likes')
  })

  it('游标与页长透传：首页不带 cursor，翻页带上一页的 cursor', async () => {
    requestMock.mockResolvedValue({ items: [], nextCursor: null })
    await apiInteractionRepository.listByUsername('alice', 'likes', undefined, 100)
    expect(firstCall()).toBe('/api/profiles/alice/interactions?kind=likes&limit=100')

    requestMock.mockClear()
    await apiInteractionRepository.listByUsername('alice', 'likes', 'CURSOR-1', 100)
    expect(firstCall()).toBe('/api/profiles/alice/interactions?kind=likes&cursor=CURSOR-1&limit=100')
  })

  it('原样返回 { items, nextCursor }，不在前端重排或包装', async () => {
    requestMock.mockResolvedValue({ items: [photo('p1')], nextCursor: 'C2' })
    await expect(apiInteractionRepository.listByUsername('alice', 'likes')).resolves.toEqual({
      items: [photo('p1')],
      nextCursor: 'C2',
    })
  })

  it('/me 的「本人」端点保持不变（这次不改本人视图的口径）', async () => {
    requestMock.mockResolvedValue([])
    await apiInteractionRepository.listLikesByUser('u-me')
    expect(firstCall()).toBe('/api/interactions?userId=u-me&kind=likes')

    requestMock.mockClear()
    await apiInteractionRepository.listFavoritesByUser('u-me')
    expect(firstCall()).toBe('/api/interactions?userId=u-me&kind=favorites')
  })
})
