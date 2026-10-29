/**
 * API 标签仓储单测（src/data/api/tags.ts）。
 *
 * 只桩掉 http 客户端 request。要锁住的是**冻结端点清单的拼装细节**
 * （.tmp/phase83a-freeze.md 第 3 节）——后端一改形状，最先红的应该是这里：
 *   GET /api/tags?sort=&limit=&prefix=
 *   GET /api/tags/:tag
 *   GET /api/tags/:tag/photos?sort=&cursor=&limit=
 *   GET /api/search/tags?q=&limit=
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/data/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/api/client')>()
  return { ...actual, request: vi.fn() }
})

const { request } = await import('@/data/api/client')
const { apiTagRepository } = await import('@/data/api/tags')

const requestMock = vi.mocked(request)

beforeEach(() => {
  requestMock.mockReset()
  requestMock.mockResolvedValue({ items: [] })
})

describe('apiTagRepository.list', () => {
  it('拼出 /api/tags 并带上 sort / limit / prefix', async () => {
    await apiTagRepository.list({ sort: 'hot', limit: 20, prefix: ' 夜 ' })
    expect(requestMock).toHaveBeenCalledWith('/api/tags?sort=hot&limit=20&prefix=%E5%A4%9C')
  })

  it('省略的查询参数不写进 URL', async () => {
    await apiTagRepository.list({ sort: 'latest' })
    expect(requestMock).toHaveBeenCalledWith('/api/tags?sort=latest')
  })

  it('空白 prefix 视同未传', async () => {
    await apiTagRepository.list({ sort: 'hot', prefix: '   ' })
    expect(requestMock).toHaveBeenCalledWith('/api/tags?sort=hot')
  })

  it('取响应里的 items', async () => {
    requestMock.mockResolvedValueOnce({
      items: [{ tag: '夜景', photoCount: 3, authorCount: 2, latestPublishedAt: null }],
    })
    const tags = await apiTagRepository.list({ sort: 'hot' })
    expect(tags).toEqual([{ tag: '夜景', photoCount: 3, authorCount: 2, latestPublishedAt: null }])
  })
})

describe('apiTagRepository.get', () => {
  it('标签作为路径段并编码', async () => {
    requestMock.mockResolvedValueOnce({
      tag: 'long exposure',
      photoCount: 1,
      authorCount: 1,
      latestPublishedAt: null,
      relatedTags: [],
    })
    await apiTagRepository.get('long exposure')
    expect(requestMock).toHaveBeenCalledWith('/api/tags/long%20exposure')
  })

  it('斜杠必须编码，不能变成多一段路径', async () => {
    await apiTagRepository.get('a/b')
    expect(requestMock).toHaveBeenCalledWith('/api/tags/a%2Fb')
  })
})

describe('apiTagRepository.photos', () => {
  it('拼出 /photos 子路径与排序/游标参数', async () => {
    requestMock.mockResolvedValueOnce({ items: [], nextCursor: 'p2' })
    const page = await apiTagRepository.photos('夜景', { sort: 'popular', limit: 20, cursor: 'p1' })
    expect(requestMock).toHaveBeenCalledWith(
      '/api/tags/%E5%A4%9C%E6%99%AF/photos?sort=popular&cursor=p1&limit=20',
    )
    expect(page.nextCursor).toBe('p2')
  })

  it('后端省略 nextCursor 时收敛为 null（最后一页）', async () => {
    requestMock.mockResolvedValueOnce({ items: [] })
    const page = await apiTagRepository.photos('夜景', { sort: 'latest' })
    expect(page).toEqual({ items: [], nextCursor: null })
  })
})

describe('apiTagRepository.suggest', () => {
  it('空前缀直接返回空数组，不发请求', async () => {
    expect(await apiTagRepository.suggest('   ')).toEqual([])
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('走 /api/search/tags 并透传 q / limit', async () => {
    requestMock.mockResolvedValueOnce({ items: [{ tag: '夜景', photoCount: 2 }] })
    const items = await apiTagRepository.suggest('夜景', { limit: 5 })
    expect(requestMock).toHaveBeenCalledWith(
      '/api/search/tags?q=%E5%A4%9C%E6%99%AF&limit=5',
    )
    expect(items).toEqual([{ tag: '夜景', photoCount: 2 }])
  })

  it('未给 limit 时不写该参数', async () => {
    await apiTagRepository.suggest('夜')
    expect(requestMock).toHaveBeenCalledWith('/api/search/tags?q=%E5%A4%9C')
  })
})
