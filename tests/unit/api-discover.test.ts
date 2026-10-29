/**
 * API 发现仓储单测（src/data/api/discover.ts，8.3c）。
 *
 * 只桩掉 http 客户端 request，锁住冻结契约第 3 节的端点形状：
 *   GET    /api/discover/hot-searches?days=&limit=
 *   GET    /api/discover/new-authors?days=&limit=
 *   GET    /api/discover/featured?cursor=&limit=
 *   POST   /api/admin/photos/:id/feature
 *   DELETE /api/admin/photos/:id/feature
 * 以及 nextCursor 的收敛（后端省略 = 最后一页 = null）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/data/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/api/client')>()
  return { ...actual, request: vi.fn() }
})

const { request } = await import('@/data/api/client')
const { apiDiscoverRepository } = await import('@/data/api/discover')

const requestMock = vi.mocked(request)

beforeEach(() => {
  requestMock.mockReset()
  requestMock.mockResolvedValue({ items: [] })
})

describe('apiDiscoverRepository.hotSearches', () => {
  it('拼出 days / limit 并取 items', async () => {
    requestMock.mockResolvedValueOnce({ items: [{ term: '夜景', searchCount: 12 }] })
    const items = await apiDiscoverRepository.hotSearches({ days: 7, limit: 10 })
    expect(requestMock).toHaveBeenCalledWith('/api/discover/hot-searches?days=7&limit=10')
    expect(items).toEqual([{ term: '夜景', searchCount: 12 }])
  })

  it('无参数时不带查询串', async () => {
    await apiDiscoverRepository.hotSearches()
    expect(requestMock).toHaveBeenCalledWith('/api/discover/hot-searches')
  })
})

describe('apiDiscoverRepository.newAuthors', () => {
  it('拼出 days / limit 并取 items', async () => {
    requestMock.mockResolvedValueOnce({
      items: [
        {
          username: 'alice',
          displayName: '爱丽丝',
          avatarKey: null,
          photoCount: 3,
          likeTotal: 18,
          createdAt: '2026-10-01T00:00:00.000Z',
        },
      ],
    })
    const items = await apiDiscoverRepository.newAuthors({ days: 90, limit: 6 })
    expect(requestMock).toHaveBeenCalledWith('/api/discover/new-authors?days=90&limit=6')
    expect(items[0]).toMatchObject({ username: 'alice', likeTotal: 18 })
  })
})

describe('apiDiscoverRepository.featured', () => {
  it('游标与条数都进查询串', async () => {
    requestMock.mockResolvedValueOnce({ items: [], nextCursor: 'c2' })
    const page = await apiDiscoverRepository.featured('c1', 12)
    expect(requestMock).toHaveBeenCalledWith('/api/discover/featured?cursor=c1&limit=12')
    expect(page.nextCursor).toBe('c2')
  })

  it('后端省略 nextCursor 时收敛成 null', async () => {
    requestMock.mockResolvedValueOnce({ items: [] })
    const page = await apiDiscoverRepository.featured()
    expect(page).toEqual({ items: [], nextCursor: null })
  })
})

describe('apiDiscoverRepository.setEditorChoice', () => {
  it('设为精选走 POST，作品 id 作为路径段并编码', async () => {
    requestMock.mockResolvedValueOnce({ photoId: 'a/b', featuredAt: '2026-10-29T00:00:00.000Z' })
    const result = await apiDiscoverRepository.setEditorChoice('a/b', true)
    expect(requestMock).toHaveBeenCalledWith('/api/admin/photos/a%2Fb/feature', { method: 'POST' })
    expect(result.featuredAt).toBe('2026-10-29T00:00:00.000Z')
  })

  it('取消精选走 DELETE', async () => {
    requestMock.mockResolvedValueOnce({ photoId: 'p1', featuredAt: null })
    const result = await apiDiscoverRepository.setEditorChoice('p1', false)
    expect(requestMock).toHaveBeenCalledWith('/api/admin/photos/p1/feature', { method: 'DELETE' })
    expect(result.featuredAt).toBeNull()
  })
})
