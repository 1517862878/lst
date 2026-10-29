/**
 * 收藏夹与服务端草稿的契约行为测试（8.3b）。
 *
 * 只测 mock 仓储：它是「无需后端也能验收」的那一份实现，而 api 实现的行为由
 * server/src/routes/collections.integration.ts 在真库上验证。两边跑同一份断言口径，
 * 才不会出现「mock 能看、线上看不到」的偏差。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/data/mock/db', async () => {
  const photos = [
    { id: 'photo-1', status: 'published', authorId: 'user-a', title: '一' },
    { id: 'photo-2', status: 'published', authorId: 'user-a', title: '二' },
    { id: 'photo-3', status: 'published', authorId: 'user-b', title: '三' },
    { id: 'photo-draft', status: 'draft', authorId: 'user-a', title: '草稿' },
  ]
  const profiles = [
    { id: 'user-a', username: 'alice', displayName: 'Alice' },
    { id: 'user-b', username: 'bob', displayName: 'Bob' },
  ]
  return {
    getDb: async () => ({
      getAll: async (store: string) => {
        if (store === 'photos') return photos
        if (store === 'profiles') return profiles
        return []
      },
      get: async (store: string, key: string) =>
        store === 'profiles' ? profiles.find((item) => item.id === key) : undefined,
    }),
  }
})

type Repo = typeof import('@/data/mock/repositories/collections')

let repo: Repo['mockCollectionRepository']

function signInAs(user: 'alice' | 'bob'): void {
  localStorage.setItem(
    'gy:session',
    JSON.stringify({
      userId: user === 'alice' ? 'user-a' : 'user-b',
      username: user,
      displayName: user === 'alice' ? 'Alice' : 'Bob',
    }),
  )
}

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const module = await import('@/data/mock/repositories/collections')
  repo = module.mockCollectionRepository
})

describe('服务端草稿', () => {
  it('没有草稿时返回空而不抛错', async () => {
    signInAs('alice')
    await expect(repo.getMyDraft()).resolves.toEqual({ payload: null, updatedAt: null })
  })

  it('保存后能读回，删除后回到空', async () => {
    signInAs('alice')
    const payload = {
      title: '山间晨雾',
      description: '',
      categorySlug: 'landscape',
      locationName: '黄山',
      license: 'all_rights_reserved' as const,
      tags: ['山', '雾'],
    }
    const saved = await repo.saveMyDraft(payload)
    expect(saved.updatedAt).toBeTruthy()
    expect((await repo.getMyDraft()).payload).toEqual(payload)
    await repo.deleteMyDraft()
    expect((await repo.getMyDraft()).payload).toBeNull()
  })
})

describe('收藏夹可见性', () => {
  it('别人的私密夹查不到，公开夹能看到', async () => {
    signInAs('alice')
    await repo.createCollection({ title: '私藏', visibility: 'private' })
    const publicOne = await repo.createCollection({ title: '公开', visibility: 'public' })

    signInAs('bob')
    const seen = await repo.listUserCollections('alice')
    expect(seen.map((item) => item.title)).toEqual(['公开'])
    await expect(repo.getCollection(String(publicOne.id))).resolves.toMatchObject({
      title: '公开',
      isOwner: false,
    })

    // bob 自己第一次打开「我的收藏夹」会拿到一份演示种子（2 个），
    // 但里面绝不能出现 alice 的任何一个夹。
    const mine = await repo.listMyCollections()
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.some((item) => item.title === '私藏' || item.title === '公开')).toBe(false)
    expect(mine.every((item) => item.ownerUsername === 'bob')).toBe(true)
  })

  it('unlisted 不进他人列表，但凭 id 能打开', async () => {
    signInAs('alice')
    const unlisted = await repo.createCollection({ title: '半公开', visibility: 'unlisted' })

    signInAs('bob')
    expect(await repo.listUserCollections('alice')).toEqual([])
    await expect(repo.getCollection(String(unlisted.id))).resolves.toMatchObject({
      title: '半公开',
    })
  })

  it('私密夹对他人的详情也是 NOT_FOUND', async () => {
    signInAs('alice')
    const secret = await repo.createCollection({ title: '只给自己', visibility: 'private' })
    signInAs('bob')
    await expect(repo.getCollection(String(secret.id))).rejects.toThrow()
  })
})

describe('条目幂等与计数', () => {
  it('重复加入幂等、移出幂等，itemCount 与条目一致', async () => {
    signInAs('alice')
    const collection = await repo.createCollection({ title: '测试夹' })
    const id = String(collection.id)

    expect(await repo.addItem(id, 'photo-1')).toEqual({ itemCount: 1 })
    expect(await repo.addItem(id, 'photo-1')).toEqual({ itemCount: 1 })
    expect(await repo.addItem(id, 'photo-2')).toEqual({ itemCount: 2 })
    expect(await repo.removeItem(id, 'photo-1')).toEqual({ itemCount: 1 })
    expect(await repo.removeItem(id, 'photo-1')).toEqual({ itemCount: 1 })
  })

  it('只能收藏已发布作品', async () => {
    signInAs('alice')
    const collection = await repo.createCollection({ title: '测试夹' })
    await expect(repo.addItem(String(collection.id), 'photo-draft')).rejects.toThrow(
      '只能收藏已发布的作品',
    )
  })

  it('列表摘要上的 hasPhoto 反映成员关系', async () => {
    signInAs('alice')
    const collection = await repo.createCollection({ title: '测试夹' })
    await repo.addItem(String(collection.id), 'photo-1')
    const [summary] = await repo.listMyCollections({ photoId: 'photo-1' })
    expect(summary?.hasPhoto).toBe(true)
    const [other] = await repo.listMyCollections({ photoId: 'photo-2' })
    expect(other?.hasPhoto).toBe(false)
  })
})
