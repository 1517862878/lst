/**
 * Mock 治理仓储（8.2）契约测试。
 *
 * 举报/审核/处罚/申诉是同一套状态机：open → reviewing → upheld | rejected。
 * mock 仓储不是「假数据占位」，而是 api 仓储的行为对照表 —— 两套实现必须
 * 在同样的非法操作上抛同样的错误码，页面才能用同一套错误文案。
 * 这里用内存 db 桩（同 tests/unit/mock-social.test.ts）直接驱动仓储。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Comment, MySanction, Photo, Profile, Report } from '@/domain/types'

type Row = Record<string, unknown> & { id: string }

/** 仓储会用到的索引：getAllFromIndex 按索引字段过滤（IDB 语义：非唯一索引） */
const INDEXES: Record<string, Record<string, string>> = {
  reports: { reporterId: 'reporterId', status: 'status' },
  sanctions: { userId: 'userId', status: 'status' },
  appeals: { appellantId: 'appellantId', status: 'status', reportId: 'reportId' },
}

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
    put: (store: string, value: Row) => {
      table(store).set(value.id, value)
      return Promise.resolve(value.id)
    },
    delete: (store: string, key: string) => {
      table(store).delete(key)
      return Promise.resolve()
    },
    getAll: (store: string) => Promise.resolve([...table(store).values()]),
    getAllFromIndex: (store: string, index: string, value: unknown) =>
      Promise.resolve(
        [...table(store).values()].filter((row) => {
          const field = INDEXES[store]?.[index] ?? index
          return row[field] === value
        }),
      ),
    count: (store: string) => Promise.resolve(table(store).size),
  }

  return {
    db,
    /** 当前会话；null = 游客 */
    session: { value: null as Record<string, unknown> | null },
    seed(store: string, rows: readonly unknown[]) {
      for (const row of rows) {
        const r = row as Row
        table(store).set(r.id, r)
      }
    },
    store(store: string): Map<string, Row> {
      return table(store)
    },
    reset() {
      stores.clear()
      h.session.value = null
    },
  }
})

vi.mock('@/data/mock/db', () => ({
  getDb: () => Promise.resolve(h.db),
  bumpDataVersion: () => Promise.resolve(1),
}))

vi.mock('@/data/mock/repositories/auth', () => ({
  mockAuthRepository: { getSession: () => Promise.resolve(h.session.value) },
}))

const { mockModerationRepository: repo } = await import('@/data/mock/repositories/moderation')
const { AppError, ErrorCodes } = await import('@/data/contracts')

// ===== 夹具 =====

const NOW = '2026-02-10T12:00:00.000Z'

function session(userId: string, role: 'user' | 'editor' | 'admin') {
  return {
    userId,
    username: userId,
    displayName: userId,
    avatarKey: null,
    role,
    expiresAt: '2026-03-10T00:00:00.000Z',
  }
}

