/**
 * 学习板块首页 /learn（FRONTEND-WORK §2.10）。
 * 主题卡 + 最新文章列表。
 */
import { Link } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { Section } from '@/components/layout/Section'
import { Skeleton } from '@/components/ui/Skeleton'
import { Badge } from '@/components/ui/Badge'
import { useArticles, useTopics } from '@/hooks/useContent'
import { formatDate } from '@/lib/time'

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: '入门',
  intermediate: '进阶',
  advanced: '高级',
}

export function LearnHomePage() {
  const topicsQuery = useTopics()
  const articlesQuery = useArticles({ limit: 20 })

  return (
    <Container>
      <PageHeader title="学习板块" description="拍摄技巧、器材、后期与版权的实用教程" />

      <Section title="主题">
        <div className="g-topic-grid" aria-label="学习主题">
          {(topicsQuery.data ?? []).map((t) => (
            <Link key={t.slug} to={`/learn/topics/${t.slug}`} className="g-topic-card">
              <h3 className="g-topic-card-name">{t.name}</h3>
              <p className="g-topic-card-desc">{t.description}</p>
            </Link>
          ))}
        </div>
      </Section>

      <Section title="最新文章">
        {articlesQuery.isLoading ? (
          <div className="g-detail-skeleton" aria-hidden="true">
            <Skeleton variant="rect" height={80} />
            <Skeleton variant="rect" height={80} />
            <Skeleton variant="rect" height={80} />
          </div>
        ) : (
          <ul className="g-article-list" aria-label="文章列表">
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
        )}
      </Section>
    </Container>
  )
}
