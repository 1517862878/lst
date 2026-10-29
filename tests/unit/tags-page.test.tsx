/**
 * 标签总览页 /tags 单测（src/pages/TagsPage.tsx）。
 *
 * 页面只负责「取数 + 分派四种状态 + 组合成两段结构」，所以 hooks 与 PhotoGrid 都用桩：
 * 真正要锁的是装载/空/错误三态的文案与交互、以及热门云按比例分档（绝对计数会随库大小漂移）。
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TagSummary } from '@/data/contracts'

const mocks = vi.hoisted(() => ({
  hot: {} as Record<string, unknown>,
  latest: {} as Record<string, unknown>,
  refetchHot: vi.fn(),
  refetchLatest: vi.fn(),
}))

vi.mock('@/hooks/useTags', () => ({
  useTags: (query: { sort: string }) =>
    query.sort === 'hot'
      ? { ...mocks.hot, refetch: mocks.refetchHot }
      : { ...mocks.latest, refetch: mocks.refetchLatest },
  useTagDetail: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
  useTagPhotos: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
  useTagSuggestions: () => ({ items: [], loading: false }),
}))

const { TagsPage } = await import('@/pages/TagsPage')

const tag = (name: string, photoCount: number, authorCount = 1): TagSummary => ({
  tag: name,
  photoCount,
  authorCount,
  latestPublishedAt: '2026-02-01T00:00:00.000Z',
})

function setHot(overrides: Record<string, unknown>) {
  mocks.hot = { data: [], isLoading: false, isError: false, error: null, ...overrides }
}

function setLatest(overrides: Record<string, unknown>) {
  mocks.latest = { data: [], isLoading: false, isError: false, error: null, ...overrides }
}

beforeEach(() => {
  setHot({})
  setLatest({})
  mocks.refetchHot.mockReset()
  mocks.refetchLatest.mockReset()
})

afterEach(cleanup)

function renderPage() {
  return render(
    <MemoryRouter>
      <TagsPage />
    </MemoryRouter>,
  )
}

describe('TagsPage', () => {
  it('热门标签渲染成可点链接，并按相对计数分档', () => {
    setHot({ data: [tag('夜景', 100), tag('城市', 50), tag('街拍', 5)] })
    setLatest({ data: [tag('夜景', 100, 3)] })
    const { container } = renderPage()

    // 只看「热门标签」列表（最新标签段也会渲染同名链接）
    const hotList = screen.getByRole('list', { name: '热门标签' })
    const links = within(hotList).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('data-tag'))).toEqual(['夜景', '城市', '街拍'])
    expect(links[0]).toHaveAttribute('href', '/tags/%E5%A4%9C%E6%99%AF')

    // 100/100 → lg；50/100 → md；5/100 → sm
    expect(links[0]).toHaveClass('g-tag-chip-lg')
    expect(links[1]).toHaveClass('g-tag-chip-md')
    expect(links[2]).toHaveClass('g-tag-chip-sm')
    expect(container.querySelector('.g-tag-cloud')).not.toBeNull()
  })

  it('最新标签段显示作品数 / 作者数 / 最近更新时间', () => {
    setHot({ data: [tag('夜景', 3)] })
    setLatest({ data: [tag('夜景', 3, 2)] })
    renderPage()

    expect(screen.getByRole('heading', { name: '最新标签' })).toBeInTheDocument()
    const item = screen.getByRole('list', { name: '最新标签' })
    expect(item).toHaveTextContent('3 件作品')
    expect(item).toHaveTextContent('2 位作者')
    expect(item).toHaveTextContent(/更新于/)
  })

  it('装载中显示骨架，且不出现假标签链接', () => {
    setHot({ isLoading: true })
    setLatest({ isLoading: true })
    const { container } = renderPage()

    expect(screen.queryByRole('list', { name: '热门标签' })).not.toBeInTheDocument()
    expect(container.querySelector('.g-tag-cloud')).not.toBeNull()
    expect(screen.queryAllByRole('link', { name: /#/ })).toHaveLength(0)
  })

  it('全站没有标签时给出空状态与两个出口', () => {
    renderPage()
    expect(screen.getByText('还没有标签')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '去发布作品' })).toHaveAttribute('href', '/publish')
    expect(screen.getByRole('link', { name: '浏览作品墙' })).toHaveAttribute('href', '/gallery')
  })

  it('热门加载失败时显示错误并可重试', async () => {
    setHot({ isError: true, error: new Error('boom') })
    setLatest({ data: [tag('夜景', 1)] })
    renderPage()

    expect(screen.getByText('热门标签加载失败')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: /重试/ }))
    await waitFor(() => expect(mocks.refetchHot).toHaveBeenCalledTimes(1))
  })

  it('最新标签为空（但热门有数据）时只占位不报错', () => {
    setHot({ data: [tag('夜景', 1)] })
    setLatest({ data: [] })
    renderPage()
    expect(screen.getByText('暂时没有最近更新的标签。')).toBeInTheDocument()
  })
})
