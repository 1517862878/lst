/**
 * 地点总览 /places（8.4a ③）。
 *
 * 只展示作者愿意公开的地点：location_precision 为 hidden（或没填地点名）的作品
 * 在聚合阶段就被过滤掉，因此这里既没有精确坐标，也没有「未公开」的占位条目。
 */
import { Link } from 'react-router'
import { MapPin } from 'lucide-react'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { formatDate } from '@/lib/time'
import { usePlaces } from '@/hooks/usePhotography'

export function PlacesPage() {
  const { data, isLoading, error, refetch } = usePlaces()
  const places = data ?? []

  return (
    <Container>
      <PageHeader
        title="地点"
        description="按拍摄地点浏览公开作品；地点精度由作者在发布时选择"
        breadcrumbs={[{ label: '首页', to: '/' }, { label: '地点' }]}
      />

      {error ? (
        <ErrorState title="无法加载地点列表" error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="g-place-grid" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} variant="rect" height={72} />
          ))}
        </div>
      ) : places.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="还没有公开的拍摄地点"
          description="发布作品时填写地点并选择公开精度，地点就会出现在这里"
          actions={[{ label: '去发布', to: '/publish' }]}
        />
      ) : (
        <ul className="g-place-grid">
          {places.map((place) => (
            // 地点名可能带「·」与空格，统一 encodeURIComponent 后再拼路径段：
            // 冻结契约规定的地点作品流是 /places/:label，不另开 query 变体
            <li key={place.label}>
              <Link
                className="g-place-card"
                to={`/places/${encodeURIComponent(place.label)}`}
              >
                <span className="g-place-label">
                  <MapPin className="g-place-icon" aria-hidden="true" />
                  {place.label}
                </span>
                <span className="g-gear-meta">
                  {place.photoCount} 件作品 · {place.authorCount} 位作者
                </span>
                <span className="g-place-date">最近发布 {place.latestPublishedAt ? formatDate(place.latestPublishedAt) : '暂无'}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Container>
  )
}
