/**
 * 共用「关注动态」组件单测（src/features/social/FollowingFeed.tsx，8.3c）。
 *
 * 首页「关注」Tab 与 /feed 用的是同一个组件，差异只有 limit：
 *   · 首页只要前几条，不展示「加载更多」；
 *   · /feed 完整列表，有下一页时必须能继续加载。
 * 这里把 PhotoGrid 换成探针，只断言传进去的 photos 与翻页参数——组件契约就是这些。
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { Photo } from '@/domain/types'

const mocks = vi.hoisted(() => ({
  session: null as { userId: string } | null,
  sessionLoading: false,
  feed: {} as {
    data?: { pages: { items: Photo[] }[] }
    isLoading?: boolean
    error?: unknown
    fetchNextPage?: () => void
    hasNextPage?: boolean
    isFetchingNextPage?: boolean
    refetch?: () => void
  },
  grid: [] as {
    ids: string[]
    hasMore?: boolean | undefined
    onLoadMore?: (() => void) | undefined
  }[],
}))

vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({ data: mocks.session, isLoading: mocks.sessionLoading }),
}))

vi.mock('@/hooks/useSocial', () => ({
  useFeed: () => mocks.feed,
}))

vi.mock('@/features/photos/PhotoGrid', () => ({
  PhotoGrid: (props: {
    photos: Photo[]
    hasMore?: boolean
    onLoadMore?: () => void
    emptyTitle?: string
  }) => {
    mocks.grid.push({
      ids: props.photos.map((photo) => photo.id),
      hasMore: props.hasMore,
      onLoadMore: props.onLoadMore,
    })
    return (
      <div>
        <p>{props.emptyTitle}</p>
        <p>共 {props.photos.length} 条</p>
        {props.hasMore && (
          <button type="button" onClick={props.onLoadMore}>
            加载更多
          </button>
        )}
      </div>
    )
  },
}))

const { FollowingFeed } = await import('@/features/social/FollowingFeed')

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
    width: 100,
    height: 100,
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
  }
}

function reset() {
  mocks.session = { userId: 'u1' }
  mocks.sessionLoading = false
  mocks.grid = []
  mocks.feed = {
    data: { pages: [{ items: [photo('p1'), photo('p2'), photo('p2'), photo('p3')] }] },
    isLoading: false,
    hasNextPage: true,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }
}

const renderFeed = (limit?: number) =>
  render(
    <MemoryRouter>
      <FollowingFeed {...(limit !== undefined ? { limit } : {})} />
    </MemoryRouter>,
  )

describe('FollowingFeed', () => {
  it('未登录时给登录入口，登录后回跳到关注 Tab', () => {
    reset()
    mocks.session = null
    renderFeed()
    expect(screen.getByRole('link', { name: '去登录' })).toHaveAttribute(
      'href',
      '/login?next=%2F%3Ftab%3Dfollowing',
    )
  })

  it('会话加载中先出骨架，不闪登录引导', () => {
    reset()
    mocks.session = null
    mocks.sessionLoading = true
    renderFeed()
    expect(screen.queryByRole('link', { name: '去登录' })).toBeNull()
  })

  it('按 id 去重后渲染，首页 limit 截断且不显示加载更多', () => {
    reset()
    renderFeed(2)
    expect(screen.getByText('共 2 条')).toBeInTheDocument()
    expect(mocks.grid[0]?.ids).toEqual(['p1', 'p2'])
    expect(mocks.grid[0]?.hasMore).toBe(false)
  })

  it('/feed 模式保留完整列表并透出加载更多', () => {
    reset()
    renderFeed()
    expect(mocks.grid[0]?.ids).toEqual(['p1', 'p2', 'p3'])
    expect(mocks.grid[0]?.hasMore).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    expect(mocks.feed.fetchNextPage).toHaveBeenCalled()
  })
})
