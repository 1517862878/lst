/**
 * 搜索页：URL 为唯一状态，支持作品 / 用户 / 标签。
 *
 * 8.3a 增强三件事：
 *   · 标签 Tab —— 标签是「主题」这一层的一等实体，只把它塞进作品筛选里当附属条件
 *     会让「有哪些标签、各自多少作品」这类问题无处可问；
 *   · 最近搜索 —— 复用上次的关键词是最常见的搜索行为，放在搜索框下面一排胶囊；
 *   · 输入建议 —— 300ms 防抖 + 键盘可选（见 SearchCombobox）。
 */
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { Tabs, TabsPrimitive } from '@/components/ui/Tabs'
import { FollowButton } from '@/features/social/FollowButton'
import { HighlightedText } from '@/features/search/HighlightedText'
import { SearchCombobox } from '@/features/search/SearchCombobox'
import { TagLink } from '@/features/tags/TagLink'
import { useRecentSearches } from '@/hooks/useRecentSearches'
import { useSearch, useUserSearch } from '@/hooks/useSearch'
import { useTagSearchList } from '@/hooks/useTags'
import { CATEGORIES } from '@/domain/constants'
import { normalizeSearchText, parseTags } from '@/lib/search/normalize'
import { accountImageUrl } from '@/lib/account'
import type { Photo, UserHit } from '@/domain/types'
import type { SearchQuery } from '@/data/contracts'

const TRENDING_TAGS = ['夜景', '街头', '建筑', '长曝光', '黑白']
type SearchSort = NonNullable<SearchQuery['sort']>
type SearchTab = 'works' | 'users' | 'tags'

