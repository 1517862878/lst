import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlockedUser, UserHit } from '@/domain/types'

vi.mock('@/data/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/api/client')>()
  return { ...actual, request: vi.fn() }
})

const { request } = await import('@/data/api/client')
const { apiSocialRepository } = await import('@/data/api/social')
const { apiSearchRepository } = await import('@/data/api/search')
const requestMock = vi.mocked(request)

beforeEach(() => requestMock.mockReset())

describe('API 拉黑与用户搜索仓储', () => {
  it('映射 block/unblock 端点并编码用户名', async () => {
    requestMock.mockResolvedValueOnce({ blocked: true, removedFollows: 2 })
    await expect(apiSocialRepository.blockUser('林 同学')).resolves.toEqual({ removedFollows: 2 })
    expect(requestMock).toHaveBeenCalledWith('/api/profiles/%E6%9E%97%20%E5%90%8C%E5%AD%A6/block', { method: 'PUT' })

    requestMock.mockResolvedValueOnce({ blocked: false })
    await expect(apiSocialRepository.unblockUser('林 同学')).resolves.toBeUndefined()
    expect(requestMock).toHaveBeenLastCalledWith('/api/profiles/%E6%9E%97%20%E5%90%8C%E5%AD%A6/block', { method: 'DELETE' })
  })

  it('透传黑名单游标和 limit，保留 Page 形状', async () => {
    const item: BlockedUser = { username: 'alice', displayName: 'Alice', avatarKey: null, bio: '', blockedAt: '2026-01-01T00:00:00.000Z' }
    requestMock.mockResolvedValue({ items: [item], total: 1, nextCursor: 'NEXT' })
    await expect(apiSocialRepository.listBlocked({ cursor: 'CUR', limit: 10 })).resolves.toEqual({ items: [item], total: 1, nextCursor: 'NEXT' })
    expect(requestMock).toHaveBeenCalledWith('/api/me/blocks?cursor=CUR&limit=10')
  })

  it('用户搜索裁剪关键词、透传 limit，并只返回 items', async () => {
    const hit: UserHit = { username: 'alice', displayName: 'Alice', avatarKey: null, bio: '', followerCount: 2, isFollowing: true }
    requestMock.mockResolvedValue({ items: [hit], total: 1 })
    await expect(apiSearchRepository.searchUsers('  alice  ', { limit: 5 })).resolves.toEqual([hit])
    expect(requestMock).toHaveBeenCalledWith('/api/users/search?q=alice&limit=5')
  })
})
