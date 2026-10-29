/**
 * Mock 会话里的 restriction（8.2 补口）。
 *
 * mock 不能把 restriction 一次性写死在 localStorage 里：管理员撤销处罚、
 * 或期限自然到期后，下一次 getSession 必须重新算。这里用内存 db 桩验证
 * 「生效中最重的一条」「过期/撤销不计」「读库失败退回已存会话」。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    put: (store: string, row: Row) => {
      table(store).set(row.id, row)
      return Promise.resolve(row.id)
    },
    getAll: (store: string) => Promise.resolve([...table(store).values()]),
    getAllFromIndex: (store: string, index: string, value: unknown) =>
      Promise.resolve([...table(store).values()].filter((row) => row[index] === value)),
    count: (store: string) => Promise.resolve(table(store).size),
  }
  return {
    db,
    fail: { value: false },
    seed(store: string, rows: readonly Row[]) {
      for (const row of rows) table(store).set(row.id, row)
    },
    row(store: string, id: string): Row | undefined {
      return table(store).get(id)
    },
    reset() {
      stores.clear()
      h.fail.value = false
    },
  }
})

vi.mock('@/data/mock/db', () => ({
  getDb: () => (h.fail.value ? Promise.reject(new Error('IndexedDB 不可用')) : Promise.resolve(h.db)),
  bumpDataVersion: () => Promise.resolve(1),
}))

const { mockAuthRepository } = await import('@/data/mock/repositories/auth')

const NOW = Date.now()
const future = new Date(NOW + 2 * 24 * 3600_000).toISOString()
const past = new Date(NOW - 24 * 3600_000).toISOString()

function profile(id: string, username: string): Row {
  return {
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
  }
}

function sanction(id: string, userId: string, overrides: Record<string, unknown> = {}): Row {
  return {
    id,
    userId,
    kind: 'content_restriction',
    reasonCode: 'copyright',
    reasonDetail: '多次上传未授权作品',
    status: 'active',
    startsAt: '2026-10-01T00:00:00.000Z',
    endsAt: future,
    revokedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  h.reset()
  h.seed('profiles', [profile('u-chen', 'chen'), profile('u-me', 'me')])
})

describe('mockAuthRepository 的 restriction', () => {
  it('登录时带上生效中的限制，getSession 也能重新读到', async () => {
    h.seed('sanctions', [sanction('s-1', 'u-chen')])

    const signed = await mockAuthRepository.signIn('chen', 'demo1234')
    expect(signed.restriction).toEqual({
      kind: 'content_restriction',
      reasonCode: 'copyright',
      reasonDetail: '多次上传未授权作品',
      endsAt: future,
    })

    const restored = await mockAuthRepository.getSession()
    expect(restored?.restriction?.kind).toBe('content_restriction')
  })

  it('多条生效处罚时取最重的一条', async () => {
    h.seed('sanctions', [
      sanction('s-warning', 'u-chen', { kind: 'warning', endsAt: null }),
      sanction('s-ban', 'u-chen', { kind: 'ban', endsAt: null, reasonDetail: '屡次侵权' }),
    ])

    const signed = await mockAuthRepository.signIn('chen', 'demo1234')
    expect(signed.restriction).toMatchObject({ kind: 'ban', reasonDetail: '屡次侵权' })
  })

  it('已撤销或已过期的处罚不再出现在会话里', async () => {
    h.seed('sanctions', [
      sanction('s-revoked', 'u-chen', { status: 'revoked', revokedAt: '2026-10-02T00:00:00.000Z' }),
      sanction('s-expired', 'u-chen', { status: 'expired', endsAt: past }),
    ])

    const signed = await mockAuthRepository.signIn('chen', 'demo1234')
    expect(signed.restriction).toBeNull()

    const restored = await mockAuthRepository.getSession()
    expect(restored?.restriction).toBeNull()
  })

  it('撤销发生在会话存下之后：下次 getSession 立刻读到无限制', async () => {
    h.seed('sanctions', [sanction('s-1', 'u-chen')])
    await mockAuthRepository.signIn('chen', 'demo1234')

    h.seed('sanctions', [
      sanction('s-1', 'u-chen', { status: 'revoked', revokedAt: '2026-10-03T00:00:00.000Z' }),
    ])
    const restored = await mockAuthRepository.getSession()
    expect(restored?.restriction).toBeNull()
  })

  it('没有处罚的账号 restriction 为 null', async () => {
    const signed = await mockAuthRepository.signIn('me', 'demo1234')
    expect(signed.restriction).toBeNull()
  })

  it('读库失败时退回已存会话，不让演示模式整体登不进去', async () => {
    h.seed('sanctions', [sanction('s-1', 'u-chen')])
    await mockAuthRepository.signIn('chen', 'demo1234')

    h.fail.value = true
    const restored = await mockAuthRepository.getSession()
    expect(restored?.userId).toBe('u-chen')
    expect(restored?.restriction).toBeNull()
  })
})
