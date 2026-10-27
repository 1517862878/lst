/**
 * 作品墙 /gallery（FRONTEND-WORK §2.2）。
 * 游标无限滚动 + 网格/瀑布流切换 + 排序（URL 即状态）。
 */
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { PhotoGrid } from '@/features/photos/PhotoGrid'
import { usePhotos } from '@/hooks/usePhotos'
import { dataSource } from '@/data'

export function GalleryPage() {
  const isApi = dataSource() === 'api'
  const [searchParams, setSearchParams] = useSearchParams()
  const sort = searchParams.get('sort') === 'popular' ? 'popular' : 'latest'
  const [view, setView] = useState<'grid' | 'masonry'>('grid')

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, error, refetch } =
    usePhotos({ sort })

  const photos = useMemo(
    () => (data?.pages.flatMap((p) => p.items) ?? []).filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i),
    [data],
  )

  const handleSortChange = (next: 'latest' | 'popular') => {
    setSearchParams(next === 'popular' ? { sort: 'popular' } : {}, { replace: true })
  }

  return (
    <Container>
      <PageHeader title="作品墙" description={isApi ? '浏览服务器上的公开作品' : '浏览本机演示数据'}>
        <div className="g-toolbar">
          <div className="g-toolbar-group">
            <Button
              variant={sort === 'latest' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => handleSortChange('latest')}
            >
              最新
            </Button>
            <Button
              variant={sort === 'popular' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => handleSortChange('popular')}
            >
              最热
            </Button>
          </div>
          <div className="g-toolbar-group">
            <Button
              variant={view === 'grid' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setView('grid')}
              aria-label="网格视图"
            >
              ▦ 网格
            </Button>
            <Button
              variant={view === 'masonry' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setView('masonry')}
              aria-label="瀑布流视图"
            >
              ▥ 瀑布流
            </Button>
          </div>
        </div>
      </PageHeader>

      <PhotoGrid
        photos={photos}
        view={view}
        loading={isLoading || isFetchingNextPage}
        error={error}
        onRetry={() => void refetch()}
        hasMore={hasNextPage}
        onLoadMore={() => void fetchNextPage()}
        emptyActions={[{ label: '去发布', to: '/publish' }]}
      />
    </Container>
  )
}
