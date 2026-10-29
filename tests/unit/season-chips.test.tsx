/**
 * 作品墙季节筛选 chips 单测（src/pages/GalleryPage.tsx，8.4a ③）。
 *
 * 锁四件事：
 *   · 季节写在 URL query（?season=spring），刷新/分享不丢；
 *   · 切季节不顺手清掉排序参数，切排序也不清掉季节；
 *   · 只筛「已加载」的作品（服务端没有季节参数），筛选后仍保留分页接续；
 *   · chips 用 aria-pressed 表达状态，键盘可达（原生 button）。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Photo } from '@/domain/types'
import { makePhoto } from './fixtures'

const mocks = vi.hoisted(() => ({
  pages: [] as Photo[][],
  seasons: [] as Array<{ season: string; photoCount: number }>,
  fetchNextPage: vi.fn(),
}))

vi.mock('@/hooks/usePhotos', () => ({
  usePhotos: () => ({
    data: { pages: mocks.pages.map((items) => ({ items, nextCursor: null })) },
    fetchNextPage: mocks.fetchNextPage,
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/hooks/usePhotography', () => ({
  useSeasons: () => ({ data: mocks.seasons, isLoading: false, error: null, refetch: vi.fn() }),
}))

/** PhotoGrid 只验接线：把条数与空态标题暴露出来 */
vi.mock('@/features/photos/PhotoGrid', () => ({
  PhotoGrid: (props: { photos: Photo[]; emptyTitle?: string }) => (
    <div data-testid="grid">
      <span data-testid="count">{props.photos.length}</span>
      {props.photos.length === 0 && <p>{props.emptyTitle}</p>}
    </div>
  ),
}))

const { GalleryPage } = await import('@/pages/GalleryPage')

function photo(id: string, shotAt: string | null): Photo {
  return makePhoto(id, { shotAt })
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="search">{location.search}</output>
}

function renderPage(entry = '/gallery') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <GalleryPage />
      <LocationProbe />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mocks.pages = [
    [photo('spring-1', '2026-04-02T00:00:00.000Z'), photo('summer-1', '2026-07-02T00:00:00.000Z')],
  ]
  mocks.seasons = [
    { season: 'spring', photoCount: 1 },
    { season: 'summer', photoCount: 1 },
    { season: 'autumn', photoCount: 0 },
    { season: 'winter', photoCount: 0 },
  ]
  mocks.fetchNextPage.mockReset()
})

describe('季节 chips', () => {
  it('默认「全部季节」按下，展示全部已加载作品', () => {
    renderPage()
    expect(screen.getByRole('button', { name: '全部季节' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('count')).toHaveTextContent('2')
  })

  it('点某季写入 URL query，并只保留该季作品', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /^春/ }))
    expect(screen.getByTestId('search')).toHaveTextContent('season=spring')
    expect(screen.getByRole('button', { name: /^春/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('count')).toHaveTextContent('1')
    expect(screen.getByText(/正按春季筛选已加载的作品/)).toBeInTheDocument()
  })

  it('从 URL 直接打开带季节的链接，视图与参数一致', () => {
    renderPage('/gallery?season=summer&sort=popular')
    expect(screen.getByTestId('count')).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: /^夏/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '最热' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('切季节不清排序，切排序不清季节', async () => {
    const user = userEvent.setup()
    renderPage('/gallery?sort=popular')

    await user.click(screen.getByRole('button', { name: /^秋/ }))
    expect(screen.getByTestId('search')).toHaveTextContent('season=autumn')
    expect(screen.getByTestId('search')).toHaveTextContent('sort=popular')

    await user.click(screen.getByRole('button', { name: '最新' }))
    expect(screen.getByTestId('search')).toHaveTextContent('season=autumn')
    expect(screen.getByTestId('search')).not.toHaveTextContent('sort=popular')
  })

  it('清除筛选回到无参数 URL', async () => {
    const user = userEvent.setup()
    renderPage('/gallery?season=winter')

    await user.click(screen.getByRole('button', { name: '全部季节' }))
    expect(screen.getByTestId('search')).toBeEmptyDOMElement()
    expect(screen.getByTestId('count')).toHaveTextContent('2')
  })

  it('该季没有作品时空态文案带季节名', () => {
    renderPage('/gallery?season=winter')
    expect(screen.getByText(/还没有冬季作品/)).toBeInTheDocument()
  })

  it('chips 显示各季作品数，0 件不显示数字', () => {
    renderPage()
    const spring = screen.getByRole('button', { name: /^春/ })
    expect(spring).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: /^秋/ })).not.toHaveTextContent('0')
  })
})
