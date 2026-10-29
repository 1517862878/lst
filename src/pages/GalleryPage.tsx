/**
 * 作品墙 /gallery（FRONTEND-WORK §2.2）。
 * 游标无限滚动 + 网格/瀑布流切换 + 排序 + 季节筛选（URL 即状态，8.4a ③）。
 */
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { PhotoGrid } from '@/features/photos/PhotoGrid'
import { usePhotos } from '@/hooks/usePhotos'
import { useSeasons } from '@/hooks/usePhotography'
import { dataSource } from '@/data'
import { SEASONS, SEASON_LABELS, isSeason, photoSeason } from '@/domain/photography'

export function GalleryPage() {
  const isApi = dataSource() === 'api'
  const [searchParams, setSearchParams] = useSearchParams()
  const sort = searchParams.get('sort') === 'popular' ? 'popular' : 'latest'
  const rawSeason = searchParams.get('season')
  const season = rawSeason !== null && isSeason(rawSeason) ? rawSeason : null
  const [view, setView] = useState<'grid' | 'masonry'>('grid')

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, error, refetch } =
    usePhotos({ sort })
  const seasonsQuery = useSeasons()

  const photos = useMemo(
    () => (data?.pages.flatMap((p) => p.items) ?? []).filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i),
    [data],
  )

  // 季节是派生字段（拍摄月份），服务端列表没有该过滤参数，所以只筛「已加载」的作品：
  // 打开季节后继续滚到底仍会拉下一页，新页同样参与筛选，分页与去重逻辑不变。
  const visible = useMemo(
    () => (season ? photos.filter((photo) => photoSeason(photo) === season) : photos),
    [photos, season],
  )

  const seasonCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of seasonsQuery.data ?? []) counts.set(item.season, item.photoCount)
    return counts
  }, [seasonsQuery.data])

  // 排序与季节都写在 URL 上：刷新、分享后视图不丢；改其中一个不能顺手清掉另一个
  const setQuery = (patch: { sort?: 'latest' | 'popular'; season?: string | null }) => {
    const next = new URLSearchParams(searchParams)
    if ('sort' in patch) {
      if (patch.sort === 'popular') next.set('sort', 'popular')
      else next.delete('sort')
    }
    if ('season' in patch) {
      if (patch.season) next.set('season', patch.season)
      else next.delete('season')
    }
    setSearchParams(next, { replace: true })
  }

  return (
    <Container>
      <PageHeader title="作品墙" description={isApi ? '浏览服务器上的公开作品' : '浏览本机演示数据'}>
        <div className="g-toolbar">
          <div className="g-toolbar-group">
            <Button
              variant={sort === 'latest' ? 'primary' : 'ghost'}
              size="sm"
              aria-pressed={sort === 'latest'}
              onClick={() => setQuery({ sort: 'latest' })}
            >
              最新
            </Button>
            <Button
              variant={sort === 'popular' ? 'primary' : 'ghost'}
              size="sm"
              aria-pressed={sort === 'popular'}
              onClick={() => setQuery({ sort: 'popular' })}
            >
              最热
            </Button>
          </div>
          <div className="g-toolbar-group">
            <Button
              variant={view === 'grid' ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={view === 'grid'}
              onClick={() => setView('grid')}
              aria-label="网格视图"
            >
              ▦ 网格
            </Button>
            <Button
              variant={view === 'masonry' ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={view === 'masonry'}
              onClick={() => setView('masonry')}
              aria-label="瀑布流视图"
            >
              ▥ 瀑布流
            </Button>
          </div>
        </div>
      </PageHeader>

      <nav className="g-season-chips" aria-label="按季节筛选">
        <Button
          variant={season === null ? 'primary' : 'ghost'}
          size="sm"
          aria-pressed={season === null}
          onClick={() => setQuery({ season: null })}
        >
          全部季节
        </Button>
        {SEASONS.map((value) => {
          const count = seasonCounts.get(value) ?? 0
          return (
            <Button
              key={value}
              variant={season === value ? 'primary' : 'ghost'}
              size="sm"
              aria-pressed={season === value}
              onClick={() => setQuery({ season: value })}
            >
              {SEASON_LABELS[value]}
              {count > 0 && <span className="g-season-count">{count}</span>}
            </Button>
          )
        })}
      </nav>
      {season && (
        // 说清筛选范围：只作用于已加载的作品，避免「翻页后季节不对」被当成 bug
        <p className="g-photography-note">
          正按{SEASON_LABELS[season]}季筛选已加载的作品；季节取自拍摄时间（缺拍摄时间时用发布时间）。
        </p>
      )}

      <PhotoGrid
        photos={visible}
        view={view}
        loading={isLoading || isFetchingNextPage}
        error={error}
        onRetry={() => void refetch()}
        hasMore={hasNextPage}
        onLoadMore={() => void fetchNextPage()}
        emptyTitle={season ? `还没有${SEASON_LABELS[season]}季作品` : '还没有作品'}
        emptyActions={season ? [{ label: '看全部作品', to: '/gallery' }] : [{ label: '去发布', to: '/publish' }]}
      />
    </Container>
  )
}
