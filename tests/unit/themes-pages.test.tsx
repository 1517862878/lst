/**
 * 每周主题页面层单测（8.4d）：/themes 列表、/themes/:slug 详情、
 * 首页主题条（ThemeSpotlight）、审核台主题 Tab（AdminThemesPanel）。
 *
 * 与 admin-page.test.tsx 同一策略：整模块桩掉 @/hooks/useThemes（页面与 hooks 的
 * 分工就是「页面不算数、hooks 负责取数」），这样断言只落在页面的档位切换、
 * 空态、键盘可达的按钮与文案上，不需要网络也不需要 QueryClient。
 *
 * 仍然用真的 domain/themes.ts：档期标签、倒计时、上限文案是页面与仓储共用的口径，
 * 桩掉它等于把「文案对不上」这类回归也一起桩掉了。
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThemeDetail, ThemeEntry, ThemeSummary, MyThemeEntry, Photo, Session } from '@/domain/types'
import { AdminThemesPanel } from '@/features/themes/AdminThemesPanel'
import { ThemeSpotlight } from '@/features/themes/ThemeSpotlight'
import { ThemeDetailPage } from '@/pages/ThemeDetailPage'
import { ThemesPage } from '@/pages/ThemesPage'
import { makePhoto } from './fixtures'

const mocks = vi.hoisted(() => ({
  session: { value: null as Session | null },
  themes: vi.fn(),
  theme: vi.fn(),
  entries: vi.fn(),
  myEntries: vi.fn(),
  adminThemes: vi.fn(),
  photosByUser: vi.fn(),
  submitEntry: vi.fn(),
  withdrawEntry: vi.fn(),
  createTheme: vi.fn(),
  updateTheme: vi.fn(),
  selectEntry: vi.fn(),
  submitAsync: vi.fn(),
  withdrawAsync: vi.fn(),
  selectAsync: vi.fn(),
  createAsync: vi.fn(),
  updateAsync: vi.fn(),
  show: vi.fn(),
}))

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({ data: mocks.session.value, isLoading: false }),
}))

vi.mock('@/components/ui/useToast', () => ({
  useToast: () => ({ show: mocks.show }),
}))

vi.mock('@/hooks/usePhotoImage', () => ({
  usePhotoImage: () => ({ url: null, loading: false }),
}))

vi.mock('@/hooks/usePhotos', () => ({
  usePhotosByUser: (...args: unknown[]) => mocks.photosByUser(...args),
}))

vi.mock('@/hooks/useThemes', () => ({
  useThemes: (...args: unknown[]) => mocks.themes(...args),
  useTheme: (...args: unknown[]) => mocks.theme(...args),
  useThemeEntries: (...args: unknown[]) => mocks.entries(...args),
  useMyThemeEntries: (...args: unknown[]) => mocks.myEntries(...args),
  useAdminThemes: (...args: unknown[]) => mocks.adminThemes(...args),
  useSubmitThemeEntry: () => mocks.submitEntry(),
  useWithdrawThemeEntry: () => mocks.withdrawEntry(),
  useCreateTheme: () => mocks.createTheme(),
  useUpdateTheme: () => mocks.updateTheme(),
  useSelectThemeEntry: () => mocks.selectEntry(),
  flattenThemeEntries: (pages: { items: ThemeEntry[] }[] | undefined) =>
    (pages ?? []).flatMap((page) => page.items),
}))

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.now()
const at = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString()

const SESSION: Session = {
  userId: 'u1',
  username: 'me',
  displayName: '我',
  avatarKey: null,
  role: 'user',
  expiresAt: '2099-01-01T00:00:00.000Z',
}

function query<T>(data: T, overrides: Record<string, unknown> = {}) {
  return {
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  }
}

function infinite(items: ThemeEntry[]) {
  return {
    data: { pages: [{ items, total: items.length, nextOffset: null }], pageParams: [0] },
    isLoading: false,
    isError: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }
}

function mutation(mutateAsync: unknown) {
  return { mutateAsync, isPending: false, isError: false, error: null }
}

/**
 * 主题桩：造的是**详情**（ThemeDetail = ThemeSummary + rules/resultNote/isOpen）。
 * 详情页要用那三个字段，列表页只读摘要字段，所以一个更宽的 helper 两处都能用；
 * 反过来（只造摘要再断言详情字段）就得在每个用例里 as 一次，类型也就失去意义了。
 */
