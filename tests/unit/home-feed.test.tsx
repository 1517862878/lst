/**
 * 首页「发现 / 关注」双 Tab 与热门标签区块单测（src/pages/HomePage.tsx）。
 *
 * 8.3c 把两个入口从普通链接升级成 tablist（role=tab + aria-selected + 左右方向键），
 * URL 参数也从 ?feed=following 换成 ?tab=following。这里锁住三件事：
 *   1) URL → 选中态（收藏/刷新能还原）；
 *   2) 键盘左右键能切换（tablist 的可达性底线）；
 *   3) 关注视图的四种状态（未登录 / 加载 / 空 / 失败）不能混成一片空白。
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Photo } from '@/domain/types'

const mocks = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  sessionLoading: false,
  feed: {} as Record<string, unknown>,
  hotTags: {} as Record<string, unknown>,
  featured: [] as Photo[],
  newAuthors: [] as unknown[],
}))

vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>()
  return { ...actual, dataSource: () => 'mock' }
})

vi.mock('@/hooks/useContent', () => ({
  usePhotos: () => ({ data: { pages: [{ items: [] }] }, isLoading: false, isError: false, refetch: vi.fn() }),
  useWeeklyRanking: () => ({ data: { entries: [] }, isLoading: false, isError: false, refetch: vi.fn() }),
  useArticles: () => ({ data: { items: [] }, isLoading: false, isError: false, refetch: vi.fn() }),
  useCategories: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}))

vi.mock('@/hooks/usePhotos', () => ({
  usePhotos: () => ({
    data: { pages: [{ items: [] }] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  usePhoto: () => ({ data: undefined }),
}))

vi.mock('@/hooks/useTags', () => ({
  useTags: () => mocks.hotTags,
  useTagDetail: () => ({ data: undefined, refetch: vi.fn() }),
  useTagPhotos: () => ({ data: undefined, refetch: vi.fn() }),
  useTagSuggestions: () => ({ items: [], loading: false }),
}))

vi.mock('@/hooks/useSocial', () => ({
  useFeed: () => mocks.feed,
}))

// 8.4d 起 HomePage 顶部有「本周主题」条（ThemeSpotlight → useThemes）。本文件测的是
// 双 Tab 与热门标签，主题条一律当作「没有进行中的主题」——那一块不渲染，断言才只落在
// 本文件关心的区块上（主题条本身由 tests/unit/themes-pages.test.tsx 覆盖）。
vi.mock('@/hooks/useThemes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useThemes')>()),
  useThemes: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
}))

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({ data: mocks.session, isLoading: mocks.sessionLoading }),
}))

// 发现区的两个新块各有自己的请求；这里统一按「空数据」返回——空数据时整块隐藏，
// 正好也让本文件专注在 Tab 与热门标签上（发现区另有独立测试文件）。
vi.mock('@/hooks/useDiscover', () => ({
  useFeaturedPhotos: () => ({
    data: mocks.featured,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useNewAuthors: () => ({
    data: mocks.newAuthors,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useHotSearches: () => ({ data: [], isLoading: false, isError: false }),
  useSetEditorChoice: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/features/photos/PhotoCard', () => ({
  PhotoCard: (props: { photo: Photo }) => (
    <article data-testid="photo-card" data-id={props.photo.id}>
      {props.photo.title}
    </article>
  ),
}))

const { HomePage } = await import('@/pages/HomePage')

function photo(id: string): Photo {
  return {
    id,
    authorId: 'u1',
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
    imageKey: `${id}.jpg`,
    thumbKey: `${id}-thumb.jpg`,
    width: 1600,
    height: 1067,
    blurhash: null,
    license: 'cc_by',
    status: 'published',
    likeCount: 0,
    commentCount: 0,
    favoriteCount: 0,
    viewCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    publishedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    credit: null,
  }
}

beforeEach(() => {
  mocks.session = null
  mocks.sessionLoading = false
  mocks.feed = {
    data: { pages: [{ items: [] }] },
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    error: null,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
  }
  mocks.hotTags = {
    data: [
      { tag: '夜景', photoCount: 12, authorCount: 3, latestPublishedAt: null },
      { tag: '城市', photoCount: 4, authorCount: 2, latestPublishedAt: null },
    ],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }
  mocks.featured = []
  mocks.newAuthors = []
})

afterEach(cleanup)

function renderHome(url = '/') {
  render(
    <MemoryRouter initialEntries={[url]}>
      <HomePage />
    </MemoryRouter>,
  )
}

describe('HomePage · 发现 / 关注 双 Tab', () => {
  it('默认是「发现」，tablist 里只有当前项 aria-selected=true 且可聚焦', () => {
    renderHome()
    const tablist = screen.getByRole('tablist', { name: '首页内容' })
    const tabs = screen.getAllByRole('tab')
    expect(tablist).toContainElement(tabs[0]!)
    expect(tabs.map((tab) => tab.textContent)).toEqual(['发现', '关注'])

    const [discover, following] = tabs
    expect(discover).toHaveAttribute('aria-selected', 'true')
    expect(discover).toHaveAttribute('tabindex', '0')
    expect(discover).toHaveAttribute('href', '/')
    expect(following).toHaveAttribute('aria-selected', 'false')
    // roving tabindex：未选中的 Tab 不进入 Tab 键序列，但方向键能到达
    expect(following).toHaveAttribute('tabindex', '-1')
    expect(following).toHaveAttribute('href', '/?tab=following')
    expect(screen.getByRole('heading', { name: '本周精选' })).toBeInTheDocument()
  })

  it('?tab=following 切到关注视图，发现区不渲染', () => {
    renderHome('/?tab=following')
    expect(screen.getByRole('tab', { name: '关注' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: '关注动态' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '本周精选' })).not.toBeInTheDocument()
  })

  it('老的 ?feed=following 书签被重定向到 ?tab=following，不静默落到发现页', async () => {
    renderHome('/?feed=following')
    expect(await screen.findByRole('heading', { name: '关注动态' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '关注' })).toHaveAttribute('aria-selected', 'true')
  })

  it('键盘左右键在 tablist 内切换并激活（自动激活）', async () => {
    const user = userEvent.setup()
    renderHome()

    const discover = screen.getByRole('tab', { name: '发现' })
    discover.focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: '关注' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: '关注动态' })).toBeInTheDocument()

    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: '发现' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: '本周精选' })).toBeInTheDocument()
  })

  it('关注视图未登录时给登录入口（回跳参数带回首页关注 Tab）', () => {
    mocks.session = null
    renderHome('/?tab=following')
    expect(screen.getByText(/登录后这里会显示你关注的作者/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '去登录' })).toHaveAttribute(
      'href',
      '/login?next=%2F%3Ftab%3Dfollowing',
    )
  })

  it('关注视图已登录且有数据时渲染作品并去重（游标翻页的重复项只留一张）', () => {
    mocks.session = { userId: 'u1', username: 'me' }
    mocks.feed = {
      data: { pages: [{ items: [photo('p1'), photo('p2')] }, { items: [photo('p1')] }] },
      isLoading: false,
      hasNextPage: true,
      isFetchingNextPage: false,
      error: null,
      refetch: vi.fn(),
      fetchNextPage: vi.fn(),
    }
    renderHome('/?tab=following')

    const cards = screen.getAllByTestId('photo-card')
    expect(cards.map((card) => card.getAttribute('data-id'))).toEqual(['p1', 'p2'])
  })

  it('关注视图已登录但为空时给两个出口（作品墙 / 周榜）', () => {
    mocks.session = { userId: 'u1', username: 'me' }
    renderHome('/?tab=following')

    expect(screen.getByText('关注动态还是空的')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '去作品墙发现作者' })).toHaveAttribute('href', '/gallery')
    expect(screen.getByRole('link', { name: '看看周榜' })).toHaveAttribute('href', '/rankings/weekly')
  })

  it('关注视图加载失败时显示错误并可重试', () => {
    mocks.session = { userId: 'u1', username: 'me' }
    mocks.feed = {
      data: undefined,
      isLoading: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      error: new Error('boom'),
      refetch: vi.fn(),
      fetchNextPage: vi.fn(),
    }
    renderHome('/?tab=following')
    expect(screen.getByText('作品加载失败')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument()
  })
})

describe('HomePage · 热门标签区块', () => {
  it('渲染热门标签链接（带作品数）并给「全部标签」入口', () => {
    renderHome()
    const list = screen.getByRole('list', { name: '热门标签' })
    const links = screen.getAllByRole('link', { name: /#/ })
    expect(links.map((link) => link.getAttribute('data-tag'))).toEqual(['夜景', '城市'])
    expect(list).toHaveTextContent('12')
    expect(screen.getByRole('link', { name: '全部标签' })).toHaveAttribute('href', '/tags')
  })

  it('没有标签时给「发布作品时填写标签」的提示而不是空区块', () => {
    mocks.hotTags = { data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() }
    renderHome()
    expect(screen.getByText(/还没有标签，发布作品时填写标签即可出现在这里/)).toBeInTheDocument()
  })

  it('标签加载失败时只坏这一块，并提供重试', () => {
    mocks.hotTags = { data: [], isLoading: false, isError: true, error: new Error('boom'), refetch: vi.fn() }
    renderHome()
    expect(screen.getByText('热门标签加载失败')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '本周精选' })).toBeInTheDocument()
  })
})
