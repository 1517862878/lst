import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchPage } from '@/pages/SearchPage'

const mocks = vi.hoisted(() => ({
  userSearch: vi.fn((_query: string) => ({ data: [{ username: 'alice', displayName: '爱丽丝', avatarKey: null, bio: '街头摄影', followerCount: 12, isFollowing: false }], isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn() })),
}))
vi.mock('@/hooks/useSearch', () => ({
  useSearch: () => ({ data: { items: [], nextCursor: null, total: 0 }, isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn() }),
  useUserSearch: (q: string) => mocks.userSearch(q),
}))
vi.mock('@/hooks/useDiscover', () => ({
  useHotSearches: () => ({ data: [], isLoading: false, isError: false, error: null }),
  useFeaturedPhotos: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useNewAuthors: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useSetEditorChoice: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/features/social/FollowButton', () => ({ FollowButton: ({ username }: { username: string }) => <button>关注 {username}</button> }))

afterEach(cleanup)
function Probe() { const location = useLocation(); return <output data-testid="url">{location.search}</output> }
function renderPage(entry = '/search?q=alice&tab=users') { return render(<MemoryRouter initialEntries={[entry]}><Routes><Route path="/search" element={<><SearchPage /><Probe /></>} /></Routes></MemoryRouter>) }

describe('SearchPage 用户 Tab', () => {
  it('从 URL q/tab 恢复用户结果并展示完整信息', () => {
    renderPage()
    expect(screen.getByRole('tab', { name: '用户' })).toHaveAttribute('data-state', 'active')
    expect(mocks.userSearch).toHaveBeenCalledWith('alice')
    expect(screen.getByText('爱丽丝')).toBeInTheDocument()
    expect(screen.getByText('@alice')).toBeInTheDocument()
    expect(screen.getByText('街头摄影')).toBeInTheDocument()
    expect(screen.getByText('12 位粉丝')).toBeInTheDocument()
  })

  it('键盘切换 Tab 会同步 URL tab', async () => {
    const user = userEvent.setup()
    renderPage('/search?q=alice&tab=works')
    const works = screen.getByRole('tab', { name: '作品' })
    works.focus()
    await user.keyboard('{ArrowRight}')
    await screen.findByText('爱丽丝')
    expect(screen.getByTestId('url')).toHaveTextContent('q=alice&tab=users')
  })
})
