/**
 * 收藏夹详情（/c/:id）。
 *
 * 可见性规则：私密收藏夹只有本人能看。服务端对非本人一般直接返回 NOT_FOUND，
 * 但这里再做一次前端兜底——「接口好心返回了数据」也不该把私密夹渲染给陌生人。
 * 两种情况的文案统一成「这个收藏夹不存在或不可见」，避免泄露「存在但私密」这一信息。
 *
 * ---- 数据层契约（另一任务实现中）----
 * useCollection(id)      → React Query 结果，data: Collection；不可见时 error 为 NOT_FOUND。
 * useCollectionItems(id) → useInfiniteQuery，每页 CursorListPage<Photo>，取 data.pages[].items。
 * 字段全部来自 src/domain/types.ts：title / description / visibility / itemCount /
 * ownerUsername / ownerDisplayName / coverPhotoId / isOwner。
 */
import { Link, useParams } from 'react-router'
import { Lock } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { PhotoGrid } from '@/features/photos/PhotoGrid'
import { useCollection, useCollectionItems } from '@/hooks/useCollections'
import { useSession } from '@/hooks/useSession'
import { AppError, ErrorCodes } from '@/data/contracts'
import type { CollectionVisibility } from '@/domain/types'

const VISIBILITY_META: Record<CollectionVisibility, { label: string; tone: 'success' | 'info' | 'neutral' }> = {
  public: { label: '公开', tone: 'success' },
  unlisted: { label: '仅链接可见', tone: 'info' },
  private: { label: '仅自己可见', tone: 'neutral' },
}

function isNotFound(error: unknown): boolean {
  return error instanceof AppError && error.code === ErrorCodes.NOT_FOUND
}

export function CollectionDetailPage() {
  const { id = '' } = useParams()
  const detailQuery = useCollection(id)
  const itemsQuery = useCollectionItems(id)
  const { data: session } = useSession()

  const detail = detailQuery.data
  const items = itemsQuery.data?.pages.flatMap((page) => page.items) ?? []
  const ownerUsername = detail?.ownerUsername ?? ''
  // 服务端会给 isOwner，但用 session.username 再比一次：同账号换设备、或接口省略字段时仍然成立。
  const isOwner = Boolean(
    detail && (detail.isOwner || (ownerUsername !== '' && ownerUsername === session?.username)),
  )
  const visibility: CollectionVisibility = detail?.visibility ?? 'private'
  const hidden = Boolean(detail && visibility === 'private' && !isOwner)
  const missing = !detailQuery.isLoading && (isNotFound(detailQuery.error) || (!detailQuery.isError && !detail))

  if (detailQuery.isLoading) {
    return (
      <Container>
        <div className="g-collection-detail-skeleton" aria-hidden="true">
          <Skeleton variant="text" width={180} height={18} />
          <Skeleton variant="text" width="min(420px, 90%)" height={34} />
          <Skeleton variant="rect" height={22} />
          <div className="g-photo-grid">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <Skeleton key={index} variant="rect" height={200} />
            ))}
          </div>
        </div>
      </Container>
    )
  }

  if (detailQuery.isError && !isNotFound(detailQuery.error)) {
    return (
      <Container>
        <ErrorState
          title="收藏夹加载失败"
          error={detailQuery.error}
          onRetry={() => void detailQuery.refetch()}
        />
      </Container>
    )
  }

  if (missing || hidden || !detail) {
    return (
      <Container>
        <EmptyState
          icon={Lock}
          title="这个收藏夹不存在或不可见"
          description="它可能已被删除，或者作者把它设成了「仅自己可见」。问问作者要个链接吧。"
          actions={[{ label: '浏览作品墙', to: '/gallery' }]}
        />
      </Container>
    )
  }

  const meta = VISIBILITY_META[visibility]

  return (
    <Container>
      <PageHeader
        title={detail.title}
        description={detail.description || '这个收藏夹还没有简介。'}
        breadcrumbs={[{ label: '作品墙', to: '/gallery' }, { label: detail.title }]}
      >
        <div className="g-collection-detail-bar">
          {ownerUsername !== '' && (
            <p className="g-collection-detail-owner">
              作者：
              <Link to={`/u/${ownerUsername}`}>{detail.ownerDisplayName || `@${ownerUsername}`}</Link>
            </p>
          )}
          <p className="g-collection-detail-meta">
            <span>{detail.itemCount} 件作品</span>
            <Badge tone={meta.tone} size="sm">
              {meta.label}
            </Badge>
            {visibility === 'private' && isOwner && (
              <span className="g-collection-detail-private">
                <Lock aria-hidden="true" /> 只有你自己能看到这个收藏夹
              </span>
            )}
          </p>
        </div>
      </PageHeader>

      <PhotoGrid
        photos={items}
        showAuthor
        loading={itemsQuery.isLoading}
        error={itemsQuery.isError ? itemsQuery.error : undefined}
        onRetry={() => void itemsQuery.refetch()}
        hasMore={Boolean(itemsQuery.hasNextPage)}
        onLoadMore={() => {
          if (itemsQuery.hasNextPage && !itemsQuery.isFetchingNextPage) void itemsQuery.fetchNextPage()
        }}
        emptyTitle={isOwner ? '这个收藏夹还没有作品' : '这个收藏夹还没有公开的作品'}
        emptyActions={isOwner ? [{ label: '去找喜欢的作品', to: '/gallery' }] : []}
      />
    </Container>
  )
}
