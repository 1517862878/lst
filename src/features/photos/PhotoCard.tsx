/**
 * 作品卡片（FRONTEND-WORK §3.3 PhotoCard）。
 * 规则：不自行取数，photo 由 props 传入；示例作品显示角标（ROADMAP 5.5 第 3 条）。
 */
import { Link } from 'react-router'
import type { Photo } from '@/domain/types'
import { Badge } from '@/components/ui/Badge'
import { DemoModeBadge } from '@/components/layout/DemoModeBadge'
import { PhotoThumb } from './PhotoThumb'
import { cn } from '@/lib/cn'

export interface PhotoCardProps {
  photo: Photo
  view?: 'grid' | 'masonry'
  showAuthor?: boolean
  showCounts?: boolean
  showDemoBadge?: boolean
  className?: string
}

export function PhotoCard({
  photo,
  view = 'grid',
  showAuthor = false,
  showCounts = true,
  showDemoBadge = true,
  className,
}: PhotoCardProps) {
  const isDemo = photo.credit === '示例素材'

  return (
    <Link
      to={`/works/${photo.id}`}
      className={cn('g-photo-card', view === 'masonry' && 'g-photo-card-masonry', className)}
      aria-label={`查看作品：${photo.title}`}
    >
      <div className="g-photo-card-media">
        <PhotoThumb photo={photo} />
        {showDemoBadge && isDemo && <DemoModeBadge className="g-photo-card-demo" />}
      </div>
      <div className="g-photo-card-body">
        <h3 className="g-photo-card-title">{photo.title}</h3>
        <div className="g-photo-card-meta">
          {showAuthor && <span className="g-photo-card-author">{photo.credit ?? '作者'}</span>}
          <Badge tone="neutral" size="sm">
            {photo.categorySlug === 'landscape' ? '风景' : photo.categorySlug}
          </Badge>
        </div>
        {showCounts && (
          <div className="g-photo-card-counts" aria-label={`点赞 ${photo.likeCount}，收藏 ${photo.favoriteCount}`}>
            <span>👍 {photo.likeCount}</span>
            <span>⭐ {photo.favoriteCount}</span>
          </div>
        )}
      </div>
    </Link>
  )
}
