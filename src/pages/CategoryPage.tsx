/**
 * 分类作品墙 /categories/:slug（FRONTEND-WORK §2.5）。
 */
import { useParams } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { PhotoGrid } from '@/features/photos/PhotoGrid'
import type { Photo } from '@/domain/types'
import { useCategory } from '@/hooks/useContent'
import { usePhotos } from '@/hooks/usePhotos'

export function CategoryPage() {
  const { slug = '' } = useParams()
  const categoryQuery = useCategory(slug)
  const { data, isLoading, error, refetch } = usePhotos({
    sort: 'latest',
    categorySlug: slug,
    limit: 24,
  })

  const photos: Photo[] = data?.pages.flatMap((p) => p.items) ?? []

  /*
   * 分类不存在（含已下架）时必须给出明确的「没找到」，而不是静默降级。
   *
   * 早先这里只读 categoryQuery.data?.name ?? '分类'，查询失败（后端 404）会退化成
   * 标题「分类」+ 面包屑里的原始 slug + 一片「还没有作品」——用户看到的是一个
   * 貌似合法、实际不存在的分类页，比直接说「没找到」更困惑。
   * 2026-11 分类换代后旧 slug（landscape 等）被软下架，这条路径会被真实访问到。
   */
  if (categoryQuery.isError) {
    return (
      <Container>
        <PageHeader
          title="分类不存在"
          breadcrumbs={[{ label: '分类', to: '/categories' }, { label: slug }]}
        />
        <EmptyState
          title="这个分类不存在或已下架"
          description={`「${slug}」不在当前的分类目录里。分类体系调整过一次，旧链接可能已经失效。`}
          actions={[
            { label: '看看全部分类', to: '/categories' },
            { label: '回作品墙', to: '/gallery' },
          ]}
        />
      </Container>
    )
  }

  return (
    <Container>
      <PageHeader
        title={categoryQuery.data?.name ?? '分类'}
        {...(categoryQuery.data?.description ? { description: categoryQuery.data.description } : {})}
        breadcrumbs={[{ label: '分类', to: '/categories' }, { label: categoryQuery.data?.name ?? slug }]}
      />
      <PhotoGrid
        photos={photos}
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
      />
    </Container>
  )
}
