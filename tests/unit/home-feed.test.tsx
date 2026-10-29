/**
 * 首页「发现 / 关注」双 Feed 与热门标签区块单测（src/pages/HomePage.tsx，8.3a）。
 *
 * 首页是分享率最高的页面，所以 Feed 选择放在 URL（?feed=following）而不是组件状态：
 * 这里锁住「URL → 渲染」与「关注 Feed 的三种状态不能混成一片空白」。
 */
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Photo } from '@/domain/types'

const mocks = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  sessionLoading: false,
  feed: {} as Record<string, unknown>,
  hotTags: {} as Record<string, unknown>,
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

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({ data: mocks.session, isLoading: mocks.sessionLoading }),
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
    error: null,
    refetch: vi.fn(),
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
})

afterEach(cleanup)

function renderHome(url = '/') {
  render(
    <MemoryRouter initialEntries={[url]}>
      <HomePage />
    </MemoryRouter>,
  )
}

describe('HomePage · 双 Feed 切换', () => {
  it('默认是「发现」，两个入口都是真链接且只有当前项带 aria-current', () => {
    renderHome()
    const discover = screen.getByRole('link', { name: '发现' })
    const following = screen.getByRole('link', { name: '关注' })

    expect(discover).toHaveAttribute('href', '/')
    expect(following).toHaveAttribute('href', '/?feed=following')
    expect(discover).toHaveAttribute('aria-current', 'page')
    expect(following).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('heading', { name: '本周精选' })).toBeInTheDocument()
  })

  it('?feed=following 切到关注 Feed，发现段不渲染', () => {
    renderHome('/?feed=following')
    expect(screen.getByRole('link', { name: '关注' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: '关注动态' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '本周精选' })).not.toBeInTheDocument()
  })

  it('关注 Feed 未登录时给登录入口（带回跳参数），不是一句空白', () => {
    mocks.session = null
    renderHome('/?feed=following')
    expect(screen.getByText(/登录后这里会显示你关注的作者/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '去登录' })).toHaveAttribute(
      'href',
      '/login?next=%2F%3Ffeed%3Dfollowing',
    )
  })

  it('关注 Feed 已登录且有数据时渲染作品并去重', () => {
    mocks.session = { userId: 'u1', username: 'me' }
    mocks.feed = {
      data: { pages: [{ items: [photo('p1'), photo('p2')] }, { items: [photo('p1')] }] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }
    renderHome('/?feed=following')

    const cards = screen.getAllByTestId('photo-card')
    expect(cards.map((card) => card.getAttribute('data-id'))).toEqual(['p1', 'p2'])
  })

  it('关注 Feed 已登录但为空时给两个出口（作品墙 / 标签页）', () => {
    mocks.session = { userId: 'u1', username: 'me' }
    renderHome('/?feed=following')

    expect(screen.getByText(/你关注的作者还没有新作品/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '浏览作品墙' })).toHaveAttribute('href', '/gallery')
    expect(screen.getByRole('link', { name: '按标签发现' })).toHaveAttribute('href', '/tags')
  })

  it('关注 Feed 加载失败时显示错误并可重试', () => {
    mocks.session = { userId: 'u1', username: 'me' }
    mocks.feed = { data: undefined, isLoading: false, error: new Error('boom'), refetch: vi.fn() }
    renderHome('/?feed=following')
    expect(screen.getByText('关注动态加载失败')).toBeInTheDocument()
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
