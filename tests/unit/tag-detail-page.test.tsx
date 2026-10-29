/**
 * 标签详情页 /tags/:tag 单测（src/pages/TagDetailPage.tsx）。
 *
 * 锁三件事：
 *   · 排序状态在 URL 里（最新 = 无参数，热门 = ?sort=popular），链接是真链接且带 aria-current；
 *   · 非法标签不取数，直接给可恢复的空状态；
 *   · 无限加载按钮接到 fetchNextPage，且「正在取下一页」时不会重复触发。
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Photo } from '@/domain/types'

const mocks = vi.hoisted(() => ({
  detail: {} as Record<string, unknown>,
  photos: {} as Record<string, unknown>,
  detailArgs: [] as string[],
  photosArgs: [] as Array<[string, string]>,
  fetchNextPage: vi.fn(),
  refetchPhotos: vi.fn(),
}))

vi.mock('@/hooks/useTags', () => ({
  useTags: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useTagSuggestions: () => ({ items: [], loading: false }),
  useTagDetail: (tag: string) => {
    mocks.detailArgs.push(tag)
    return { ...mocks.detail, refetch: vi.fn() }
  },
  useTagPhotos: (tag: string, sort: string) => {
    mocks.photosArgs.push([tag, sort])
    return {
      ...mocks.photos,
      fetchNextPage: mocks.fetchNextPage,
      refetch: mocks.refetchPhotos,
    }
  },
}))

/** PhotoGrid 只验接线：把条数、空态文案与「加载更多」按钮暴露出来 */
vi.mock('@/features/photos/PhotoGrid', () => ({
  PhotoGrid: (props: {
    photos: Photo[]
    hasMore?: boolean
    onLoadMore?: () => void
    emptyTitle?: string
  }) => (
    <div data-testid="grid">
      <span data-testid="count">{props.photos.length}</span>
      {props.photos.length === 0 && <p>{props.emptyTitle}</p>}
      {props.hasMore && (
        <button type="button" onClick={props.onLoadMore}>
          加载更多
        </button>
      )}
    </div>
  ),
}))

const { TagDetailPage } = await import('@/pages/TagDetailPage')

function photo(id: string): Photo {
  return {
    id,
    authorId: 'u1',
    title: id,
    description: '',
    categorySlug: 'landscape',
    tags: ['夜景'],
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

function setup(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/tags/:tag" element={<TagDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mocks.detailArgs.length = 0
  mocks.photosArgs.length = 0
  mocks.fetchNextPage.mockReset()
  mocks.refetchPhotos.mockReset()
  mocks.detail = {
    data: {
      tag: '夜景',
      photoCount: 12,
      authorCount: 3,
      latestPublishedAt: '2026-02-01T00:00:00.000Z',
      relatedTags: [
        { tag: '城市', count: 4 },
        { tag: '长曝光', count: 2 },
      ],
    },
    isLoading: false,
    isError: false,
    error: null,
  }
  mocks.photos = {
    data: { pages: [{ items: [photo('p1'), photo('p2')] }] },
    isLoading: false,
    isError: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
  }
})

afterEach(cleanup)

describe('TagDetailPage', () => {
  it('渲染标签标题、统计与作品数', () => {
    setup('/tags/%E5%A4%9C%E6%99%AF')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('#夜景')
    const stats = screen.getByLabelText('标签统计')
    expect(stats).toHaveTextContent('12')
    expect(stats).toHaveTextContent('3')
    expect(screen.getByTestId('count')).toHaveTextContent('2')
    expect(mocks.photosArgs.at(-1)).toEqual(['夜景', 'latest'])
  })

  it('默认「最新」，切到「热门」写进 URL 并带 aria-current', () => {
    setup('/tags/%E5%A4%9C%E6%99%AF?sort=popular')
    const latest = screen.getByRole('link', { name: '最新' })
    const popular = screen.getByRole('link', { name: '热门' })
    expect(latest).toHaveAttribute('href', '/tags/%E5%A4%9C%E6%99%AF')
    expect(popular).toHaveAttribute('href', '/tags/%E5%A4%9C%E6%99%AF?sort=popular')
    expect(popular).toHaveAttribute('aria-current', 'true')
    expect(latest).not.toHaveAttribute('aria-current')
    expect(mocks.photosArgs.at(-1)).toEqual(['夜景', 'popular'])
  })

  it('未知的 sort 值退回最新（URL 不合法不该让页面空掉）', () => {
    setup('/tags/%E5%A4%9C%E6%99%AF?sort=weird')
    expect(screen.getByRole('link', { name: '最新' })).toHaveAttribute('aria-current', 'true')
    expect(mocks.photosArgs.at(-1)).toEqual(['夜景', 'latest'])
  })

  it('相关标签渲染成链接并带共现计数', () => {
    setup('/tags/%E5%A4%9C%E6%99%AF')
    const related = screen.getByRole('list', { name: '相关标签' })
    expect(related).toHaveTextContent('#城市')
    expect(related).toHaveTextContent('4')
    expect(related).toHaveTextContent('#长曝光')
  })

  it('非法标签不取数，给出可恢复的空状态', () => {
    setup(`/tags/${encodeURIComponent('x'.repeat(40))}`)
    expect(screen.getByText('这个标签无效')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '浏览全部标签' })).toHaveAttribute('href', '/tags')
    expect(mocks.detailArgs.at(-1)).toBe('')
    expect(mocks.photosArgs.at(-1)).toEqual(['', 'latest'])
    expect(screen.queryByTestId('grid')).not.toBeInTheDocument()
  })

  it('没有作品时用带标签名的空状态文案', () => {
    mocks.photos = {
      ...mocks.photos,
      data: { pages: [] },
    }
    setup('/tags/%E5%A4%9C%E6%99%AF')
    expect(screen.getByText('还没有作品使用 #夜景')).toBeInTheDocument()
  })

  it('有下一页时点「加载更多」触发 fetchNextPage，取数中不重复触发', async () => {
    mocks.photos = { ...mocks.photos, hasNextPage: true }
    setup('/tags/%E5%A4%9C%E6%99%AF')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '加载更多' }))
    expect(mocks.fetchNextPage).toHaveBeenCalledTimes(1)

    cleanup()
    mocks.fetchNextPage.mockReset()
    mocks.photos = { ...mocks.photos, hasNextPage: true, isFetchingNextPage: true }
    setup('/tags/%E5%A4%9C%E6%99%AF')
    await user.click(screen.getByRole('button', { name: '加载更多' }))
    expect(mocks.fetchNextPage).not.toHaveBeenCalled()
  })
})
