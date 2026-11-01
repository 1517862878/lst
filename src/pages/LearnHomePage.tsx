/**
 * 学习板块首页 /learn（FRONTEND-WORK §2.10）。
 * 主题卡 + 最新文章列表 + 写教程入口。
 *
 * 0039 起文章不再预置：首屏可能是空的，所以「最新文章」必须有空态，
 * 而且空态要把「写第一篇」作为下一步动作 —— 否则这里就是一个死胡同。
 */
import { Link } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { Section } from '@/components/layout/Section'
import { Skeleton } from '@/components/ui/Skeleton'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { useArticles, useTopics } from '@/hooks/useContent'
import { useSession } from '@/hooks/useSession'
import { formatDate } from '@/lib/time'

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: '入门',
  intermediate: '进阶',
  advanced: '高级',
}

export function LearnHomePage() {
  const topicsQuery = useTopics()
  const articlesQuery = useArticles({ limit: 20 })
  const { data: session } = useSession()
  const articles = articlesQuery.data?.items ?? []

  return (
    <Container>
      <PageHeader
        title="学习板块"
        description="拍摄技巧、器材、后期与版权的实用教程"
        actions={
          <Link to="/learn/write" className="g-btn g-btn-primary g-btn-sm">
            写教程
          </Link>
        }
      />

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
        ) : articles.length === 0 ? (
          <EmptyState
            title="还没有教程"
            description={
              session
                ? '学习板块现在只收录作者自己写的文章。你可以写下第一篇。'
                : '学习板块只收录作者自己写的文章。登录后即可发布。'
            }
            actions={
              session
                ? [{ label: '写第一篇教程', to: '/learn/write' }]
                : [{ label: '登录后发布', to: '/login?next=%2Flearn%2Fwrite' }]
            }
          />
        ) : (
          <ul className="g-article-list" aria-label="文章列表">
            {articles.map((a) => (
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
