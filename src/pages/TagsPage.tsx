/**
 * 标签总览页 /tags（标签体系 8.3a）。
 *
 * 两段结构而不是双 Tab：热门与最新是两种「浏览姿势」，同时可见比来回切换更有用
 * （标签总览本身很短，没有必要为它引入一层 Tab 语义与键盘焦点管理）。
 */
import { Link } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { Section } from '@/components/layout/Section'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { TagLink } from '@/features/tags/TagLink'
import { useTags } from '@/hooks/useTags'
import type { TagSummary } from '@/data/contracts'
import { relativeTime } from '@/lib/time'

/** 热门标签云的档位：按相对最大计数分三档（绝对数值会随库大小漂移，比例不会） */
function cloudSize(count: number, max: number): 'sm' | 'md' | 'lg' {
  if (max <= 0) return 'sm'
  const ratio = count / max
  if (ratio >= 0.6) return 'lg'
  if (ratio >= 0.3) return 'md'
  return 'sm'
}

export function TagsPage() {
  const hotQuery = useTags({ sort: 'hot', limit: 50 })
  const latestQuery = useTags({ sort: 'latest', limit: 12 })

  const hot = hotQuery.data ?? []
  const latest = latestQuery.data ?? []
  const maxCount = hot.reduce((max, tag) => Math.max(max, tag.photoCount), 0)
  const empty = !hotQuery.isLoading && !hotQuery.isError && hot.length === 0

  return (
    <Container>
      <PageHeader
        title="标签"
        description="按主题浏览全站作品：热门标签按作品数排序，最新标签按最近发布时间排序。"
        breadcrumbs={[{ label: '标签' }]}
        actions={
          <Link to="/search" className="g-btn g-btn-secondary g-btn-sm">
            搜索标签
          </Link>
        }
      />

      {hotQuery.isError ? (
        <ErrorState
          title="热门标签加载失败"
          error={hotQuery.error}
          onRetry={() => void hotQuery.refetch()}
        />
      ) : empty ? (
        <EmptyState
          title="还没有标签"
          description="作品发布时填写标签后，这里会自动汇总全站主题。"
          actions={[
            { label: '去发布作品', to: '/publish' },
            { label: '浏览作品墙', to: '/gallery' },
          ]}
        />
      ) : (
        <>
          <Section title="热门标签" action={{ label: '搜索标签', to: '/search' }}>
            {hotQuery.isLoading ? (
              <div className="g-tag-cloud" aria-hidden="true">
                {Array.from({ length: 12 }, (_, i) => (
                  <Skeleton key={i} variant="rect" width={72 + (i % 4) * 18} height={30} />
                ))}
              </div>
            ) : (
              <ul className="g-tag-cloud" aria-label="热门标签">
                {hot.map((tag) => (
                  <li key={tag.tag}>
                    <TagLink
                      tag={tag.tag}
                      count={tag.photoCount}
                      size={cloudSize(tag.photoCount, maxCount)}
                      className="g-tag-cloud-item"
                    />
                  </li>
                ))}
              </ul>
            )}
            <p className="g-tag-note">标签计数只统计已发布的作品。</p>
          </Section>

          <Section title="最新标签">
            {latestQuery.isLoading ? (
              <div className="g-tag-latest" aria-hidden="true">
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} variant="rect" height={64} />
                ))}
              </div>
            ) : latestQuery.isError ? (
              <ErrorState
                title="最新标签加载失败"
                error={latestQuery.error}
                onRetry={() => void latestQuery.refetch()}
              />
            ) : latest.length === 0 ? (
              <p className="g-placeholder-text">暂时没有最近更新的标签。</p>
            ) : (
              <ul className="g-tag-latest" aria-label="最新标签">
                {latest.map((tag) => (
                  <LatestTagItem key={tag.tag} tag={tag} />
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </Container>
  )
}

function LatestTagItem({ tag }: { tag: TagSummary }) {
  return (
    <li className="g-tag-latest-item">
      <TagLink tag={tag.tag} size="md" className="g-tag-latest-link" />
      <span className="g-tag-latest-meta">
        <span>{tag.photoCount} 件作品</span>
        <span aria-hidden="true">·</span>
        <span>{tag.authorCount} 位作者</span>
        {tag.latestPublishedAt && (
          <>
            <span aria-hidden="true">·</span>
            <span>更新于 {relativeTime(tag.latestPublishedAt)}</span>
          </>
        )}
      </span>
    </li>
  )
}