function profile(id: string, overrides: Partial<Profile> = {}): Profile {
  return {
    id,
    username: id,
    displayName: id,
    avatarKey: null,
    bio: '',
    role: 'user',
    links: [],
    licensePreference: 'all_rights_reserved',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

function photo(id: string, authorId: string, overrides: Partial<Photo> = {}): Photo {
  return {
    id,
    authorId,
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
    ...overrides,
  }
}

function comment(id: string, photoId: string, authorId: string): Comment {
  return {
    id,
    photoId,
    authorId,
    parentId: null,
    body: '这是一条评论',
    status: 'visible',
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    deletedAt: null,
  }
}

function reportRow(id: string, overrides: Partial<Report> & { reporterId: string }): Row {
  return {
    id,
    targetType: 'photo',
    targetId: 'p-other',
    reason: 'spam',
    detail: '',
    status: 'open',
    assignedTo: null,
    reviewNote: null,
    resolutionCode: null,
    resolvedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Row
}

function sanctionRow(id: string, userId: string, overrides: Partial<MySanction> = {}): Row {
  return {
    id,
    userId,
    createdBy: 'u-admin',
    kind: 'warning',
    reasonCode: 'spam',
    reasonDetail: '刷屏',
    status: 'active',
    startsAt: NOW,
    endsAt: null,
    revokedAt: null,
    createdAt: NOW,
    ...overrides,
  } as Row
}

/** 断言异步调用抛出指定错误码，并返回错误对象便于检查文案 */
async function expectAppError(promise: Promise<unknown>, code: string, message?: string) {
  await expect(promise).rejects.toBeInstanceOf(AppError)
  await promise.catch((err: unknown) => {
    const appErr = err as InstanceType<typeof AppError>
    expect(appErr.code).toBe(code)
    if (message) expect(appErr.message).toBe(message)
  })
}

beforeEach(() => {
  h.reset()
  h.seed('profiles', [
    profile('u-me'),
    profile('u-other'),
    profile('u-editor', { role: 'editor' }),
    profile('u-admin', { role: 'admin' }),
  ])
  h.seed('photos', [photo('p-other', 'u-other'), photo('p-mine', 'u-me')])
  h.seed('comments', [comment('c-other', 'p-other', 'u-other')])
})

describe('权限', () => {
  it('游客不能举报，也不能看后台队列', async () => {
    await expectAppError(
      repo.submitReport({ targetType: 'photo', targetId: 'p-other', reason: 'spam', detail: '' }),
      ErrorCodes.UNAUTHORIZED,
      '请先登录后再操作',
    )
    await expectAppError(repo.listReports(), ErrorCodes.UNAUTHORIZED)
  })

  it('普通用户看后台队列被拒，审核员可以', async () => {
    h.session.value = session('u-me', 'user')
    await expectAppError(repo.listReports(), ErrorCodes.FORBIDDEN, '需要审核员或管理员权限')

    h.session.value = session('u-editor', 'editor')
    await expect(repo.listReports()).resolves.toEqual([])
  })
})

describe('submitReport', () => {
  beforeEach(() => {
    h.session.value = session('u-me', 'user')
  })

  it('提交成功返回 open 回执，detail 去首尾空白', async () => {
    const receipt = await repo.submitReport({
      targetType: 'photo',
      targetId: 'p-other',
      reason: 'copyright',
      detail: '  盗图  ',
    })
    expect(receipt.status).toBe('open')
    expect(receipt.reportId).toMatch(/^rep-/)
    const stored = [...h.store('reports').values()][0]
    expect(stored).toMatchObject({
      reporterId: 'u-me',
      targetId: 'p-other',
      reason: 'copyright',
      detail: '盗图',
      status: 'open',
      assignedTo: null,
    })
  })

  it('同一目标未结案时不能重复举报（避免回执变成几十条）', async () => {
    await repo.submitReport({ targetType: 'photo', targetId: 'p-other', reason: 'spam', detail: '' })
    await expectAppError(
      repo.submitReport({ targetType: 'photo', targetId: 'p-other', reason: 'abuse', detail: '' }),
      ErrorCodes.CONFLICT,
      '这条内容你已经举报过，我们正在处理',
    )
  })

  it('已结案后可以再次举报（例如内容恢复又被发现）', async () => {
    h.seed('reports', [
      reportRow('rep-old', { reporterId: 'u-me', targetId: 'p-other', status: 'rejected' }),
    ])
    const receipt = await repo.submitReport({
      targetType: 'photo',
      targetId: 'p-other',
      reason: 'spam',
      detail: '',
    })
    expect(receipt.reportId).not.toBe('rep-old')
  })

  it('不能举报自己的内容，也不能举报不存在的内容', async () => {
    await expectAppError(
      repo.submitReport({ targetType: 'photo', targetId: 'p-mine', reason: 'spam', detail: '' }),
      ErrorCodes.VALIDATION,
      '不能举报自己的内容',
    )
    await expectAppError(
      repo.submitReport({ targetType: 'photo', targetId: 'p-ghost', reason: 'spam', detail: '' }),
      ErrorCodes.NOT_FOUND,
      '被举报的内容不存在',
    )
  })

  it('补充说明上限 500 字', async () => {
    await expectAppError(
      repo.submitReport({
        targetType: 'comment',
        targetId: 'c-other',
        reason: 'abuse',
        detail: 'x'.repeat(501),
      }),
      ErrorCodes.VALIDATION,
      '补充说明最多 500 字',
    )
  })
})

describe('我的视角', () => {
  it('myReports 按时间倒序，并带上最新申诉状态', async () => {
    h.session.value = session('u-me', 'user')
    h.seed('reports', [
      reportRow('rep-a', { reporterId: 'u-me', createdAt: '2026-02-01T00:00:00.000Z' }),
      reportRow('rep-b', { reporterId: 'u-me', createdAt: '2026-02-05T00:00:00.000Z' }),
      reportRow('rep-other', { reporterId: 'u-other' }),
    ])
    h.seed('appeals', [
      {
        id: 'apl-1',
        appellantId: 'u-me',
        reportId: 'rep-b',
        sanctionId: null,
        message: '我并没有刷屏，请重新核实一下',
        status: 'rejected',
        reviewNote: '维持原判',
        createdAt: '2026-02-06T00:00:00.000Z',
        reviewedAt: '2026-02-07T00:00:00.000Z',
      },
    ])

    const mine = await repo.myReports()
    expect(mine.map((r) => r.id)).toEqual(['rep-b', 'rep-a'])
    expect(mine[0]).toMatchObject({ appealStatus: 'rejected' })
    expect(mine[1]).toMatchObject({ appealStatus: null })
    // 出库不带存储层字段
    expect(mine[0]).not.toHaveProperty('reporterId')
    expect(mine[0]).not.toHaveProperty('assignedTo')
  })

  it('mySanctions 只返回自己的处罚', async () => {
    h.session.value = session('u-me', 'user')
    h.seed('sanctions', [
      sanctionRow('san-mine', 'u-me'),
      sanctionRow('san-other', 'u-other'),
    ])
    const mine = await repo.mySanctions()
    expect(mine.map((s) => s.id)).toEqual(['san-mine'])
    expect(mine[0]).not.toHaveProperty('userId')
  })
})

describe('申诉', () => {
  beforeEach(() => {
    h.session.value = session('u-me', 'user')
    h.seed('reports', [
      reportRow('rep-mine', { reporterId: 'u-me', status: 'upheld' }),
      reportRow('rep-other', { reporterId: 'u-other' }),
    ])
    h.seed('sanctions', [sanctionRow('san-mine', 'u-me')])
  })

  it('只能对自己的举报/处罚申诉', async () => {
    await expectAppError(
      repo.submitAppeal({ reportId: 'rep-other', message: '这条举报判错了，请复核' }),
      ErrorCodes.FORBIDDEN,
      '只能对自己的举报提起申诉',
    )
  })

  it('说明至少 10 字，且必须且只能关联一个对象', async () => {
    await expectAppError(
      repo.submitAppeal({ reportId: 'rep-mine', message: '太短了' }),
      ErrorCodes.VALIDATION,
      '申诉说明至少 10 个字',
    )
    await expectAppError(
      repo.submitAppeal({ message: '这是一条没有关联对象的申诉说明' }),
      ErrorCodes.VALIDATION,
      '申诉必须且只能关联一条举报或一次处罚',
    )
  })

  it('同一对象已在申诉中时不能重复提交', async () => {
    await repo.submitAppeal({ sanctionId: 'san-mine', message: '这次处罚我不认可，请复核' })
    await expectAppError(
      repo.submitAppeal({ sanctionId: 'san-mine', message: '这次处罚我不认可，请复核' }),
      ErrorCodes.CONFLICT,
      '这次处罚已经在申诉中，请等待复核',
    )
  })

  it('提交后 myAppeals 能查到，appealStatus 反映到 mySanctions', async () => {
    const receipt = await repo.submitAppeal({
      sanctionId: 'san-mine',
      message: '这次处罚我不认可，请复核',
    })
    expect(receipt.status).toBe('open')
    expect(receipt.appealId).toMatch(/^apl-/)

    const appeals = await repo.myAppeals()
    expect(appeals).toHaveLength(1)
    expect(appeals[0]).not.toHaveProperty('appellantId')

    const sanctions = await repo.mySanctions()
    expect(sanctions[0]?.appealStatus).toBe('open')
  })
})

describe('后台：队列与详情', () => {
  beforeEach(() => {
    h.session.value = session('u-editor', 'editor')
  })

  it('按状态筛选队列，可排序，不泄漏举报人 id', async () => {
    h.seed('reports', [
      reportRow('rep-open', { reporterId: 'u-me', createdAt: '2026-02-01T00:00:00.000Z' }),
      reportRow('rep-up', {
        reporterId: 'u-me',
        status: 'upheld',
        createdAt: '2026-02-05T00:00:00.000Z',
      }),
    ])
    const open = await repo.listReports('open')
    expect(open.map((r) => r.id)).toEqual(['rep-open'])
    expect(open[0]).not.toHaveProperty('reporterId')

    const all = await repo.listReports()
    expect(all.length).toBeGreaterThanOrEqual(2)
    expect(all[0]!.createdAt >= all[1]!.createdAt).toBe(true)
  })

  it('详情带目标快照：被隐藏的内容标记 hidden', async () => {
    h.store('photos').set('p-other', photo('p-other', 'u-other', { status: 'hidden' }) as never)
    h.seed('reports', [reportRow('rep-1', { reporterId: 'u-me' })])
    const detail = await repo.reportDetail('rep-1')
    expect(detail.target).toMatchObject({
      kind: 'photo',
      id: 'p-other',
      hidden: true,
      authorId: 'u-other',
      authorUsername: 'u-other',
    })
    expect(detail.report).not.toHaveProperty('reporterId')
    expect(detail.actions).toEqual([])
  })

  it('认领：先到先得，别人已认领时报冲突', async () => {
    h.seed('reports', [reportRow('rep-1', { reporterId: 'u-me' })])
    await repo.claimReport('rep-1')
    let row = h.store('reports').get('rep-1')
    expect(row).toMatchObject({ status: 'reviewing', assignedTo: 'u-editor' })

    h.session.value = session('u-admin', 'admin')
    await expectAppError(
      repo.claimReport('rep-1'),
      ErrorCodes.CONFLICT,
      '这条举报已被其他审核员认领',
    )
    row = h.store('reports').get('rep-1')
    expect(row).toMatchObject({ assignedTo: 'u-editor' })
  })

  it('隐藏/恢复内容要写理由，并落一条审计动作', async () => {
    h.seed('reports', [reportRow('rep-1', { reporterId: 'u-me' })])
    await expectAppError(
      repo.setVisibility({ targetType: 'photo', targetId: 'p-other', hidden: true, reason: ' ' }),
      ErrorCodes.VALIDATION,
      '请填写处理理由',
    )
    await repo.setVisibility({
      targetType: 'photo',
      targetId: 'p-other',
      hidden: true,
      reason: '盗用他人作品',
      reportId: 'rep-1',
    })
    expect(h.store('photos').get('p-other')).toMatchObject({ status: 'hidden' })
    const actions = [...h.store('moderationActions').values()]
    expect(actions.map((a) => a.action)).toContain('content.hide')

    await repo.setVisibility({
      targetType: 'photo',
      targetId: 'p-other',
      hidden: false,
      reason: '申诉成立',
    })
    expect(h.store('photos').get('p-other')).toMatchObject({ status: 'published' })
  })

  it('个人主页不支持隐藏，引导走处罚', async () => {
    await expectAppError(
      repo.setVisibility({
        targetType: 'profile',
        targetId: 'u-other',
        hidden: true,
        reason: '冒充他人',
      }),
      ErrorCodes.VALIDATION,
      '个人主页不支持隐藏，请用处罚处理',
    )
  })

  it('裁定：状态与裁定码必填，结案后不能重复裁定', async () => {
    h.seed('reports', [reportRow('rep-1', { reporterId: 'u-me', status: 'reviewing' })])
    await expectAppError(
      repo.resolveReport('rep-1', { status: 'upheld', resolutionCode: 'content_hidden', reviewNote: '' }),
      ErrorCodes.VALIDATION,
      '请填写审核备注',
    )
    await repo.resolveReport('rep-1', {
      status: 'upheld',
      resolutionCode: 'content_hidden',
      reviewNote: '已核对原图 EXIF',
    })
    expect(h.store('reports').get('rep-1')).toMatchObject({
      status: 'upheld',
      resolutionCode: 'content_hidden',
      reviewNote: '已核对原图 EXIF',
      assignedTo: 'u-editor',
    })
    expect(h.store('reports').get('rep-1')?.resolvedAt).toBeTruthy()

    await expectAppError(
      repo.resolveReport('rep-1', {
        status: 'rejected',
        resolutionCode: 'no_violation',
        reviewNote: '再看一次',
      }),
      ErrorCodes.VALIDATION,
      '这条举报已经结案',
    )
  })
})

describe('后台：申诉复核与处罚撤销', () => {
  beforeEach(() => {
    h.session.value = session('u-admin', 'admin')
  })

  it('复核申诉要写意见，且只能复核一次', async () => {
    h.seed('appeals', [
      {
        id: 'apl-1',
        appellantId: 'u-me',
        reportId: 'rep-1',
        sanctionId: null,
        message: '请重新核实这条举报',
        status: 'open',
        reviewNote: '',
        createdAt: NOW,
        reviewedAt: null,
      },
    ])
    await expectAppError(
      repo.reviewAppeal('apl-1', { outcome: 'upheld', note: ' ' }),
      ErrorCodes.VALIDATION,
      '请填写复核意见',
    )
    const receipt = await repo.reviewAppeal('apl-1', { outcome: 'upheld', note: '确有误判' })
    expect(receipt).toMatchObject({ appealId: 'apl-1', status: 'upheld' })

    await expectAppError(
      repo.reviewAppeal('apl-1', { outcome: 'rejected', note: '再判一次' }),
      ErrorCodes.CONFLICT,
      '这条申诉已经复核过',
    )
  })

  it('申诉成立时连带撤销关联处罚', async () => {
    h.seed('sanctions', [sanctionRow('san-1', 'u-me')])
    h.seed('appeals', [
      {
        id: 'apl-1',
        appellantId: 'u-me',
        reportId: null,
        sanctionId: 'san-1',
        message: '这次处罚我不认可，请复核',
        status: 'reviewing',
        reviewNote: '',
        createdAt: NOW,
        reviewedAt: null,
      },
    ])
    await repo.reviewAppeal('apl-1', { outcome: 'upheld', note: '处罚依据不足' })
    expect(h.store('sanctions').get('san-1')).toMatchObject({ status: 'revoked' })
    expect(h.store('sanctions').get('san-1')?.revokedAt).toBeTruthy()
  })

  it('撤销处罚：必须写理由，不能重复撤销', async () => {
    h.seed('sanctions', [sanctionRow('san-1', 'u-me')])
    await expectAppError(repo.revokeSanction('san-1', ''), ErrorCodes.VALIDATION, '请填写撤销理由')
    await repo.revokeSanction('san-1', '申诉成立')
    expect(h.store('sanctions').get('san-1')).toMatchObject({ status: 'revoked' })

    await expectAppError(
      repo.revokeSanction('san-1', '再撤一次'),
      ErrorCodes.CONFLICT,
      '这次处罚已经撤销',
    )
    await expectAppError(repo.revokeSanction('san-ghost', '不存在'), ErrorCodes.NOT_FOUND, '处罚不存在')
  })
})
