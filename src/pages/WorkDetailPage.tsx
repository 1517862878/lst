/**
 * 作品详情 /works/:id（FRONTEND-WORK §2.3）。
 * 画廊 + EXIF 白名单 + 作者 + 评论列表（S5 前只读）+ 相关推荐。
 */
import { useParams, Link } from 'react-router'
import { Container } from '@/components/layout/Container'
import { Skeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/ErrorState'
import { Badge } from '@/components/ui/Badge'
import { PhotoThumb } from '@/features/photos/PhotoThumb'
import { PhotoGrid } from '@/features/photos/PhotoGrid'
import { LikeButton, FavoriteButton } from '@/features/interactions/LikeFavoriteButtons'
import { CommentSection } from '@/features/interactions/CommentSection'
import { usePhoto, useRelatedPhotos } from '@/hooks/usePhotos'
import { useSession } from '@/hooks/useSession'
import { useInteractionSync } from '@/hooks/useInteractions'
import { formatDate, relativeTime } from '@/lib/time'

const CATEGORY_NAMES: Record<string, string> = {
  landscape: '风景', people: '人文', architecture: '建筑', industrial: '工业',
  technology: '科技', macro: '微距', night: '夜景', monochrome: '黑白',
}

export function WorkDetailPage() {
  const { id = '' } = useParams()
  const photoQuery = usePhoto(id)
  const relatedQuery = useRelatedPhotos(id)
  const { data: session } = useSession()
  useInteractionSync()

  if (photoQuery.isLoading) {
    return (
      <Container>
        <div className="g-detail-skeleton">
          <Skeleton variant="rect" height={400} />
          <Skeleton variant="text" width={200} />
          <Skeleton variant="text" width="80%" />
        </div>
      </Container>
    )
  }

  if (photoQuery.isError || !photoQuery.data) {
    return (
      <Container>
        <ErrorState title="作品不存在或已删除" error={photoQuery.error} />
      </Container>
    )
  }

  const photo = photoQuery.data

  return (
    <Container>
      <nav className="g-breadcrumb" aria-label="面包屑">
        <Link to="/gallery">作品墙</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{photo.title}</span>
      </nav>

      <article className="g-work-detail">
        <div className="g-work-media">
          <PhotoThumb photo={photo} size="display" priority />
        </div>

        <div className="g-work-info">
          <h1 className="g-work-title">{photo.title}</h1>
          <div className="g-work-meta">
            <Badge tone="info">{CATEGORY_NAMES[photo.categorySlug] ?? photo.categorySlug}</Badge>
            {photo.credit && <Badge tone="warning">{photo.credit}</Badge>}
            <span className="g-work-time" title={formatDate(photo.publishedAt ?? photo.createdAt)}>
              {relativeTime(photo.publishedAt ?? photo.createdAt)}
            </span>
          </div>

          {photo.locationName && (
            <p className="g-work-location" aria-label="拍摄地点">
              📍 {photo.locationName}
            </p>
          )}

          <p className="g-work-description">{photo.description || '作者没有写心得。'}</p>

          {photo.exif && (
            <details className="g-exif-panel">
              <summary>拍摄参数（EXIF 白名单）</summary>
              <dl className="g-exif-list">
                {Object.entries(photo.exif).map(([k, v]) => (
                  <div key={k} className="g-exif-row">
                    <dt>{k}</dt>
                    <dd>{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}

          <div className="g-work-actions" aria-label="互动操作">
            <LikeButton
              photoId={photo.id}
              count={photo.likeCount}
              userId={session?.userId ?? null}
            />
            <FavoriteButton
              photoId={photo.id}
              count={photo.favoriteCount}
              userId={session?.userId ?? null}
            />
            <span className="g-work-views">👁 {photo.viewCount}</span>
          </div>

          <p className="g-work-license">版权：作者保留所有权利（{photo.license}）</p>
        </div>
      </article>

      <CommentSection photoId={photo.id} currentUserId={session?.userId ?? null} />

      <section className="g-related" aria-labelledby="related-title">
        <h2 id="related-title" className="g-related-title">
          相关作品
        </h2>
        {relatedQuery.data && relatedQuery.data.length > 0 ? (
          <PhotoGrid photos={relatedQuery.data} className="g-related-grid" />
        ) : (
          <p className="g-placeholder-text">暂无同分类作品。</p>
        )}
      </section>
    </Container>
  )
}
