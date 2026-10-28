import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Follow, Profile, UserHit } from '@/domain/types'
import { blockedUserIdsOf, blockedUsers, isBlockedBetween, searchUserHits } from '@/domain/social'

type Row = Record<string, unknown>

const h = vi.hoisted(() => {
  const stores = new Map<string, Map<string, Row>>()
  const keyPaths: Record<string, string | string[]> = {
    profiles: 'id',
    photos: 'id',
    follows: ['followerId', 'followingId'],
    notifications: 'id',
    blocks: ['blockerId', 'blockedId'],
  }
  const table = (store: string) => {
    let value = stores.get(store)
    if (!value) {
      value = new Map<string, Row>()
      stores.set(store, value)
    }
    return value
  }
  const keyOf = (store: string, value: Row) => {
    const path = keyPaths[store]!
    return JSON.stringify(Array.isArray(path) ? path.map((key) => value[key]) : value[path])
  }
  const db = {
    async get(store: string, key: unknown) { return table(store).get(JSON.stringify(key)) },
    async getAll(store: string) { return [...table(store).values()] },
    async put(store: string, value: Row) { table(store).set(keyOf(store, value), value) },
    async delete(store: string, key: unknown) { table(store).delete(JSON.stringify(key)) },
  }
  return {
    db,
    session: { value: { userId: 'u-me', username: 'me' } as { userId: string; username: string } | null },
    seed(store: string, rows: readonly object[]) {
      for (const row of rows) table(store).set(keyOf(store, row as Row), row as Row)
    },
    rows(store: string) { return [...table(store).values()] },
    reset() { stores.clear(); h.session.value = { userId: 'u-me', username: 'me' } },
  }
})

vi.mock('@/data/mock/db', () => ({
  getDb: () => Promise.resolve(h.db),
  bumpDataVersion: () => Promise.resolve(1),
}))
vi.mock('@/data/mock/repositories/auth', () => ({
  mockAuthRepository: { getSession: () => Promise.resolve(h.session.value) },
}))

const { mockSocialRepository } = await import('@/data/mock/repositories/social')
const { mockSearchRepository } = await import('@/data/mock/repositories/search')
const { ErrorCodes } = await import('@/data/contracts')

const profile = (id: string, username: string, displayName = username): Profile => ({
  id,
  username,
  displayName,
  avatarKey: null,
  bio: `${username} bio`,
  role: 'user',
  links: [],
  licensePreference: 'all_rights_reserved',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
})
const follow = (followerId: string, followingId: string): Follow => ({
  followerId,
  followingId,
  createdAt: '2026-01-01T00:00:00.000Z',
})

beforeEach(() => {
  h.reset()
  h.seed('profiles', [profile('u-me', 'me'), profile('u-alice', 'alice', 'Alice'), profile('u-bob', 'bob', 'Alice Bob')])
})

describe('拉黑纯规则', () => {
  const blocks = [{ blockerId: 'a', blockedId: 'b', createdAt: '2026-01-02T00:00:00.000Z' }]

  it('任一方向都判定为不可见', () => {
    expect(isBlockedBetween(blocks, 'a', 'b')).toBe(true)
    expect(isBlockedBetween(blocks, 'b', 'a')).toBe(true)
    expect(blockedUserIdsOf(blocks, 'b')).toEqual(new Set(['a']))
  })

  it('搜索排除双向拉黑，并按前缀、粉丝数、用户名排序', () => {
    const profiles = [profile('me', 'me'), profile('a', 'alice'), profile('b', 'bob', 'Alice Bob'), profile('c', 'alina')]
    const follows = [follow('x', 'a'), follow('y', 'a'), follow('x', 'c')]
    expect(searchUserHits(profiles, follows, blocks, 'b', 'ali').map((hit) => hit.username)).toEqual(['alina', 'bob'])
    expect(searchUserHits(profiles, follows, [], 'me', 'ali').map((hit) => hit.username)).toEqual(['alice', 'alina', 'bob'])
  })

  it('黑名单只列主动拉黑对象并按时间倒序', () => {
    const rows = [
      { blockerId: 'me', blockedId: 'a', createdAt: '2026-01-01T00:00:00.000Z' },
      { blockerId: 'me', blockedId: 'b', createdAt: '2026-01-02T00:00:00.000Z' },
      { blockerId: 'a', blockedId: 'me', createdAt: '2026-01-03T00:00:00.000Z' },
    ]
    expect(blockedUsers(rows, [profile('a', 'alice'), profile('b', 'bob')], 'me').map((item) => item.username)).toEqual(['bob', 'alice'])
  })
})

describe('mock 拉黑仓储', () => {
  it('建立拉黑会删除双向关注，且重复调用幂等', async () => {
    h.seed('follows', [follow('u-me', 'u-alice'), follow('u-alice', 'u-me')])
    await expect(mockSocialRepository.blockUser('alice')).resolves.toEqual({ removedFollows: 2 })
    expect(h.rows('follows')).toHaveLength(0)
    expect(h.rows('blocks')).toHaveLength(1)
    await expect(mockSocialRepository.blockUser('alice')).resolves.toEqual({ removedFollows: 0 })
    expect(h.rows('blocks')).toHaveLength(1)
  })

  it('拉黑期间禁止重新关注，并从用户搜索排除', async () => {
    await mockSocialRepository.blockUser('alice')
    await expect(mockSocialRepository.follow('alice')).rejects.toMatchObject({ code: ErrorCodes.FORBIDDEN })
    const hits = await mockSearchRepository.searchUsers('alice')
    expect(hits.map((hit) => hit.username)).toEqual(['bob'])
  })

  it('listBlocked 分页投影，解除后恢复搜索但不恢复关注', async () => {
    await mockSocialRepository.blockUser('alice')
    const page = await mockSocialRepository.listBlocked({ limit: 1 })
    expect(page.items).toEqual([expect.objectContaining({ username: 'alice', blockedAt: expect.any(String) })])
    expect(page.total).toBe(1)
    await mockSocialRepository.unblockUser('ALICE')
    expect(h.rows('blocks')).toHaveLength(0)
    expect(h.rows('follows')).toHaveLength(0)
    const hits = await mockSearchRepository.searchUsers('alice')
    expect(hits).toEqual(expect.arrayContaining([
      expect.objectContaining({ username: 'alice', isFollowing: false }),
    ] satisfies Partial<UserHit>[]))
  })
})
