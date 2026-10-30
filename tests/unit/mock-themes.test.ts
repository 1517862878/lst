/**
 * Mock 每周主题仓储单测（src/data/mock/repositories/themes.ts，8.4d）。
 *
 * 与 mock-social / mock-tags 同一策略：桩掉 db 模块，用内存表顶替 IndexedDB
 * （jsdom 没有 IDBFactory，项目又不允许为单测新增依赖）。唯一额外要桩的是
 * localStorage —— 主题落在 localStorage 而不是 IndexedDB（见仓储文件头注释），
 * jsdom 自带，直接用它来验「空库不补种 / 无 key 才补种」。
 *
 * 这里锁的是 mock 与 api 必须一致的契约细节：
 *   · 三档列表互不重叠，草稿对非编辑是「不存在」；
 *   · 只有进行中且未截止的主题能投稿/撤回，每人每主题上限 3 件，重复投稿 CONFLICT；
 *   · 只有本人作品、且是已发布作品能投稿；
 *   · 已入选不能撤回；主题结束后不能撤回；
 *   · 精选只在「未入选 → 入选」时写一条通知（改评语/重复点选不发第二条），
 *     通知 id 固定，取消后重新精选仍然只有一条；
 *   · 建期/改期的校验（slug 唯一、同时只能一期 active、时间窗、字数）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
// AppError 同时需要「值」（toBeInstanceOf）与「类型」（failure 的返回类型）。
// 运行时那份由下面的 await import 拿，类型这份只能走 import type，
// 否则 TS 会把 `as AppError` 当成值用在类型位置（TS2749）。
import type { AppError as AppErrorType, ThemeInput } from '@/data/contracts'
import type { Photo } from '@/domain/types'
import { makePhoto, makeProfile } from './fixtures'

/** 桩表的行类型：故意用 object 而不是 Record<string, unknown>，
 * 这样 makePhoto() 造出来的 Photo 可以直接 put 进来（接口没有索引签名）。 */
type Row = object

const h = vi.hoisted(() => {
  /** store → (主键 JSON → 行) */
  const stores = new Map<string, Map<string, Row>>()
  const keyPaths: Record<string, string> = {
    photos: 'id',
    profiles: 'id',
    notifications: 'id',
  }

  function table(store: string): Map<string, Row> {
    let existing = stores.get(store)
    if (!existing) {
      existing = new Map<string, Row>()
      stores.set(store, existing)
    }
    return existing
  }

  return {
    /** 当前登录者；null = 未登录 */
    session: {
      value: null as { userId: string; role: string; username: string; displayName: string } | null,
    },
    reset() {
      stores.clear()
    },
    db: {
      async get(store: string, key: unknown): Promise<Row | undefined> {
        return table(store).get(JSON.stringify(key))
      },
      async put(store: string, value: Row): Promise<string> {
        const path = keyPaths[store]
        if (!path) throw new Error(`测试桩不认识这个 store：${store}`)
        const key = JSON.stringify((value as Record<string, unknown>)[path])
        table(store).set(key, value)
        return key
      },
      async delete(store: string, key: unknown): Promise<void> {
        table(store).delete(JSON.stringify(key))
      },
      async getAll(store: string): Promise<Row[]> {
        return [...table(store).values()]
      },
    },
  }
})

vi.mock('@/data/mock/db', () => ({
  getDb: () => Promise.resolve(h.db),
  bumpDataVersion: () => Promise.resolve(0),
}))

vi.mock('@/data/mock/repositories/auth', () => ({
  mockAuthRepository: { getSession: () => Promise.resolve(h.session.value) },
}))

const { mockThemeRepository, resetMockThemes } = await import('@/data/mock/repositories/themes')
const { AppError, ErrorCodes } = await import('@/data/contracts')

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.now()
const at = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString()

