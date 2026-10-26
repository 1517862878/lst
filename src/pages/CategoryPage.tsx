/**
 * 分类作品墙 /categories/:slug（FRONTEND-WORK §2.5）。
 */
import { useParams } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { PhotoGrid } from '@/features/photos/PhotoGrid'
import type { Photo } from '@/domain/types'
import { useCategory } from '@/hooks/useContent'
import { usePhotos } from '@/hooks/usePhotos'

export function CategoryPage() {
  const { slug = '' } = useParams()
  const categoryQuery = useCategory(slug)
  const { data, isLoading } = usePhotos({ sort: 'latest', categorySlug: slug, limit: 24 })

  const photos: Photo[] = data?.pages.flatMap((p) => p.items) ?? []

  return (
    <Container>
      <PageHeader
        title={categoryQuery.data?.name ?? '分类'}
        {...(categoryQuery.data?.description ? { description: categoryQuery.data.description } : {})}
        breadcrumbs={[{ label: '分类', to: '/categories' }, { label: categoryQuery.data?.name ?? slug }]}
      />
      <PhotoGrid photos={photos} loading={isLoading} />
    </Container>
  )
}
