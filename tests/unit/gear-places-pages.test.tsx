/**
 * 器材与地点页单测（src/pages/{GearPage,GearDetailPage,PlacesPage,PlaceDetailPage}.tsx，8.4a ②③）。
 *
 * 只验接线与文案，不验聚合算法（那在 photography-domain.test.ts）：
 *   · /gear 机身、镜头两组永远都在（哪怕某组为空，也有可解释的空态）；
 *   · 卡片链接把器材名放进 query（机身名含空格与斜杠，不能直接塞路径段）；
 *   · /places 卡片把地点名 encodeURIComponent 后放进路径段；
 *   · 详情页的地点精度提示来自 location_precision，且不含任何坐标数字；
 *   · 未知器材分类给可恢复的错误态，而不是白屏。
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GearSummary, PlaceSummary } from '@/domain/photography'
import type { Photo } from '@/domain/types'
import { makePhoto } from './fixtures'

const mocks = vi.hoisted(() => ({
  gear: { value: [] as GearSummary[] },
  places: { value: [] as PlaceSummary[] },
  gearPhotos: { value: {} as Record<string, unknown> },
  placePhotos: { value: {} as Record<string, unknown> },
  gearArgs: [] as Array<[string, string]>,
  placeArgs: [] as string[],
  feed: [] as Array<{ emptyTitle?: string; count: number; showAuthor?: boolean }>,
}))

vi.mock('@/hooks/usePhotography', () => ({
  useGearList: () => ({ data: mocks.gear.value, isLoading: false, error: null, refetch: vi.fn() }),
  usePlaces: () => ({ data: mocks.places.value, isLoading: false, error: null, refetch: vi.fn() }),
  useGearPhotos: (kind: string, label: string) => {
    mocks.gearArgs.push([kind, label])
    return { ...mocks.gearPhotos.value, fetchNextPage: vi.fn(), refetch: vi.fn() }
  },
  usePlacePhotos: (label: string) => {
    mocks.placeArgs.push(label)
    return { ...mocks.placePhotos.value, fetchNextPage: vi.fn(), refetch: vi.fn() }
  },
}))

/** PhotoFeed 只验接线：把 emptyTitle、条数与 showAuthor 暴露出来 */
vi.mock('@/features/photography/PhotoFeed', () => ({
  PhotoFeed: (props: { source: { data?: { pages: Array<{ items: Photo[] }> } }; emptyTitle?: string; showAuthor?: boolean }) => {
    const count = props.source.data?.pages.flatMap((page) => page.items).length ?? 0
    mocks.feed.push({ ...(props.emptyTitle === undefined ? {} : { emptyTitle: props.emptyTitle }), count, ...(props.showAuthor === undefined ? {} : { showAuthor: props.showAuthor }) })
    return <div data-testid="feed">{props.emptyTitle}</div>
  },
}))

const { GearPage } = await import('@/pages/GearPage')
const { GearDetailPage } = await import('@/pages/GearDetailPage')
const { PlacesPage } = await import('@/pages/PlacesPage')
const { PlaceDetailPage } = await import('@/pages/PlaceDetailPage')

function gear(kind: 'body' | 'lens', label: string, photoCount = 2): GearSummary {
  return { kind, label, photoCount, authorCount: 1 }
}

function place(label: string, photoCount = 1): PlaceSummary {
  return { label, photoCount, authorCount: 1, latestPublishedAt: '2026-03-01T00:00:00.000Z' }
}

function photo(id: string, overrides: Partial<Photo> = {}): Photo {
  return makePhoto(id, { locationName: '杭州·西湖', ...overrides })
}

beforeEach(() => {
  mocks.gear.value = []
  mocks.places.value = []
  mocks.gearArgs.length = 0
  mocks.placeArgs.length = 0
  mocks.feed.length = 0
})