const EDITOR = { userId: 'ed', role: 'editor', username: 'editor', displayName: '编辑' }
const AUTHOR = { userId: 'u1', role: 'user', username: 'me', displayName: '我' }

/** 期望这个 Promise 以 AppError 失败，并把错误交回来查 code */
async function failure(promise: Promise<unknown>): Promise<AppErrorType> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    return error as AppErrorType
  }
  throw new Error('预期抛错，但调用成功了')
}

async function putPhoto(
  id: string,
  authorId = AUTHOR.userId,
  overrides: Partial<Photo> = {},
): Promise<void> {
  await h.db.put('photos', makePhoto(id, { authorId, ...overrides }))
}

function baseInput(overrides: Partial<ThemeInput> = {}): ThemeInput {
  return {
    slug: 'week-1',
    title: '第一周',
    description: '本期主题',
    rules: '一人最多 3 件',
    status: 'active',
    startsAt: at(-1),
    endsAt: at(1),
    ...overrides,
  }
}

beforeEach(() => {
  h.reset()
  // resetMockThemes 写的是「空库」而不是删 key：删了下次读取会重新补种，
  // 于是「刚清干净又冒出两个演示主题」。
  resetMockThemes()
  h.session.value = EDITOR
})

describe('主题列表与详情', () => {
  it('无本地数据时补种一期进行中 + 一期往期，且三档互不重叠', async () => {
    localStorage.removeItem('gy:themes')
    await putPhoto('p1')

    const active = await mockThemeRepository.list('active')
    const past = await mockThemeRepository.list('past')
    const upcoming = await mockThemeRepository.list('upcoming')

    expect(active.map((theme) => theme.slug)).toEqual(['autumn-light'])
    expect(past.map((theme) => theme.slug)).toEqual(['city-night'])
    expect(upcoming).toEqual([])
    // 列表给的是 ThemeSummary，长文本字段不能混进来（列表页用不到，也不该把 1000 字规则带出去）
    expect(past[0]).not.toHaveProperty('resultNote')
    const detail = await mockThemeRepository.get('city-night')
    expect(detail.resultNote).toContain('本期共收到 12 件投稿')
    expect(detail.isOpen).toBe(false)
  })

  it('self-seeded 投稿只有已发布作品计入 entryCount，精选计入 selectedCount', async () => {
    localStorage.removeItem('gy:themes')
    await putPhoto('p1')
    await putPhoto('p2')

    const detail = await mockThemeRepository.get('city-night')
    // 两件作品时：往期取 2 件，其中 min(2,2)=2 件精选
    expect(detail.entryCount).toBe(2)
    expect(detail.selectedCount).toBe(2)
  })

  it('草稿对非编辑是「不存在」，编辑能读到', async () => {
    await putPhoto('p1')
    const created = await mockThemeRepository.createTheme(baseInput({ slug: 'draft-1', status: 'draft' }))

    h.session.value = AUTHOR
    const error = await failure(mockThemeRepository.get('draft-1'))
    expect(error.code).toBe(ErrorCodes.NOT_FOUND)
    expect((await mockThemeRepository.list('active')).some((t) => t.slug === 'draft-1')).toBe(false)

    h.session.value = EDITOR
    const detail = await mockThemeRepository.get(created.slug)
    expect(detail.status).toBe('draft')
    expect(detail.isOpen).toBe(false)
  })

  it('不存在的 slug 报 NOT_FOUND', async () => {
    const error = await failure(mockThemeRepository.get('nope'))
    expect(error.code).toBe(ErrorCodes.NOT_FOUND)
  })
})

