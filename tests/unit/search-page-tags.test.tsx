/**
 * 搜索页「标签」Tab + 最近搜索单测（src/pages/SearchPage.tsx，8.3a 增量）。
 *
 * 搜索页的状态全在 URL 上，所以断言都尽量落到「点了之后 URL 变成什么」——
 * 只断言渲染结果会漏掉「刷新后筛选丢失」这类问题。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  tagList: {} as Record<string, unknown>,
  recent: { items: [] as string[], push: vi.fn(), clear: vi.fn() },
  tagListArgs: [] as Array<[string, number]>,
}))

vi.mock('@/hooks/useSearch', () => ({
  useSearch: () => ({
    data: { items: [] },
    isLoading: false,
    isError: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUserSearch: () => ({ data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() }),
}))

vi.mock('@/hooks/useTags', () => ({
  useTagSearchList: (prefix: string, limit: number) => {
    mocks.tagListArgs.push([prefix, limit])
    return { ...mocks.tagList, refetch: vi.fn() }
  },
  useTagSuggestions: () => ({ items: [], loading: false }),
  useTags: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useTagDetail: () => ({ data: undefined, refetch: vi.fn() }),
  useTagPhotos: () => ({ data: undefined, refetch: vi.fn() }),
}))

vi.mock('@/hooks/useRecentSearches', () => ({
  useRecentSearches: () => mocks.recent,
}))

const { SearchPage } = await import('@/pages/SearchPage')

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

function renderPage(url = '/search') {
  render(
    <MemoryRouter initialEntries={[url]}>
      <SearchPage />
      <LocationProbe />
    </MemoryRouter>,
  )
  return screen.getByTestId('location')
}

beforeEach(() => {
  mocks.tagListArgs.length = 0
  mocks.tagList = {
    data: [
      { tag: '夜景', photoCount: 12, authorCount: 3, latestPublishedAt: null },
      { tag: '夜色', photoCount: 2, authorCount: 2, latestPublishedAt: null },
    ],
    isLoading: false,
    error: null,
  }
  mocks.recent = { items: [], push: vi.fn(), clear: vi.fn() }
})

afterEach(cleanup)

describe('SearchPage · 标签 Tab', () => {
  it('点「标签」切换到 tab=tags，并把前缀交给标签搜索端点', async () => {
    const url = renderPage('/search?q=%E5%A4%9C')
    await userEvent.setup().click(screen.getByRole('tab', { name: '标签' }))

    await waitFor(() => expect(url).toHaveTextContent('tab=tags'))
    expect(url).toHaveTextContent('q=%E5%A4%9C')

    const list = await screen.findByRole('list', { name: '标签搜索结果' })
    expect(list).toHaveTextContent('#夜景')
    expect(list).toHaveTextContent('3 位作者')
    expect(mocks.tagListArgs.at(-1)).toEqual(['夜', 50])
  })

  it('标签结果里的标签指向 /tags/:tag', async () => {
    renderPage('/search?tab=tags&q=%E5%A4%9C')
    const link = await screen.findByRole('link', { name: /#夜景/ })
    expect(link).toHaveAttribute('href', '/tags/%E5%A4%9C%E6%99%AF')
  })

  it('没有匹配标签时给「浏览全部标签」出口', async () => {
    mocks.tagList = { data: [], isLoading: false, error: null }
    renderPage('/search?tab=tags&q=zzz')
    expect(await screen.findByText('没有匹配的标签')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '浏览全部标签' })).toHaveAttribute('href', '/tags')
  })

  it('标签搜索失败时只坏这一块并可重试', async () => {
    mocks.tagList = { data: undefined, isLoading: false, error: new Error('boom') }
    renderPage('/search?tab=tags&q=%E5%A4%9C')
    expect(await screen.findByText('标签搜索失败')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument()
  })

  it('非法的 tab 值退回「作品」', () => {
    renderPage('/search?tab=weird')
    expect(screen.getByRole('tab', { name: '作品' })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('SearchPage · 最近搜索', () => {
  it('没有最近搜索时不渲染这一行', () => {
    renderPage()
    expect(screen.queryByRole('group', { name: '最近搜索' })).not.toBeInTheDocument()
  })

  it('点最近搜索的胶囊写回 URL 的 q', async () => {
    mocks.recent = { items: ['夜景', '街头'], push: vi.fn(), clear: vi.fn() }
    const url = renderPage('/search')

    const group = screen.getByRole('group', { name: '最近搜索' })
    await userEvent.setup().click(screen.getByRole('button', { name: '夜景' }))

    await waitFor(() => expect(url).toHaveTextContent('q=%E5%A4%9C%E6%99%AF'))
    expect(mocks.recent.push).toHaveBeenCalledWith('夜景')
    expect(group).toHaveTextContent('街头')
  })

  it('「清空」调用 clear', async () => {
    mocks.recent = { items: ['夜景'], push: vi.fn(), clear: vi.fn() }
    renderPage()
    await userEvent.setup().click(screen.getByRole('button', { name: '清空' }))
    expect(mocks.recent.clear).toHaveBeenCalledTimes(1)
  })
})
