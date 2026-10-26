/**
 * 主题文章列表 /learn/topics/:topic（FRONTEND-WORK §2.11）。
 */
import { Link, useParams } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { useArticles, useTopics } from '@/hooks/useContent'
import { formatDate } from '@/lib/time'

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: '入门',
  intermediate: '进阶',
  advanced: '高级',
}

export function LearnTopicPage() {
  const { topic = '' } = useParams()
  const topicsQuery = useTopics()
  const articlesQuery = useArticles({ topicSlug: topic, limit: 50 })

  const topicInfo = topicsQuery.data?.find((t) => t.slug === topic)

  return (
    <Container>
      <PageHeader
        title={topicInfo?.name ?? '主题'}
        {...(topicInfo?.description ? { description: topicInfo.description } : {})}
        breadcrumbs={[{ label: '学习板块', to: '/learn' }, { label: topicInfo?.name ?? topic }]}
      />

      <ul className="g-article-list" aria-label="主题文章列表">
        {(articlesQuery.data?.items ?? []).map((a) => (
          <li key={a.id}>
            <Link to={`/learn/${a.slug}`} className="g-article-list-item">
              <div className="g-article-list-main">
                <h3 className="g-article-list-title">{a.title}</h3>
                <p className="g-article-list-summary">{a.summary}</p>
              </div>
              <div className="g-article-list-meta">
                <Badge tone="info">{DIFFICULTY_LABELS[a.difficulty] ?? a.difficulty}</Badge>
                <span className="g-article-list-date">{formatDate(a.updatedAt)}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {(articlesQuery.data?.items.length ?? 0) === 0 && (
        <p className="g-placeholder-text">该主题暂无文章。</p>
      )}
    </Container>
  )
}
