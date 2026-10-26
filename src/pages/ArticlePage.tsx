/**
 * 教程文章页 /learn/:slug（FRONTEND-WORK §2.12）。
 * Markdown 渲染（净化管线）+ 目录锚点 + 相关作品。
 */
import { useParams } from 'react-router'
import { Container } from '@/components/layout/Container'
import { Skeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/ErrorState'
import { ArticleReader } from '@/features/learn/ArticleReader'
import { useArticle } from '@/hooks/useContent'

export function ArticlePage() {
  const { slug = '' } = useParams()
  const articleQuery = useArticle(slug)

  if (articleQuery.isLoading) {
    return (
      <Container size="md">
        <div className="g-detail-skeleton" aria-hidden="true">
          <Skeleton variant="text" width={300} />
          <Skeleton variant="rect" height={200} />
        </div>
      </Container>
    )
  }

  if (articleQuery.isError || !articleQuery.data) {
    return (
      <Container>
        <ErrorState title="文章不存在" error={articleQuery.error} />
      </Container>
    )
  }

  return (
    <Container size="md">
      <ArticleReader article={articleQuery.data} />
    </Container>
  )
}
