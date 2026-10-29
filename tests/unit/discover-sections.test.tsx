/**
 * 首页「编辑精选 / 新作者」区块单测（8.3c）。
 *
 * 这两个区块的验收点不是「能渲染」，而是**三态 + 空即隐藏**：
 * 无数据不能出现空壳标题（会让人以为功能坏了），加载要有骨架，失败要能重试。
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { NewAuthor, Photo } from '@/domain/types'

const h = vi.hoisted(() => ({
  featured: { data: undefined as { items: Photo[] } | undefined, isLoading: false, isError: false, error: null as unknown, refetch: () => undefined },
  authors: { data: undefined as NewAuthor[] | undefined, isLoading: false, isError: false, error: null as unknown, refetch: () => undefined },
}))

vi.mock('@/hooks/useDiscover', () => ({
  useFeaturedPhotos: () => h.featured,
  useNewAuthors: () => h.authors,
}))

vi.mock('@/features/social/FollowButton', () => ({
  FollowButton: ({ username }: { username: string }) => (
    <button type="button">关注 {username}</button>
  ),
}))

const { FeaturedSection } = await import('@/features/discover/FeaturedSection')
const { NewAuthorsSection } = await import('@/features/discover/NewAuthorsSection')

/** PhotoCard 里的作者链接会发查询，需要 QueryClient（查询失败不影响本文件断言） */
function renderWithProviders(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

function reset() {
  h.featured.data = undefined
  h.featured.isLoading = false
  h.featured.isError = false
  h.featured.error = null
  h.featured.refetch = () => undefined
  h.authors.data = undefined
  h.authors.isLoading = false
  h.authors.isError = false
  h.authors.error = null
  h.authors.refetch = () => undefined
}

function photo(id: string): Photo {
  return {
    id,
    authorId: 'u1',
    title: `作品 ${id}`,
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
    credit: null,
    status: 'published',
    likeCount: 0,
    favoriteCount: 0,
    commentCount: 0,
    viewCount: 0,
    publishedAt: '2026-10-01T00:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    deletedAt: null,
    featuredAt: '2026-10-02T00:00:00.000Z',
  }
}

describe('FeaturedSection', () => {
  it('没有精选时整块不渲染（连标题都没有）', () => {
    reset()
    h.featured.data = { items: [] }
    const { container } = renderWithProviders(<FeaturedSection />)
    expect(container).toBeEmptyDOMElement()
  })

  it('加载中显示骨架，不退化成「无数据」', () => {
    reset()
    h.featured.isLoading = true
    const { container } = renderWithProviders(<FeaturedSection />)
    expect(screen.getByText('编辑精选')).toBeInTheDocument()
    expect(container.querySelector('.g-featured-strip')).toHaveAttribute('aria-hidden', 'true')
  })

  it('失败时给出错误态与重试按钮', () => {
    reset()
    h.featured.isError = true
    const refetch = vi.fn()
    h.featured.refetch = refetch
    renderWithProviders(<FeaturedSection />)
    expect(screen.getByText('编辑精选加载失败')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重试/ }))
    expect(refetch).toHaveBeenCalled()
  })

  it('有数据时每张卡片都带「编辑精选」徽标', () => {
    reset()
    h.featured.data = { items: [photo('p1'), photo('p2')] }
    renderWithProviders(<FeaturedSection />)
    const list = screen.getByRole('list', { name: '编辑精选作品' })
    expect(within(list).getAllByText('编辑精选')).toHaveLength(2)
  })
})

describe('NewAuthorsSection', () => {
  const author = (username: string): NewAuthor => ({
    username,
    displayName: `作者 ${username}`,
    avatarKey: null,
    photoCount: 3,
    likeTotal: 12,
    createdAt: '2026-10-01T00:00:00.000Z',
  })

  it('没有新作者时整块不渲染', () => {
    reset()
    h.authors.data = []
    const { container } = renderWithProviders(<NewAuthorsSection />)
    expect(container).toBeEmptyDOMElement()
  })

  it('展示作品数 / 获赞数，并链接到作者主页与关注按钮', () => {
    reset()
    h.authors.data = [author('alice')]
    renderWithProviders(<NewAuthorsSection />)
    expect(screen.getByText('作者 alice')).toBeInTheDocument()
    expect(screen.getByText('3 件作品 · 共获赞 12')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /作者 alice/ })).toHaveAttribute('href', '/u/alice')
    expect(screen.getByRole('button', { name: '关注 alice' })).toBeInTheDocument()
  })

  it('失败时可见错误态', () => {
    reset()
    h.authors.isError = true
    renderWithProviders(<NewAuthorsSection />)
    expect(screen.getByText('新作者加载失败')).toBeInTheDocument()
  })
})