describe('投稿与撤回', () => {
  it('本人已发布作品可以投稿，重复投稿 CONFLICT，超过 3 件 LIMIT_EXCEEDED', async () => {
    await mockThemeRepository.createTheme(baseInput())
    for (const id of ['p1', 'p2', 'p3', 'p4']) await putPhoto(id)
    h.session.value = AUTHOR

    const first = await mockThemeRepository.submitEntry('week-1', 'p1')
    expect(first.entryCount).toBe(1)
    expect(first.photoId).toBe('p1')

    const conflict = await failure(mockThemeRepository.submitEntry('week-1', 'p1'))
    expect(conflict.code).toBe(ErrorCodes.CONFLICT)
    expect(conflict.message).toBe('这件作品已经在主题里了')

    await mockThemeRepository.submitEntry('week-1', 'p2')
    await mockThemeRepository.submitEntry('week-1', 'p3')
    const overflow = await failure(mockThemeRepository.submitEntry('week-1', 'p4'))
    expect(overflow.code).toBe(ErrorCodes.LIMIT_EXCEEDED)
    expect(overflow.message).toContain('最多投稿 3 件')
  })

  it('别人的作品、草稿作品、不存在的作品都投不进去', async () => {
    await mockThemeRepository.createTheme(baseInput())
    await putPhoto('mine')
    await putPhoto('theirs', 'u2')
    await putPhoto('unpublished', AUTHOR.userId, { status: 'draft' })
    h.session.value = AUTHOR

    const foreign = await failure(mockThemeRepository.submitEntry('week-1', 'theirs'))
    expect(foreign.code).toBe(ErrorCodes.FORBIDDEN)
    expect((await failure(mockThemeRepository.submitEntry('week-1', 'unpublished'))).code).toBe(
      ErrorCodes.VALIDATION,
    )
    expect((await failure(mockThemeRepository.submitEntry('week-1', 'ghost'))).code).toBe(
      ErrorCodes.NOT_FOUND,
    )
  })

  it('未登录不能投稿，已截止的主题不能投稿', async () => {
    await mockThemeRepository.createTheme(baseInput())
    await putPhoto('p1')
    h.session.value = null
    expect((await failure(mockThemeRepository.submitEntry('week-1', 'p1'))).code).toBe(
      ErrorCodes.UNAUTHORIZED,
    )

    h.session.value = EDITOR
    await mockThemeRepository.createTheme(
      baseInput({ slug: 'old-1', status: 'draft', startsAt: at(-10), endsAt: at(-3) }),
    )
    const { id } = await mockThemeRepository.createTheme(
      baseInput({ slug: 'week-2', status: 'draft', startsAt: at(-2), endsAt: at(-1) }),
    )
    await mockThemeRepository.updateTheme(id, { status: 'closed' })
    h.session.value = AUTHOR
    const closed = await failure(mockThemeRepository.submitEntry('week-2', 'p1'))
    expect(closed.code).toBe(ErrorCodes.FORBIDDEN)
    expect(closed.message).toContain('不在投稿期内')
  })

  it('撤回移除投稿；已入选撤不回；主题结束后撤不回', async () => {
    await mockThemeRepository.createTheme(baseInput())
    for (const id of ['p1', 'p2']) await putPhoto(id)
    h.session.value = AUTHOR
    await mockThemeRepository.submitEntry('week-1', 'p1')
    await mockThemeRepository.submitEntry('week-1', 'p2')

    await mockThemeRepository.withdrawEntry('week-1', 'p1')
    expect(await mockThemeRepository.myEntries('week-1')).toHaveLength(1)

    h.session.value = EDITOR
    await mockThemeRepository.selectEntry('week-1', 'p2', { selected: true, note: '入选' })
    h.session.value = AUTHOR
    const selected = await failure(mockThemeRepository.withdrawEntry('week-1', 'p2'))
    expect(selected.code).toBe(ErrorCodes.FORBIDDEN)
    expect(selected.message).toContain('已入选')

    // 关闭主题后再撤：投稿人自己也不行
    h.session.value = EDITOR
    const list = await mockThemeRepository.adminList()
    const theme = list.find((item) => item.slug === 'week-1')
    await mockThemeRepository.updateTheme(theme!.id, { status: 'closed' })
    h.session.value = AUTHOR
    const closed = await failure(mockThemeRepository.withdrawEntry('week-1', 'p2'))
    expect(closed.code).toBe(ErrorCodes.FORBIDDEN)
  })

  it('只有投稿人可以撤回', async () => {
    await mockThemeRepository.createTheme(baseInput())
    await putPhoto('p1')
    h.session.value = AUTHOR
    await mockThemeRepository.submitEntry('week-1', 'p1')

    h.session.value = { userId: 'u2', role: 'user', username: 'other', displayName: '别人' }
    const error = await failure(mockThemeRepository.withdrawEntry('week-1', 'p1'))
    expect(error.code).toBe(ErrorCodes.FORBIDDEN)
    expect(error.message).toContain('只有投稿人可以撤回')
  })
})