function summary(overrides: Partial<ThemeDetail> = {}): ThemeDetail {
  return {
    id: 't1',
    slug: 'autumn-light',
    title: '秋日光线',
    description: '秋天的侧逆光',
    status: 'active',
    startsAt: at(-1),
    endsAt: at(6),
    coverPhotoId: null,
    entryCount: 0,
    selectedCount: 0,
    rules: '',
    resultNote: '',
    isOpen: false,
    ...overrides,
  }
}

function entry(overrides: Partial<ThemeEntry> = {}): ThemeEntry {
  return {
    photoId: 'p1',
    isSelected: false,
    note: '',
    selectedAt: null,
    submittedAt: at(-1),
    title: '海边日落',
    authorId: 'u1',
    authorUsername: 'me',
    authorDisplayName: '我',
    imageKey: 'p1.jpg',
    thumbKey: 'p1-thumb.jpg',
    likeCount: 3,
    favoriteCount: 1,
    ...overrides,
  }
}

function myEntry(overrides: Partial<MyThemeEntry> = {}): MyThemeEntry {
  return {
    photoId: 'p1',
    title: '海边日落',
    isSelected: false,
    note: '',
    submittedAt: at(-1),
    ...overrides,
  }
}

/** 各档返回什么由用例决定 */
let lists: Record<string, ThemeSummary[]> = {}
let detail: ThemeDetail | null = null
let entries: ThemeEntry[] = []
let selectedEntries: ThemeEntry[] = []
let mine: MyThemeEntry[] = []
let adminList: ThemeSummary[] = []
let myWorks: Photo[] = []

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/"
          element={
            <>
              <ThemeSpotlight />
              <LocationProbe />
            </>
          }
        />
        <Route
          path="/themes"
          element={
            <>
              <ThemesPage />
              <LocationProbe />
            </>
          }
        />
        <Route
          path="/themes/:slug"
          element={
            <>
              <ThemeDetailPage />
              <LocationProbe />
            </>
          }
        />
        <Route path="/admin" element={<AdminThemesPanel />} />
        <Route path="/login" element={<p>登录页</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mocks.session.value = null
  lists = {}
  detail = null
  entries = []
  selectedEntries = []
  mine = []
  adminList = []
  myWorks = []

  mocks.themes.mockReset().mockImplementation((status: string) => query(lists[status] ?? []))
  mocks.theme.mockReset().mockImplementation(() => query(detail))
  mocks.entries
    .mockReset()
    .mockImplementation((_slug: string, options?: { selectedOnly?: boolean }) =>
      infinite(options?.selectedOnly ? selectedEntries : entries),
    )
  mocks.myEntries.mockReset().mockImplementation(() => query(mine))
  mocks.adminThemes.mockReset().mockImplementation(() => query(adminList))
  mocks.photosByUser.mockReset().mockImplementation(() => query(myWorks))
  mocks.submitEntry.mockReset().mockReturnValue(mutation(mocks.submitAsync))
  mocks.withdrawEntry.mockReset().mockReturnValue(mutation(mocks.withdrawAsync))
  mocks.createTheme.mockReset().mockReturnValue(mutation(mocks.createAsync))
  mocks.updateTheme.mockReset().mockReturnValue(mutation(mocks.updateAsync))
  mocks.selectEntry.mockReset().mockReturnValue(mutation(mocks.selectAsync))
  mocks.submitAsync.mockReset()
  mocks.withdrawAsync.mockReset()
  mocks.selectAsync.mockReset()
  mocks.createAsync.mockReset()
  mocks.updateAsync.mockReset()
  mocks.show.mockReset()
})

