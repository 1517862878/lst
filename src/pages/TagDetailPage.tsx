/**
 * 标签详情页 /tags/:tag（标签体系 8.3a）。
 *
 * 排序（最新 / 热门）写进 URL：标签页是要被分享、被收藏的，
 * 把排序放在组件 state 里意味着「发出去的链接永远回到最新」。
 */
import { Link, useParams, useSearchParams } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { Section } from '@/components/layout/Section'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { PhotoGrid } from '@/features/photos/PhotoGrid'
import { TagLink } from '@/features/tags/TagLink'
import { useTagDetail, useTagPhotos } from '@/hooks/useTags'
import { TAG_MAX_LENGTH, isValidTag } from '@/domain/tags'
import type { TagPhotoSort } from '@/data/contracts'
import { relativeTime } from '@/lib/time'

function parseSort(value: string | null): TagPhotoSort {
  return value === 'popular' ? 'popular' : 'latest'
}

export function TagDetailPage() {
  const { tag = '' } = useParams()
  const [params] = useSearchParams()
  const sort = parseSort(params.get('sort'))
  const valid = isValidTag(tag)

  const detailQuery = useTagDetail(valid ? tag : '')
  const photosQuery = useTagPhotos(valid ? tag : '', sort)
  const detail = detailQuery.data
  const photos = photosQuery.data?.pages.flatMap((page) => page.items) ?? []

  if (!valid) {
    return (
      <Container>
        <PageHeader title="标签" breadcrumbs={[{ label: '标签', to: '/tags' }, { label: '无效标签' }]} />
        <EmptyState
          title="这个标签无效"
          description={`标签不能为空，且不超过 ${TAG_MAX_LENGTH} 个字符。`}
          actions={[{ label: '浏览全部标签', to: '/tags' }]}
        />
      </Container>
    )
  }

  return (
    <Container>
      <PageHeader
        title={`#${detail?.tag || tag}`}
        breadcrumbs={[{ label: '标签', to: '/tags' }, { label: `#${tag}` }]}
        description="这一标签下的全部已发布作品。"
      >
        <div className="g-tag-detail-bar">
          <div className="g-tag-sort" role="group" aria-label="作品排序">
            <SortLink active={sort === 'latest'} to={`/tags/${encodeURIComponent(tag)}`} label="最新" />
            <SortLink
              active={sort === 'popular'}
              to={`/tags/${encodeURIComponent(tag)}?sort=popular`}
              label="热门"
            />
          </div>
          <dl className="g-tag-stats" aria-label="标签统计">
            <div>
              <dt>作品</dt>
              <dd>{detail ? detail.photoCount : '—'}</dd>
            </div>
            <div>
              <dt>作者</dt>
              <dd>{detail ? detail.authorCount : '—'}</dd>
            </div>
            <div>
              <dt>最近更新</dt>
              <dd>{detail?.latestPublishedAt ? relativeTime(detail.latestPublishedAt) : '—'}</dd>
            </div>
          </dl>
        </div>
      </PageHeader>

      {detailQuery.isError ? (
        <ErrorState
          title="标签加载失败"
          error={detailQuery.error}
          onRetry={() => void detailQuery.refetch()}
        />
      ) : (
        <PhotoGrid
          photos={photos}
          showAuthor
          loading={photosQuery.isLoading}
          error={photosQuery.isError ? photosQuery.error : undefined}
          onRetry={() => void photosQuery.refetch()}
          hasMore={Boolean(photosQuery.hasNextPage)}
          onLoadMore={() => {
            if (photosQuery.hasNextPage && !photosQuery.isFetchingNextPage) {
              void photosQuery.fetchNextPage()
            }
          }}
          emptyTitle={`还没有作品使用 #${detail?.tag || tag}`}
          emptyActions={[
            { label: '浏览作品墙', to: '/gallery' },
            { label: '看看其他标签', to: '/tags' },
          ]}
        />
      )}

      {detail && detail.relatedTags.length > 0 && (
        <Section title="相关标签">
          <ul className="g-tag-chips" aria-label="相关标签">
            {detail.relatedTags.map((related) => (
              <li key={related.tag}>
                <TagLink tag={related.tag} count={related.count} size="md" />
              </li>
            ))}
          </ul>
          <p className="g-tag-note">相关标签 = 与 #{detail.tag} 出现在同一作品上的其他标签。</p>
        </Section>
      )}

      <p className="g-tag-back">
        <Link to="/tags">← 返回全部标签</Link>
      </p>
    </Container>
  )
}

/**
 * 排序链接：就是真链接（URL 即状态）。
 * 不用按钮 + navigate：真链接能中键新开、能被复制分享，屏幕阅读器也能读 aria-current。
 */
function SortLink({ active, to, label }: { active: boolean; to: string; label: string }) {
  return (
    <Link to={to} className="g-tag-sort-link" aria-current={active ? 'true' : undefined}>
      {label}
    </Link>
  )
}
