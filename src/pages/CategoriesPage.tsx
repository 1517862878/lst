/**
 * 分类总览 /categories（FRONTEND-WORK §2.4）。
 * 8 个分类卡片 + 每类作品数 + 跳转。
 */
import { Link } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { Skeleton } from '@/components/ui/Skeleton'
import { useCategories } from '@/hooks/useContent'
import { usePhotos } from '@/hooks/usePhotos'

export function CategoriesPage() {
  const categoriesQuery = useCategories()

  if (categoriesQuery.isLoading) {
    return (
      <Container>
        <PageHeader title="分类总览" />
        <div className="g-category-grid" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} variant="rect" height={120} />
          ))}
        </div>
      </Container>
    )
  }

  const categories = categoriesQuery.data ?? []

  return (
    <Container>
      <PageHeader title="分类总览" description="按主题浏览作品（8 个分类）" />
      <div className="g-category-grid">
        {categories.map((c) => (
          <CategoryCard key={c.slug} slug={c.slug} name={c.name} description={c.description} />
        ))}
      </div>
    </Container>
  )
}

function CategoryCard({
  slug,
  name,
  description,
}: {
  slug: string
  name: string
  description: string
}) {
  return (
    <Link to={`/categories/${slug}`} className="g-category-card" aria-label={`查看分类：${name}`}>
      <h2 className="g-category-card-name">{name}</h2>
      <p className="g-category-card-desc">{description}</p>
      <CategoryCount slug={slug} />
    </Link>
  )
}

function CategoryCount({ slug }: { slug: string }) {
  // 每类作品数：用一次列表查询估算（S6 搜索索引会提供精确计数）
  const { data } = usePhotos({ sort: 'latest', categorySlug: slug, limit: 1 })
  return <span className="g-category-card-count">{data?.pages[0]?.total ?? '—'} 件</span>
}
