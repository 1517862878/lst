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
import { TagChips } from '@/features/tags/TagLink'
import { PhotoThumb } from './PhotoThumb'
import { cn } from '@/lib/cn'

export interface PhotoCardProps {
  photo: Photo
  view?: 'grid' | 'masonry'
  showAuthor?: boolean
  showCounts?: boolean
  showDemoBadge?: boolean
  /** 是否显示可点标签（默认开；标签是作品卡的主要发现入口之一） */
  showTags?: boolean
  className?: string
}

export function PhotoCard({
  photo,
  view = 'grid',
  showAuthor = false,
  showCounts = true,
  showDemoBadge = true,
  showTags = true,
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
          {showAuthor && <AuthorLink authorId={photo.authorId} authorUsername={photo.authorUsername} />}
          <Badge tone="neutral" size="sm">
            {categoryName(photo.categorySlug)}
          </Badge>
        </div>
        {showTags && <TagChips tags={photo.tags} label={`${photo.title} 的标签`} limit={3} />}
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
