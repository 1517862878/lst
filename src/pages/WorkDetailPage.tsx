/**
 * 作品详情 /works/:id（FRONTEND-WORK §2.3）。
 * 画廊 + EXIF 白名单 + 作者 + 评论列表（S5 前只读）+ 相关推荐。
 */
import { useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router'
import { Container } from '@/components/layout/Container'
import { Skeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/ErrorState'
import { Badge } from '@/components/ui/Badge'
import { PhotoThumb } from '@/features/photos/PhotoThumb'
import { PhotoGrid } from '@/features/photos/PhotoGrid'
import { LicenseBadge } from '@/features/photos/LicenseBadge'
import { TagChips } from '@/features/tags/TagLink'
import { ShareButton } from '@/features/photos/ShareButton'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/useToast'
import { LikeButton, FavoriteButton } from '@/features/interactions/LikeFavoriteButtons'
import { CommentSection } from '@/features/interactions/CommentSection'
import { AuthorLink } from '@/features/profiles/AuthorLink'
import { WorkMoreMenu } from '@/features/moderation/WorkMoreMenu'
import { AddToCollectionDialog } from '@/features/collections/AddToCollectionDialog'
import { useMorePhotosByAuthor, usePhoto, useRelatedPhotos, useWithdrawPhoto } from '@/hooks/usePhotos'
import { useSession } from '@/hooks/useSession'
import { useInteractionSync } from '@/hooks/useInteractions'
import { formatDate, relativeTime } from '@/lib/time'
import { categoryName } from '@/domain/constants'
import { LICENSE_DESCRIPTORS } from '@/domain/licenses'
import { gearLabel } from '@/domain/photography'

export function WorkDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [collectionOpen, setCollectionOpen] = useState(false)
  const [withdrawError, setWithdrawError] = useState('')
  const withdrawPhoto = useWithdrawPhoto(id)
  const photoQuery = usePhoto(id)
  const relatedQuery = useRelatedPhotos(id)
  const { data: session } = useSession()
  const loadedPhoto = photoQuery.data
  const sameAuthorQuery = useMorePhotosByAuthor(loadedPhoto?.authorId ?? '', loadedPhoto?.id ?? '')
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
  const isAuthor = session?.userId === photo.authorId

  // 拍摄参数的三态与器材跳转：Make/Model 合并成一行「机身」，LensModel 单独一行「镜头」，
  // 两者都能点进器材作品流（/gear/:kind?label=），因为它们是同一个聚合口径的两个视角。
  const exifHidden = photo.exifHidden === true
  const bodyLabel = gearLabel(photo.exif, 'body')
  const lensLabel = gearLabel(photo.exif, 'lens')
  const exifRows: Array<{ label: string; value: string; to?: string }> = []
  for (const [key, value] of Object.entries(photo.exif ?? {})) {
    if (key === 'Make') continue
    if (key === 'Model') {
      if (bodyLabel) {
        exifRows.push({ label: '机身', value: bodyLabel, to: `/gear/body?label=${encodeURIComponent(bodyLabel)}` })
      }
      continue
    }
    if (key === 'LensModel') {
      if (lensLabel) {
        exifRows.push({ label: '镜头', value: lensLabel, to: `/gear/lens?label=${encodeURIComponent(lensLabel)}` })
      }
      continue
    }
    exifRows.push({ label: key, value: String(value) })
  }

  async function handleWithdraw() {
    setWithdrawError('')
    try {
      await withdrawPhoto.mutateAsync()
      setWithdrawOpen(false)
      toast.show('success', '作品已撤回，不再公开展示')
      navigate('/me', { replace: true })
    } catch (error) {
      setWithdrawError(error instanceof Error ? error.message : '撤回失败，请稍后重试')
    }
  }

  const licenseJsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Photograph',
    name: photo.title,
    description: photo.description,
    license: LICENSE_DESCRIPTORS[photo.license].schemaUrl,
    creditText: photo.credit ?? undefined,
  }).replace(/</g, '\\u003c')

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
          <div className="g-work-heading">
            <h1 className="g-work-title">{photo.title}</h1>
            {isAuthor && (
              <div className="g-work-owner-actions" aria-label="作者操作">
                <Button size="sm" variant="secondary" onClick={() => navigate(`/works/${photo.id}/edit`)}>
                  编辑作品
                </Button>
                <Button size="sm" variant="danger" onClick={() => setWithdrawOpen(true)}>
                  撤回作品
                </Button>
              </div>
            )}
          </div>
          <AuthorLink
            authorId={photo.authorId}
            authorUsername={photo.authorUsername}
            variant="card"
          />
          <div className="g-work-meta">
            {photo.featuredAt && (
              <Badge tone="warning" className="g-featured-mark">
                编辑精选
              </Badge>
            )}
            <Badge tone="info">{categoryName(photo.categorySlug)}</Badge>
            {photo.credit && <Badge tone="warning">{photo.credit}</Badge>}
            <span className="g-work-time" title={formatDate(photo.publishedAt ?? photo.createdAt)}>
              {relativeTime(photo.publishedAt ?? photo.createdAt)}
            </span>
          </div>

          <TagChips tags={photo.tags} size="md" label="作品标签" className="g-work-tags" />

          {photo.locationName && photo.locationPrecision !== 'hidden' && (
            <p className="g-work-location" aria-label="拍摄地点">
              📍{' '}
              <Link to={`/places/${encodeURIComponent(photo.locationName)}`} className="g-work-location-link">
                {photo.locationName}
              </Link>
            </p>
          )}

          <p className="g-work-description">{photo.description || '作者没有写心得。'}</p>

          {/* 三态：未公开 → 说明；公开且有值 → 表格；公开但没写 → 整块不出现（不留空表） */}
          {exifHidden ? (
            <p className="g-exif-hidden" role="note">
              作者未公开拍摄参数
            </p>
          ) : exifRows.length > 0 ? (
            <details className="g-exif-panel">
              <summary>拍摄参数（EXIF 白名单）</summary>
              <dl className="g-exif-list">
                {exifRows.map((row) => (
                  <div key={row.label} className="g-exif-row">
                    <dt>{row.label}</dt>
                    <dd>
                      {row.to ? (
                        <Link to={row.to} className="g-exif-link">
                          {row.value}
                        </Link>
                      ) : (
                        row.value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          ) : null}

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
            <ShareButton title={photo.title} text={photo.description || '来自工科影展的摄影作品'} />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                if (!session) {
                  navigate(`/login?next=${encodeURIComponent(`/works/${photo.id}`)}`)
                  return
                }
                setCollectionOpen(true)
              }}
            >
              加入收藏夹
            </Button>
            <WorkMoreMenu
              photoId={photo.id}
              title={photo.title}
              isAuthor={isAuthor}
              featured={Boolean(photo.featuredAt)}
            />
          </div>

          <LicenseBadge license={photo.license} />
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: licenseJsonLd }} />
        </div>
      </article>

      <AddToCollectionDialog
        open={collectionOpen}
        onOpenChange={setCollectionOpen}
        photoId={photo.id}
        photoTitle={photo.title}
      />

      <Dialog
        open={withdrawOpen}
        onOpenChange={(open) => {
          if (!withdrawPhoto.isPending) setWithdrawOpen(open)
          if (!open) setWithdrawError('')
        }}
        title="确认撤回作品？"
        description="撤回后作品将从公开页面、搜索和榜单中移除。此操作不会立即物理删除原始记录。"
        footer={
          <>
            <Button variant="secondary" onClick={() => setWithdrawOpen(false)} disabled={withdrawPhoto.isPending}>
              取消
            </Button>
            <Button variant="danger" loading={withdrawPhoto.isPending} onClick={() => void handleWithdraw()}>
              确认撤回
            </Button>
          </>
        }
      >
        <p className="g-withdraw-copy">你将撤回《{photo.title}》。</p>
        {withdrawError && <p className="g-auth-error" role="alert">{withdrawError}</p>}
      </Dialog>

      <CommentSection
        photoId={photo.id}
        currentUserId={session?.userId ?? null}
        isAuthor={isAuthor}
        commentsLocked={photo.commentsLocked === true}
      />

      <section className="g-related" aria-labelledby="same-author-title">
        <h2 id="same-author-title" className="g-related-title">
          这位作者的更多作品
        </h2>
        {sameAuthorQuery.data && sameAuthorQuery.data.length > 0 ? (
          <PhotoGrid photos={sameAuthorQuery.data} className="g-related-grid" />
        ) : (
          !sameAuthorQuery.isLoading && <p className="g-placeholder-text">这位作者暂时没有更多公开作品。</p>
        )}
      </section>

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