describe('投稿列表', () => {
  it('精选在前、其余按投稿时间倒序，游标翻页不重不漏', async () => {
    await mockThemeRepository.createTheme(baseInput())
    for (const id of ['p1', 'p2', 'p3']) await putPhoto(id)
    h.session.value = AUTHOR
    await mockThemeRepository.submitEntry('week-1', 'p1')
    await mockThemeRepository.submitEntry('week-1', 'p2')
    await mockThemeRepository.submitEntry('week-1', 'p3')

    h.session.value = EDITOR
    await mockThemeRepository.selectEntry('week-1', 'p3', { selected: true })

    const first = await mockThemeRepository.listEntries('week-1', { limit: 2, offset: 0 })
    expect(first.total).toBe(3)
    expect(first.nextOffset).toBe(2)
    expect(first.items[0]?.photoId).toBe('p3') // 精选永远排第一
    expect(first.items[0]?.isSelected).toBe(true)

    const second = await mockThemeRepository.listEntries('week-1', { limit: 2, offset: 2 })
    expect(second.items).toHaveLength(1)
    expect(second.nextOffset).toBeNull()

    const onlySelected = await mockThemeRepository.listEntries('week-1', { selectedOnly: true })
    expect(onlySelected.items.map((item) => item.photoId)).toEqual(['p3'])
  })

  it('下架/删除的作品不再出现在列表与计数里', async () => {
    await mockThemeRepository.createTheme(baseInput())
    await putPhoto('p1')
    h.session.value = AUTHOR
    await mockThemeRepository.submitEntry('week-1', 'p1')

    h.session.value = EDITOR
    await h.db.put('photos', makePhoto('p1', { status: 'draft' }))
    const page = await mockThemeRepository.listEntries('week-1')
    expect(page.items).toEqual([])
    const detail = await mockThemeRepository.get('week-1')
    expect(detail.entryCount).toBe(0)

    await h.db.put('photos', makePhoto('p1', { deletedAt: at(-1) }))
    expect((await mockThemeRepository.listEntries('week-1')).total).toBe(0)
  })

  it('投稿行联出作者名与缩略图字段', async () => {
    await mockThemeRepository.createTheme(baseInput())
    await putPhoto('p1', AUTHOR.userId, { title: '海边的清晨', thumbKey: 'p1-t.jpg' })
    await h.db.put('profiles', makeProfile({ id: AUTHOR.userId, username: 'me', displayName: '我' }))
    h.session.value = AUTHOR
    await mockThemeRepository.submitEntry('week-1', 'p1')

    const page = await mockThemeRepository.listEntries('week-1')
    expect(page.items[0]).toMatchObject({
      photoId: 'p1',
      title: '海边的清晨',
      authorUsername: 'me',
      authorDisplayName: '我',
      thumbKey: 'p1-t.jpg',
      isSelected: false,
      note: '',
    })
  })
})

