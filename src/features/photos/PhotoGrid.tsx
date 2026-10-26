/**
 * 作品网格 + 无限滚动（FRONTEND-WORK §3.3 PhotoGrid / LoadMoreSentinel）。
 */
import { useEffect, useRef, type ReactNode } from 'react'
import type { Photo } from '@/domain/types'
import { PhotoCard } from './PhotoCard'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/cn'

export interface PhotoGridProps {
  photos: Photo[]
  view?: 'grid' | 'masonry'
  showAuthor?: boolean
  loading?: boolean
  /** 加载更多哨兵：hasMore 为 true 时滚动到底触发 onLoadMore */
  hasMore?: boolean
  onLoadMore?: () => void
  emptyTitle?: string
  emptyActions?: Array<{ label: string; to?: string }>
  className?: string
}

export function PhotoGrid({
  photos,
  view = 'grid',
  showAuthor = false,
  loading = false,
  hasMore = false,
  onLoadMore,
  emptyTitle = '还没有作品',
  emptyActions = [],
  className,
}: PhotoGridProps) {
  return (
    <div className={cn('g-photo-grid-wrap', className)}>
      <div className={cn('g-photo-grid', view === 'masonry' && 'g-photo-grid-masonry')}>
        {photos.map((photo) => (
          <PhotoCard key={photo.id} photo={photo} view={view} showAuthor={showAuthor} />
        ))}
      </div>
      {loading && (
        <div className="g-photo-grid" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} variant="rect" height={200} />
          ))}
        </div>
      )}
      {photos.length === 0 && !loading && (
        <EmptyState title={emptyTitle} description="换个筛选条件，或成为第一个分享的人。" actions={emptyActions} />
      )}
      {hasMore && onLoadMore && <LoadMoreSentinel onIntersect={onLoadMore} hasMore={hasMore} />}
      {!hasMore && photos.length > 0 && (
        <p className="g-infinite-end" role="status">
          已显示全部 {photos.length} 件作品
        </p>
      )}
    </div>
  )
}

interface LoadMoreSentinelProps {
  onIntersect: () => void
  hasMore: boolean
}

/** IntersectionObserver 哨兵，rootMargin 提前 400px 触发（FRONTEND-WORK §3.3） */
function LoadMoreSentinel({ onIntersect, hasMore }: LoadMoreSentinelProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !hasMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onIntersect()
      },
      { rootMargin: '400px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [onIntersect, hasMore])

  return (
    <div ref={ref} className="g-load-more-sentinel" aria-hidden="true">
      <Skeleton variant="text" width={80} />
    </div>
  )
}
