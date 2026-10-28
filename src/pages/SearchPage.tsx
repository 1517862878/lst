/** 搜索页：URL 为唯一状态，支持关键词、分类、标签、地点和排序。 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { HighlightedText } from '@/features/search/HighlightedText'
import { useSearch } from '@/hooks/useSearch'
import { CATEGORIES } from '@/domain/constants'
import { normalizeSearchText, parseTags } from '@/lib/search/normalize'
import type { Photo } from '@/domain/types'
import type { SearchQuery } from '@/data/contracts'

const TRENDING_TAGS = ['夜景', '街头', '建筑', '长曝光', '黑白']
type SearchSort = NonNullable<SearchQuery['sort']>

export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const categorySlug = params.get('category') ?? ''
  const tagsText = params.get('tags') ?? ''
  const locationName = params.get('location') ?? ''
  const sort = parseSort(params.get('sort'))
  const [input, setInput] = useState(q)

  useEffect(() => setInput(q), [q])

  const tags = useMemo(() => parseTags(tagsText), [tagsText])
  const query: SearchQuery = {
    text: q,
    ...(categorySlug ? { categorySlug } : {}),
    ...(tags.length ? { tags } : {}),
    ...(locationName ? { locationName } : {}),
    sort,
    limit: 100,
  }
  const { data, isLoading, isFetching, isError, error, refetch } = useSearch(query)
  const hasFilters = Boolean(q || categorySlug || tags.length || locationName)

  const updateParam = (name: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(name, value)
    else next.delete(name)
    setParams(next, { replace: true })
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    updateParam('q', input.trim())
  }

  const applyTag = (tag: string) => {
    const next = new URLSearchParams(params)
    next.set('tags', tag)
    setParams(next, { replace: true })
  }

  return (
    <Container>
      <PageHeader title="搜索" description="组合关键词、分类、标签与地点，精确找到感兴趣的作品" />

      <form className="g-search-bar" onSubmit={handleSubmit} role="search" aria-busy={isFetching}>
        <Input
          label="关键词"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="如：星空、长曝、街头…"
          aria-label="搜索关键词"
        />
        <Button type="submit" loading={isFetching}>搜索</Button>
      </form>

      <div className="g-search-filter-panel" aria-label="搜索筛选">
        <label className="g-search-filter-field">
          <span>分类</span>
          <select value={categorySlug} onChange={(event) => updateParam('category', event.target.value)}>
            <option value="">全部分类</option>
            {CATEGORIES.map((category) => (
              <option key={category.slug} value={category.slug}>{category.name}</option>
            ))}
          </select>
        </label>
        <label className="g-search-filter-field">
          <span>标签</span>
          <input
            value={tagsText}
            onChange={(event) => updateParam('tags', event.target.value)}
            placeholder="空格分隔，最多 5 个"
          />
        </label>
        <label className="g-search-filter-field">
          <span>地点</span>
          <input
            value={locationName}
            onChange={(event) => updateParam('location', event.target.value)}
            placeholder="城市或地点"
          />
        </label>
        <label className="g-search-filter-field">
          <span>排序</span>
          <select value={sort} onChange={(event) => updateParam('sort', event.target.value)}>
            <option value="relevance">相关度</option>
            <option value="latest">最新发布</option>
            <option value="hot">热门互动</option>
          </select>
        </label>
      </div>

      {hasFilters && (
        <div className="g-search-filters">
          <span>{isFetching ? '正在更新结果…' : `已应用 ${[q, categorySlug, tags.length, locationName].filter(Boolean).length} 项筛选`}</span>
          <Button variant="ghost" size="sm" onClick={() => setParams({}, { replace: true })}>清除全部</Button>
        </div>
      )}

      {hasFilters && !isLoading && !isError && (
        <p className="g-search-result-count" role="status" aria-live="polite">共 {data?.items.length ?? 0} 个结果</p>
      )}

      {isError ? (
        <ErrorState title="搜索失败" error={error} onRetry={() => void refetch()} />
      ) : hasFilters && data ? (
        <SearchResultList photos={data.items} terms={normalizeSearchText(q).split(' ').filter(Boolean)} onTag={applyTag} />
      ) : (
        !isLoading && <SearchStart onTag={applyTag} />
      )}
    </Container>
  )
}

function SearchStart({ onTag }: { onTag: (tag: string) => void }) {
  return (
    <div className="g-search-empty">
      <h2>从热门主题开始</h2>
      <p>输入关键词，或先选择一个标签与分类。</p>
      <div className="g-search-suggestions">
        {TRENDING_TAGS.map((tag) => <Button key={tag} variant="secondary" size="sm" onClick={() => onTag(tag)}>#{tag}</Button>)}
      </div>
      <Link to="/categories" className="g-btn g-btn-secondary">浏览全部分类</Link>
    </div>
  )
}

function SearchResultList({ photos, terms, onTag }: { photos: Photo[]; terms: string[]; onTag: (tag: string) => void }) {
  if (photos.length === 0) {
    return (
      <div className="g-search-empty">
        <h2>没有匹配结果</h2>
        <p>试试更短的关键词、清除部分筛选，或从热门标签重新开始。</p>
        <div className="g-search-suggestions">
          {TRENDING_TAGS.slice(0, 3).map((tag) => <Button key={tag} variant="secondary" size="sm" onClick={() => onTag(tag)}>#{tag}</Button>)}
        </div>
        <Link to="/categories" className="g-btn g-btn-secondary">浏览分类</Link>
      </div>
    )
  }
  return <div className="g-search-results">{photos.map((photo) => <SearchResultItem key={photo.id} photo={photo} terms={terms} onTag={onTag} />)}</div>
}

function SearchResultItem({ photo, terms, onTag }: { photo: Photo; terms: string[]; onTag: (tag: string) => void }) {
  return (
    <article className="g-search-result-item">
      <Link to={`/works/${photo.id}`} className="g-search-result-body">
        <h3 className="g-search-result-title"><HighlightedText text={photo.title} terms={terms} /></h3>
        {photo.description && <p className="g-search-result-desc"><HighlightedText text={photo.description.slice(0, 120)} terms={terms} /></p>}
        {photo.locationName && <p className="g-search-result-meta"><span>📍 {photo.locationName}</span></p>}
      </Link>
      <div className="g-search-result-meta" aria-label="作品标签">
        {photo.tags.map((tag) => (
          <button key={tag} type="button" className="g-search-result-tag" onClick={() => onTag(tag)}>#{tag}</button>
        ))}
      </div>
    </article>
  )
}

function parseSort(value: string | null): SearchSort {
  return value === 'latest' || value === 'hot' ? value : 'relevance'
}