afterEach(cleanup)

describe('主题列表页', () => {
  it('默认落在「征集中」，卡片给出档期、倒计时与投稿统计', async () => {
    lists = { active: [summary({ entryCount: 3, selectedCount: 1 })] }
    renderAt('/themes')

    expect(mocks.themes).toHaveBeenCalledWith('active')
    expect(await screen.findByRole('tab', { name: '征集中' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    const list = screen.getByRole('list', { name: '征集中的主题' })
    const card = within(list).getByRole('link', { name: /秋日光线/ })
    expect(card).toHaveAttribute('href', '/themes/autumn-light')
    expect(within(card).getByText('秋天的侧逆光')).toBeInTheDocument()
    expect(within(card).getByText('投稿 3 件')).toBeInTheDocument()
    expect(within(card).getByText('精选 1 件')).toBeInTheDocument()
    // 档期标签里带一句倒计时，卡片右侧的 countdown 再重复一次（同一份文案）
    expect(within(card).getAllByText(/还剩 \d+ 天 \d+ 小时/).length).toBeGreaterThan(0)
  })

  it('三档是键盘可切的 tab，切到「往期」按 past 取数并把档位写进 ?tab=', async () => {
    const user = userEvent.setup()
    lists = { past: [summary({ slug: 'city-night', title: '城市夜色', status: 'closed' })] }
    renderAt('/themes')

    const tabs = within(await screen.findByRole('tablist')).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['征集中', '即将开始', '往期'])

    await user.click(screen.getByRole('tab', { name: '往期' }))

    await waitFor(() => expect(mocks.themes).toHaveBeenCalledWith('past'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/themes?tab=past'))
    expect(await screen.findByRole('list', { name: '往期的主题' })).toBeInTheDocument()
  })

  it('带 ?tab=upcoming 直接进来落在「即将开始」，没有排期时给编辑写好的说明', async () => {
    renderAt('/themes?tab=upcoming')

    expect(await screen.findByRole('tab', { name: '即将开始' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(mocks.themes).toHaveBeenCalledWith('upcoming')
    expect(screen.getByText('还没有排期中的主题')).toBeInTheDocument()
    expect(screen.getByText('编辑定下下一期档期后，会先出现在这一档。')).toBeInTheDocument()
  })

  it('加载中先给骨架，出错时给重试入口', async () => {
    mocks.themes.mockReturnValue(query(undefined, { isLoading: true, data: undefined }))
    const view = renderAt('/themes')
    expect(view.container.querySelector('.g-theme-card-body-skeleton')).not.toBeNull()

    cleanup()
    const retry = vi.fn()
    mocks.themes.mockReturnValue(
      query(undefined, { data: undefined, isError: true, error: new Error('boom'), refetch: retry }),
    )
    renderAt('/themes')
    expect(await screen.findByText('主题列表加载失败')).toBeInTheDocument()
  })
})

describe('主题详情页', () => {
  beforeEach(() => {
    detail = summary({
      entryCount: 2,
      selectedCount: 1,
      rules: '一人最多 3 件，已发布作品才能投稿。',
      resultNote: '',
      isOpen: true,
    })
  })

  it('进行中的主题：hero 给档期与投稿入口，精选与全部投稿各列一份', async () => {
    mocks.session.value = SESSION
    entries = [
      entry({ photoId: 'p1', title: '海边日落', isSelected: true, note: '层次好' }),
      entry({ photoId: 'p2', title: '巷口', isSelected: false }),
    ]
    selectedEntries = [entries[0]!]
    renderAt('/themes/autumn-light')

    expect(await screen.findByRole('heading', { level: 1, name: '秋日光线' })).toBeInTheDocument()
    expect(screen.getByText('一人最多 3 件，已发布作品才能投稿。')).toBeInTheDocument()

    // 投稿入口：页头按钮 + 「我的投稿」空态里的入口，两个都指向同一个弹层
    expect(screen.getAllByRole('button', { name: '投稿到主题' })).toHaveLength(2)

    expect(screen.getByRole('list', { name: '编辑精选' })).toBeInTheDocument()
    const all = screen.getByRole('list', { name: '全部投稿' })
    expect(within(all).getAllByRole('listitem')).toHaveLength(2)
    expect(within(all).getByRole('link', { name: '海边日落' })).toHaveAttribute(
      'href',
      '/works/p1',
    )
    // 入选徽标与编辑点评都来自 domain/themes.ts 的口径
    expect(within(all).getAllByText('编辑精选').length).toBeGreaterThan(0)
    expect(within(all).getByText('编辑点评')).toBeInTheDocument()
    // 还没投过：我的投稿给空态而不是上限提示（上限提示只在我投过之后才有意义）
    expect(screen.getByText('你还没有投稿')).toBeInTheDocument()
  })

  it('投稿：弹层里选一件作品，成功后 toast 并关掉弹层', async () => {
    const user = userEvent.setup()
    mocks.session.value = SESSION
    myWorks = [makePhoto('p1', { title: '海边日落' })]
    mocks.submitAsync.mockResolvedValue({ photoId: 'p1', submittedAt: at(0), entryCount: 1 })
    renderAt('/themes/autumn-light')

    await user.click((await screen.findAllByRole('button', { name: '投稿到主题' }))[0]!)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('投稿到「秋日光线」')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '投稿《海边日落》' }))

    await waitFor(() =>
      expect(mocks.submitAsync).toHaveBeenCalledWith({ slug: 'autumn-light', photoId: 'p1' }),
    )
    await waitFor(() =>
      expect(mocks.show).toHaveBeenCalledWith('success', '《海边日落》已投稿到「秋日光线」'),
    )
  })

  it('已投稿的作品在弹层里只显示「已投稿」，不再给重复投稿的按钮', async () => {
    const user = userEvent.setup()
    mocks.session.value = SESSION
    myWorks = [makePhoto('p1', { title: '海边日落' })]
    mine = [myEntry({ photoId: 'p1' })]
    renderAt('/themes/autumn-light')

    await user.click((await screen.findAllByRole('button', { name: '投稿到主题' }))[0]!)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: '《海边日落》已投稿' })).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: '投稿《海边日落》' })).not.toBeInTheDocument()
  })

  it('撤回投稿：调用仓储并 toast，已入选的那件按钮置灰', async () => {
    const user = userEvent.setup()
    mocks.session.value = SESSION
    mine = [
      myEntry({ photoId: 'p1', title: '海边日落' }),
      myEntry({ photoId: 'p2', title: '巷口', isSelected: true }),
    ]
    mocks.withdrawAsync.mockResolvedValue(undefined)
    renderAt('/themes/autumn-light')

    const list = await screen.findByRole('list', { name: '我的投稿' })
    expect(within(list).getByRole('button', { name: '撤回《巷口》投稿' })).toBeDisabled()

    await user.click(within(list).getByRole('button', { name: '撤回《海边日落》投稿' }))

    await waitFor(() =>
      expect(mocks.withdrawAsync).toHaveBeenCalledWith({ slug: 'autumn-light', photoId: 'p1' }),
    )
    await waitFor(() => expect(mocks.show).toHaveBeenCalledWith('success', '已撤回《海边日落》'))
  })

  it('已结束的主题没有投稿入口，撤回按钮说明为什么按不动', async () => {
    mocks.session.value = SESSION
    detail = summary({ status: 'closed', startsAt: at(-24), endsAt: at(-10), isOpen: false })
    mine = [myEntry({ photoId: 'p1' })]
    renderAt('/themes/city-night')

    await screen.findByRole('heading', { level: 1, name: '秋日光线' })
    expect(screen.queryByRole('button', { name: '投稿到主题' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撤回《海边日落》投稿' })).toBeDisabled()
  })

  it('拿不到主题时给「不存在或还没公开」，不泄露草稿标题', async () => {
    mocks.theme.mockReturnValue(query(null, { data: undefined }))
    renderAt('/themes/ghost')

    expect(await screen.findByText('主题不存在或还没公开')).toBeInTheDocument()
  })

  it('未登录只读：没有「我的投稿」区块，精选与投稿照常展示', async () => {
    entries = [entry({ photoId: 'p1', title: '海边日落' })]
    renderAt('/themes/autumn-light')

    expect(await screen.findByText('海边日落')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '我的投稿' })).not.toBeInTheDocument()
    // 未登录也能点：点下去是去登录页，而不是静默失败
    expect(screen.getByRole('button', { name: '投稿到主题' })).toBeInTheDocument()
  })
})