describe('精选', () => {
  it('精选写一条通知，重复精选不叠加，取消后重新精选仍是一条', async () => {
    await mockThemeRepository.createTheme(baseInput())
    await putPhoto('p1')
    h.session.value = AUTHOR
    await mockThemeRepository.submitEntry('week-1', 'p1')

    h.session.value = EDITOR
    const result = await mockThemeRepository.selectEntry('week-1', 'p1', {
      selected: true,
      note: '层次好',
    })
    expect(result).toEqual({ isSelected: true, selectedCount: 1 })

    const notifications = await h.db.getAll('notifications')
    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toMatchObject({
      userId: AUTHOR.userId,
      kind: 'system',
      photoId: 'p1',
      readAt: null,
      meta: { kind: 'theme_selected', themeSlug: 'week-1', themeTitle: '第一周' },
    })

    // 已入选再点一次（含改评语）：不写第二条通知
    await mockThemeRepository.selectEntry('week-1', 'p1', { selected: true, note: '改了评语' })
    expect(await h.db.getAll('notifications')).toHaveLength(1)

    const entry = (await mockThemeRepository.listEntries('week-1')).items[0]
    expect(entry?.note).toBe('改了评语')

    const off = await mockThemeRepository.selectEntry('week-1', 'p1', { selected: false })
    expect(off.isSelected).toBe(false)
    const afterDeselect = (await mockThemeRepository.listEntries('week-1')).items[0]
    expect(afterDeselect?.selectedAt).toBeNull()
    expect(afterDeselect?.note).toBe('改了评语') // 取消精选保留评语

    await mockThemeRepository.selectEntry('week-1', 'p1', { selected: true })
    expect(await h.db.getAll('notifications')).toHaveLength(1) // 固定 id，覆盖不新增
  })

  it('非编辑不能精选，评语超长报 VALIDATION，不在主题里的作品报 NOT_FOUND', async () => {
    await mockThemeRepository.createTheme(baseInput())
    await putPhoto('p1')
    h.session.value = AUTHOR
    await mockThemeRepository.submitEntry('week-1', 'p1')
    expect((await failure(mockThemeRepository.selectEntry('week-1', 'p1', { selected: true }))).code).toBe(
      ErrorCodes.FORBIDDEN,
    )

    h.session.value = EDITOR
    expect(
      (
        await failure(
          mockThemeRepository.selectEntry('week-1', 'p1', {
            selected: true,
            note: 'x'.repeat(201),
          }),
        )
      ).code,
    ).toBe(ErrorCodes.VALIDATION)
    expect(
      (await failure(mockThemeRepository.selectEntry('week-1', 'ghost', { selected: true }))).code,
    ).toBe(ErrorCodes.NOT_FOUND)
  })

  it('取消精选不删通知（作者看得到「曾入选」这件事）', async () => {
    await mockThemeRepository.createTheme(baseInput())
    await putPhoto('p1')
    h.session.value = AUTHOR
    await mockThemeRepository.submitEntry('week-1', 'p1')
    h.session.value = EDITOR
    await mockThemeRepository.selectEntry('week-1', 'p1', { selected: true })
    await mockThemeRepository.selectEntry('week-1', 'p1', { selected: false })
    expect(await h.db.getAll('notifications')).toHaveLength(1)
  })
})