export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const tab = parseTab(params.get('tab'))
  const categorySlug = params.get('category') ?? ''
  const tagsText = params.get('tags') ?? ''
  const locationName = params.get('location') ?? ''
  const sort = parseSort(params.get('sort'))
  const recent = useRecentSearches()

  const tags = useMemo(() => parseTags(tagsText), [tagsText])
  const query: SearchQuery = {
    text: q,
    ...(categorySlug ? { categorySlug } : {}),
    ...(tags.length ? { tags } : {}),
    ...(locationName ? { locationName } : {}),
    sort,
    limit: 100,
  }
  const works = useSearch(query)
  const users = useUserSearch(q)
  const hasWorkFilters = Boolean(q || categorySlug || tags.length || locationName)
  const activeQuery = tab === 'users' ? users : works

  const updateParam = (name: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(name, value)
    else next.delete(name)
    setParams(next, { replace: true })
  }

  /** 提交关键词：写回 URL（tab 保持）并记入最近搜索 */
  const submitTerm = (term: string) => {
    const next = new URLSearchParams(params)
    const value = term.trim()
    if (value) next.set('q', value)
    else next.delete('q')
    setParams(next)
    if (value) recent.push(value)
  }

  const applyTag = (tag: string) => {
    const next = new URLSearchParams(params)
    next.set('tags', tag)
    next.set('tab', 'works')
    setParams(next, { replace: true })
  }

  const changeTab = (value: string) => {
    const next = new URLSearchParams(params)
    next.set('tab', value)
    setParams(next, { replace: true })
  }

  return (
    <Container>
      <PageHeader title="搜索" description="搜索社区作品、摄影师与标签" />
      <SearchCombobox
        initialQuery={q}
        onSubmitQuery={submitTerm}
        onPickTag={(tag) => {
          recent.push(tag)
          const next = new URLSearchParams()
          next.set('tab', 'tags')
          next.set('q', tag)
          setParams(next)
        }}
        busy={activeQuery.isFetching}
      />

      {recent.items.length > 0 && (
        <div className="g-search-recent" role="group" aria-label="最近搜索">
          <span className="g-search-recent-label">最近搜索</span>
          {recent.items.map((term) => (
            <button
              key={term}
              type="button"
              className="g-search-recent-chip"
              onClick={() => submitTerm(term)}
            >
              {term}
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={recent.clear}>
            清空
          </Button>
        </div>
      )}

      <Tabs
        items={[
          { value: 'works', label: '作品' },
          { value: 'users', label: '用户' },
          { value: 'tags', label: '标签' },
        ]}
        value={tab}
        onValueChange={changeTab}
      >
        <TabsPrimitive.Content value="works" className="g-tabs-content">
          <div className="g-search-filter-panel" aria-label="作品筛选">
            <label className="g-search-filter-field">
              <span>分类</span>
              <select value={categorySlug} onChange={(event) => updateParam('category', event.target.value)}>
                <option value="">全部分类</option>
                {CATEGORIES.map((category) => (
                  <option key={category.slug} value={category.slug}>
                    {category.name}
                  </option>
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
          {hasWorkFilters && (
            <div className="g-search-filters">
              <span>
                {works.isFetching
                  ? '正在更新结果…'
                  : `已应用 ${[q, categorySlug, tags.length, locationName].filter(Boolean).length} 项筛选`}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setParams({ tab: 'works' }, { replace: true })}>
                清除全部
              </Button>
            </div>
          )}
          {hasWorkFilters && !works.isLoading && !works.isError && (
            <p className="g-search-result-count" role="status" aria-live="polite">
              共 {works.data?.items.length ?? 0} 个结果
            </p>
          )}
          {works.isError ? (
            <ErrorState title="搜索失败" error={works.error} onRetry={() => void works.refetch()} />
          ) : hasWorkFilters && works.data ? (
            <SearchResultList
              photos={works.data.items}
              terms={normalizeSearchText(q).split(' ').filter(Boolean)}
              onTag={applyTag}
            />
          ) : (
            !works.isLoading && <SearchStart onTag={applyTag} />
          )}
        </TabsPrimitive.Content>

        <TabsPrimitive.Content value="users" className="g-tabs-content">
          {!q.trim() ? (
            <div className="g-search-empty">
              <h2>搜索用户</h2>
              <p>输入昵称或用户名，找到你感兴趣的摄影师。</p>
            </div>
          ) : users.isError ? (
            <ErrorState title="用户搜索失败" error={users.error} onRetry={() => void users.refetch()} />
          ) : users.isLoading ? (
            <p className="g-placeholder-text" role="status">
              正在搜索用户…
            </p>
          ) : (
            <UserResultList users={users.data ?? []} />
          )}
        </TabsPrimitive.Content>

        <TabsPrimitive.Content value="tags" className="g-tabs-content">
          <TagResultList query={q} />
        </TabsPrimitive.Content>
      </Tabs>
    </Container>
  )
}

/** 标签 Tab：与 /tags 总览同一个聚合端点，只是把前缀过滤交给服务端 */
function TagResultList({ query }: { query: string }) {
  const prefix = query.trim()
  const { data, isLoading, error, refetch } = useTagSearchList(prefix, 50)

  if (error) return <ErrorState title="标签搜索失败" error={error} onRetry={() => void refetch()} />
  if (isLoading) {
    return (
      <p className="g-placeholder-text" role="status">
        正在搜索标签…
      </p>
    )
  }
  const items = data ?? []
  if (items.length === 0) {
    return (
      <div className="g-search-empty">
        <h2>没有匹配的标签</h2>
        <p>输入更短的前缀试试，或者去标签总览看看全站热门主题。</p>
        <Link to="/tags" className="g-btn g-btn-secondary">
          浏览全部标签
        </Link>
      </div>
    )
  }
  return (
    <ul className="g-tag-search-list" aria-label="标签搜索结果">
      {items.map((item) => (
        <li key={item.tag} className="g-tag-search-item">
          <TagLink tag={item.tag} count={item.photoCount} size="md" />
          <span className="g-tag-search-meta">{item.authorCount} 位作者</span>
        </li>
      ))}
    </ul>
  )
}

function UserResultList({ users }: { users: UserHit[] }) {
  if (!users.length) {
    return (
      <div className="g-search-empty">
        <h2>没有匹配用户</h2>
        <p>试试完整用户名或更短的昵称。</p>
      </div>
    )
  }
  return (
    <ul className="g-user-search-list" aria-label="用户搜索结果">
      {users.map((user) => (
        <li key={user.username} className="g-user-search-item">
          <Link to={`/u/${user.username}`} className="g-user-search-main">
            <Avatar src={accountImageUrl(user.avatarKey)} name={user.displayName || user.username} size={48} />
            <span className="g-user-search-copy">
              <strong>{user.displayName || user.username}</strong>
              <span>@{user.username}</span>
              {user.bio && <small>{user.bio}</small>}
              <small>{user.followerCount} 位粉丝</small>
            </span>
          </Link>
          <FollowButton username={user.username} />
        </li>
      ))}
    </ul>
  )
}

function SearchStart({ onTag }: { onTag: (tag: string) => void }) {
  return (
    <div className="g-search-empty">
      <h2>从热门主题开始</h2>
      <p>输入关键词，或先选择一个标签与分类。</p>
      <div className="g-search-suggestions">
        {TRENDING_TAGS.map((tag) => (
          <Button key={tag} variant="secondary" size="sm" onClick={() => onTag(tag)}>
            #{tag}
          </Button>
        ))}
      </div>
      <Link to="/tags" className="g-btn g-btn-secondary">
        浏览全部标签
      </Link>
    </div>
  )
}

function SearchResultList({
  photos,
  terms,
  onTag,
}: {
  photos: Photo[]
  terms: string[]
  onTag: (tag: string) => void
}) {
  if (!photos.length) {
    return (
      <div className="g-search-empty">
        <h2>没有匹配结果</h2>
        <p>试试更短的关键词、清除部分筛选，或从热门标签重新开始。</p>
      </div>
    )
  }
  return (
    <div className="g-search-results">
      {photos.map((photo) => (
        <SearchResultItem key={photo.id} photo={photo} terms={terms} onTag={onTag} />
      ))}
    </div>
  )
}

function SearchResultItem({
  photo,
  terms,
  onTag,
}: {
  photo: Photo
  terms: string[]
  onTag: (tag: string) => void
}) {
  return (
    <article className="g-search-result-item">
      <Link to={`/works/${photo.id}`} className="g-search-result-body">
        <h3 className="g-search-result-title">
          <HighlightedText text={photo.title} terms={terms} />
        </h3>
        {photo.description && (
          <p className="g-search-result-desc">
            <HighlightedText text={photo.description.slice(0, 120)} terms={terms} />
          </p>
        )}
        {photo.locationName && (
          <p className="g-search-result-meta">
            <span>📍 {photo.locationName}</span>
          </p>
        )}
      </Link>
      <div className="g-search-result-meta" aria-label="作品标签">
        {photo.tags.map((tag) => (
          <button key={tag} type="button" className="g-search-result-tag" onClick={() => onTag(tag)}>
            #{tag}
          </button>
        ))}
      </div>
    </article>
  )
}

function parseTab(value: string | null): SearchTab {
  return value === 'users' || value === 'tags' ? value : 'works'
}

function parseSort(value: string | null): SearchSort {
  return value === 'latest' || value === 'hot' ? value : 'relevance'
}
