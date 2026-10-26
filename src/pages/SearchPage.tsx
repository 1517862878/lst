/**
 * 搜索页 /search（FRONTEND-WORK §2.6）。
 * URL 即状态（?q=）；关键词高亮；分类/排序筛选；空态建议。
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { HighlightedText } from '@/features/search/HighlightedText'
import { useSearch } from '@/hooks/useSearch'
import type { Photo } from '@/domain/types'

export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const categorySlug = params.get('category') ?? ''
  const [input, setInput] = useState(q)

  useEffect(() => {
    setInput(q)
  }, [q])

  const { data: photos, isLoading } = useSearch(
    categorySlug ? { text: q, categorySlug } : { text: q },
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (input.trim()) next.q = input.trim()
    if (categorySlug) next.category = categorySlug
    setParams(next, { replace: true })
  }

  const clearFilters = () => setParams({}, { replace: true })

  return (
    <Container>
      <PageHeader title="搜索" description="按标题、心得、地点、标签查找作品" />

      <form className="g-search-bar" onSubmit={handleSubmit} role="search">
        <Input
          label="关键词"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="如：星空、长曝、街头…"
          aria-label="搜索关键词"
        />
        <Button type="submit">搜索</Button>
      </form>

      {categorySlug && (
        <div className="g-search-filters" role="status">
          <span>分类筛选：{categorySlug}</span>
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            清除筛选
          </Button>
        </div>
      )}

      {q && !isLoading && (
        <p className="g-search-result-count" role="status" aria-live="polite">
          共 {photos?.length ?? 0} 个结果
        </p>
      )}

      {q && photos ? (
        <SearchResultList photos={photos} terms={q.split(/\s+/).filter(Boolean)} />
      ) : (
        !isLoading && (
          <p className="g-placeholder-text">输入关键词开始搜索。</p>
        )
      )}
    </Container>
  )
}

function SearchResultList({ photos, terms }: { photos: Photo[]; terms: string[] }) {
  const list = useMemo(
    () => (
      <div className="g-search-results">
        {photos.map((p) => (
          <SearchResultItem key={p.id} photo={p} terms={terms} />
        ))}
      </div>
    ),
    [photos, terms],
  )
  if (photos.length === 0) {
    return (
      <div className="g-placeholder-text">
        没有匹配结果。试试更短的关键词，或浏览分类。
      </div>
    )
  }
  return list
}

function SearchResultItem({ photo, terms }: { photo: Photo; terms: string[] }) {
  return (
    // 用 Link 而非 <a href>：子路径部署（/lst/）时原生 href 会丢 base，点进 404
    <Link to={`/works/${photo.id}`} className="g-search-result-item">
      <div className="g-search-result-body">
        <h3 className="g-search-result-title">
          <HighlightedText text={photo.title} terms={terms} />
        </h3>
        {photo.description && (
          <p className="g-search-result-desc">
            <HighlightedText text={photo.description.slice(0, 120)} terms={terms} />
          </p>
        )}
        <p className="g-search-result-meta">
          {photo.locationName && <span>📍 {photo.locationName}</span>}
          {photo.tags.map((t) => (
            <span key={t} className="g-search-result-tag">
              #{t}
            </span>
          ))}
        </p>
      </div>
    </a>
  )
}