describe('首页「本周主题」条', () => {
  it('有进行中的主题时给一条通往主题详情页的横幅', async () => {
    lists = { active: [summary()] }
    renderAt('/')

    const link = await screen.findByRole('link', { name: /秋日光线/ })
    expect(link).toHaveAttribute('href', '/themes/autumn-light')
    expect(screen.getByRole('heading', { name: '本周主题' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '往期主题' })).toHaveAttribute('href', '/themes')
  })

  it('没有进行中的主题时整块不渲染（首页其余部分不受影响）', async () => {
    renderAt('/')

    await waitFor(() => expect(mocks.themes).toHaveBeenCalledWith('active'))
    expect(screen.queryByRole('heading', { name: '本周主题' })).not.toBeInTheDocument()
  })

  it('主题条取数失败也不报错，安静地留白', async () => {
    mocks.themes.mockReturnValue(query(undefined, { data: undefined, isError: true }))
    renderAt('/')

    await waitFor(() => expect(mocks.themes).toHaveBeenCalled())
    expect(screen.queryByRole('heading', { name: '本周主题' })).not.toBeInTheDocument()
  })
})

describe('审核台主题 Tab', () => {
  it('列出全部主题（含草稿），展开投稿后可以把作品设为精选', async () => {
    const user = userEvent.setup()
    adminList = [
      summary({ entryCount: 1 }),
      summary({ id: 't2', slug: 'draft-week', title: '下一期', status: 'draft' }),
    ]
    entries = [entry({ photoId: 'p1', title: '海边日落' })]
    mocks.selectAsync.mockResolvedValue({ isSelected: true, selectedCount: 1 })
    renderAt('/admin')

    const list = await screen.findByRole('list', { name: '全部主题' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByText('草稿')).toBeInTheDocument()

    await user.click(within(list).getByRole('button', { name: '管理《秋日光线》的投稿' }))

    const entriesList = await screen.findByRole('list', { name: '主题投稿' })
    await user.click(within(entriesList).getByRole('button', { name: '把《海边日落》设为精选' }))

    await waitFor(() =>
      expect(mocks.selectAsync).toHaveBeenCalledWith({
        slug: 'autumn-light',
        photoId: 'p1',
        selected: true,
        note: '',
      }),
    )
    await waitFor(() =>
      expect(mocks.show).toHaveBeenCalledWith(
        'success',
        '已把《海边日落》设为精选，作者会收到通知',
      ),
    )
  })

  it('「新建主题」打开建期表单，标题与本期说明都在', async () => {
    const user = userEvent.setup()
    adminList = [summary()]
    renderAt('/admin')

    await user.click(await screen.findByRole('button', { name: '新建主题' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('新建主题')).toBeInTheDocument()
    expect(within(dialog).getAllByText(/会出现在首页「本周主题」条/).length).toBeGreaterThan(0)
  })

  it('一期主题都没有时给空态与建期入口', async () => {
    renderAt('/admin')

    expect(await screen.findByText('还没有任何主题')).toBeInTheDocument()
    // 顶栏一个 + 空态一个，都指向同一张建期表单
    expect(screen.getAllByRole('button', { name: '新建主题' })).toHaveLength(2)
  })
})