describe('/gear', () => {
  it('机身与镜头两组都在，链接把器材名放进 query', () => {
    mocks.gear.value = [gear('body', 'NIKON Z 6_2'), gear('lens', 'RF 24-70mm F2.8')]
    render(
      <MemoryRouter initialEntries={['/gear']}>
        <Routes>
          <Route path="/gear" element={<GearPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { level: 2, name: /机身/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: /镜头/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /NIKON Z 6_2/ })).toHaveAttribute(
      'href',
      `/gear/body?label=${encodeURIComponent('NIKON Z 6_2')}`,
    )
    expect(screen.getByRole('link', { name: /RF 24-70mm F2.8/ })).toHaveAttribute(
      'href',
      `/gear/lens?label=${encodeURIComponent('RF 24-70mm F2.8')}`,
    )
  })

  it('空组也有可解释的空态，而不是留一个空标题', () => {
    mocks.gear.value = [gear('body', 'Canon EOS R5')]
    render(
      <MemoryRouter initialEntries={['/gear']}>
        <Routes>
          <Route path="/gear" element={<GearPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText(/还没有公开的镜头信息/)).toBeInTheDocument()
  })
})

describe('/gear/:kind', () => {
  it('合法分类 + label：按分类取流，空态文案带机身', () => {
    render(
      <MemoryRouter initialEntries={[`/gear/body?label=${encodeURIComponent('Canon EOS R5')}`]}>
        <Routes>
          <Route path="/gear/:kind" element={<GearDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(mocks.gearArgs).toEqual([['body', 'Canon EOS R5']])
    expect(mocks.feed[0]).toMatchObject({ showAuthor: true })
    expect(mocks.feed[0]?.emptyTitle).toContain('机身')
  })

  it('未知分类给可恢复错误态，不取数', () => {
    render(
      <MemoryRouter initialEntries={['/gear/tripod?label=x']}>
        <Routes>
          <Route path="/gear/:kind" element={<GearDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText(/未知的器材分类/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回器材列表' })).toHaveAttribute('href', '/gear')
    expect(mocks.feed).toHaveLength(0)
  })

  it('缺 label 时不取数，提示从列表点选', () => {
    render(
      <MemoryRouter initialEntries={['/gear/lens']}>
        <Routes>
          <Route path="/gear/:kind" element={<GearDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText(/没有指定器材/)).toBeInTheDocument()
    expect(mocks.gearArgs).toEqual([['lens', '']])
  })
})

describe('/places', () => {
  it('地点卡片把名称编码进路径段，并给出作品数', () => {
    mocks.places.value = [place('杭州·西湖', 3)]
    render(
      <MemoryRouter initialEntries={['/places']}>
        <Routes>
          <Route path="/places" element={<PlacesPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: /杭州·西湖/ })).toHaveAttribute(
      'href',
      `/places/${encodeURIComponent('杭州·西湖')}`,
    )
    expect(screen.getByText(/3 件作品/)).toBeInTheDocument()
  })

  it('没有公开地点时给空态', () => {
    render(
      <MemoryRouter initialEntries={['/places']}>
        <Routes>
          <Route path="/places" element={<PlacesPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText(/还没有公开的拍摄地点/)).toBeInTheDocument()
  })
})

describe('/places/:label', () => {
  it('路径参数解码后取流，并按 location_precision 给精度说明', () => {
    mocks.placePhotos.value = {
      data: { pages: [{ items: [photo('p1', { locationPrecision: 'district' })], nextCursor: null }] },
      isLoading: false,
      error: null,
    }
    render(
      <MemoryRouter initialEntries={[`/places/${encodeURIComponent('杭州·西湖')}`]}>
        <Routes>
          <Route path="/places/:label" element={<PlaceDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(mocks.placeArgs).toEqual(['杭州·西湖'])
    expect(screen.getByRole('heading', { level: 1, name: '杭州·西湖' })).toBeInTheDocument()
    // district 档文案：精确到区县，不含坐标
    expect(screen.getByText(/精确到区县/)).toBeInTheDocument()
    expect(screen.queryByText(/\d+\.\d+,/)).toBeNull()
  })

  it('没有作品时精度说明退到默认档，空态文案带地点名', () => {
    mocks.placePhotos.value = { data: { pages: [] }, isLoading: false, error: null }
    render(
      <MemoryRouter initialEntries={['/places/%E4%B8%8A%E6%B5%B7%C2%B7%E5%A4%96%E6%BB%A9']}>
        <Routes>
          <Route path="/places/:label" element={<PlaceDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { level: 1, name: '上海·外滩' })).toBeInTheDocument()
    expect(mocks.feed[0]?.emptyTitle).toContain('上海·外滩')
  })
})