describe('建期与改期（仅编辑）', () => {
  it('非 staff 一律 FORBIDDEN', async () => {
    h.session.value = AUTHOR
    expect((await failure(mockThemeRepository.createTheme(baseInput()))).code).toBe(
      ErrorCodes.FORBIDDEN,
    )
    expect((await failure(mockThemeRepository.adminList())).code).toBe(ErrorCodes.FORBIDDEN)
    expect((await failure(mockThemeRepository.updateTheme('x', { title: 'y' }))).code).toBe(
      ErrorCodes.FORBIDDEN,
    )
  })

  it('slug 重复、第二个进行中、非法 slug、封面不合规都会被挡住', async () => {
    await mockThemeRepository.createTheme(baseInput({ slug: 'week-1', status: 'draft' }))
    const duplicated = await failure(
      mockThemeRepository.createTheme(baseInput({ slug: 'week-1', status: 'draft' })),
    )
    expect(duplicated.code).toBe(ErrorCodes.CONFLICT)

    await mockThemeRepository.createTheme(baseInput({ slug: 'week-2', status: 'active' }))
    const secondActive = await failure(
      mockThemeRepository.createTheme(baseInput({ slug: 'week-3', status: 'active' })),
    )
    expect(secondActive.code).toBe(ErrorCodes.CONFLICT)
    expect(secondActive.message).toContain('进行中')

    // 封面必须是本主题的投稿：用 draft 隔离这条规则（active 会先撞上「只能有一期进行中」）
    expect(
      (
        await failure(
          mockThemeRepository.createTheme(
            baseInput({ slug: 'week-4', status: 'draft', coverPhotoId: 'p1' }),
          ),
        )
      ).code,
    ).toBe(ErrorCodes.VALIDATION)
    expect((await failure(mockThemeRepository.createTheme(baseInput({ slug: 'Bad Slug' })))).code).toBe(
      ErrorCodes.VALIDATION,
    )
  })

  it('改期不能改 slug，结束时间必须晚于开始时间，active 只能有一期', async () => {
    const created = await mockThemeRepository.createTheme(baseInput({ slug: 'week-1' }))
    const renamed = await failure(
      mockThemeRepository.updateTheme(created.id, { slug: 'week-1-renamed' }),
    )
    expect(renamed.code).toBe(ErrorCodes.VALIDATION)
    expect(renamed.message).toContain('不能修改')

    const broken = await failure(
      mockThemeRepository.updateTheme(created.id, { startsAt: at(3), endsAt: at(1) }),
    )
    expect(broken.code).toBe(ErrorCodes.VALIDATION)
    expect(broken.message).toContain('结束时间必须晚于开始时间')

    const other = await mockThemeRepository.createTheme(
      baseInput({ slug: 'week-2', status: 'draft' }),
    )
    const clashed = await failure(mockThemeRepository.updateTheme(other.id, { status: 'active' }))
    expect(clashed.code).toBe(ErrorCodes.CONFLICT)
  })

  it('改期能改文案与状态，adminList 给草稿也看得见', async () => {
    const created = await mockThemeRepository.createTheme(
      baseInput({ slug: 'week-1', status: 'draft' }),
    )
    await mockThemeRepository.updateTheme(created.id, { title: '改过的标题', rules: '新规则' })
    const list = await mockThemeRepository.adminList()
    expect(list.map((theme) => theme.slug)).toContain('week-1')
    const detail = await mockThemeRepository.get('week-1')
    expect(detail.title).toBe('改过的标题')
    expect(detail.rules).toBe('新规则')

    const closed = await mockThemeRepository.updateTheme(created.id, {
      status: 'closed',
      resultNote: '这期结束了',
    })
    expect(closed.status).toBe('closed')
    expect((await mockThemeRepository.get('week-1')).resultNote).toBe('这期结束了')
  })

  it('我的投稿只返回本人的行', async () => {
    await mockThemeRepository.createTheme(baseInput())
    await putPhoto('p1', AUTHOR.userId)
    await putPhoto('p2', 'u2')
    h.session.value = AUTHOR
    await mockThemeRepository.submitEntry('week-1', 'p1')
    h.session.value = { userId: 'u2', role: 'user', username: 'other', displayName: '别人' }
    await mockThemeRepository.submitEntry('week-1', 'p2')

    h.session.value = AUTHOR
    const mine = await mockThemeRepository.myEntries('week-1')
    expect(mine.map((entry) => entry.photoId)).toEqual(['p1'])
    expect(mine[0]?.title).toBe('p1')

    h.session.value = null
    expect((await failure(mockThemeRepository.myEntries('week-1'))).code).toBe(
      ErrorCodes.UNAUTHORIZED,
    )
  })
})
