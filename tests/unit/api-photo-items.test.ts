/**
 * API 组照仓储单测（src/data/api/photos.ts 的 replaceItems）。
 *
 * 只桩掉 http 客户端 request。要锁住的是与后端接口的**拼装契约**：
 *   PUT /api/photos/:id/items   body = { items: [...] }
 * 以及一个容易写错的地方：作品 id 必须 encodeURIComponent（id 是 uuid，
 * 但列表页/详情页传进来的值来自 URL，不编码会在特殊字符上拼出别的路径）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/data/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/api/client')>()
  return { ...actual, request: vi.fn() }
})

const { request } = await import('@/data/api/client')
const { apiPhotoRepository } = await import('@/data/api/photos')

const requestMock = vi.mocked(request)

beforeEach(() => {
  requestMock.mockReset()
  requestMock.mockResolvedValue({ photoId: 'p1', itemCount: 2, items: [] })
})

describe('apiPhotoRepository.replaceItems', () => {
  it('PUT /api/photos/:id/items，并把条目原样放进 items 字段', async () => {
    const items = [
      {
        imageKey: 'photos/u1/p1/items/0/display.webp',
        thumbKey: 'photos/u1/p1/items/0/thumb.webp',
        width: 1600,
        height: 1067,
        blurhash: null,
        caption: '第一张',
      },
      {
        imageKey: 'photos/u1/p1/items/1/display.webp',
        thumbKey: 'photos/u1/p1/items/1/thumb.webp',
        width: 1200,
        height: 800,
        blurhash: 'LEHV6n',
        caption: '',
      },
    ]

    await apiPhotoRepository.replaceItems('p1', items)

    expect(requestMock).toHaveBeenCalledWith('/api/photos/p1/items', {
      method: 'PUT',
      body: { items },
    })
  })

  it('作品 id 会做 URL 编码（不把路径拼歪）', async () => {
    await apiPhotoRepository.replaceItems('a/b c', [])

    expect(requestMock).toHaveBeenCalledWith('/api/photos/a%2Fb%20c/items', {
      method: 'PUT',
      body: { items: [] },
    })
  })

  it('空数组照常发出去（退回单图是合法语义，不能悄悄跳过请求）', async () => {
    requestMock.mockResolvedValue({ photoId: 'p1', itemCount: 0, items: [] })

    const result = await apiPhotoRepository.replaceItems('p1', [])

    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(result.itemCount).toBe(0)
  })
})
