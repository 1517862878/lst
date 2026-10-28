/**
 * 作品卡片（FRONTEND-WORK §3.3 PhotoCard）。
 * 规则：不自行取作品数据；素材署名与真实作者身份分开表达。
 */
import { Link } from 'react-router'
import type { Photo } from '@/domain/types'
import { categoryName } from '@/domain/constants'
import { Badge } from '@/components/ui/Badge'
import { DemoModeBadge } from '@/components/layout/DemoModeBadge'
import { AuthorLink } from '@/features/profiles/AuthorLink'
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
    <article className={cn('g-photo-card', view === 'masonry' && 'g-photo-card-masonry', className)}>
      <Link
        to={`/works/${photo.id}`}
        className="g-photo-card-work-link"
        aria-label={`查看作品：${photo.title}`}
      >
        <div className="g-photo-card-media">
          <PhotoThumb photo={photo} />
          {showDemoBadge && isDemo && <DemoModeBadge className="g-photo-card-demo" />}
        </div>
        <h3 className="g-photo-card-title">{photo.title}</h3>
      </Link>
      <div className="g-photo-card-body">
        <div className="g-photo-card-meta">
          {showAuthor && <AuthorLink authorId={photo.authorId} />}
          <Badge tone="neutral" size="sm">
            {categoryName(photo.categorySlug)}
          </Badge>
        </div>
        {showCounts && (
          <div className="g-photo-card-counts" aria-label={`点赞 ${photo.likeCount}，收藏 ${photo.favoriteCount}`}>
            <span>👍 {photo.likeCount}</span>
            <span>⭐ {photo.favoriteCount}</span>
          </div>
        )}
      </div>
    </article>
  )
}
