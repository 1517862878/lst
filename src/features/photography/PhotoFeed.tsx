/**
 * 器材 / 地点的作品流外壳（8.4a）。
 *
 * 这两个页面与作品墙共用同一份游标分页契约（CursorListPage<Photo>），
 * 区别只在 queryKey 与筛选条件，所以把「拼页 + 去重 + 三态 + 加载更多」
 * 收在一处：任何一处改分页口径，四个入口一起生效。
 */
import { useMemo } from 'react'
import type { InfiniteData } from '@tanstack/react-query'
import type { CursorListPage } from '@/data/contracts'
import type { Photo } from '@/domain/types'
import { PhotoGrid } from '@/features/photos/PhotoGrid'

/** useInfiniteQuery 结果里本组件需要的部分（结构化即可传入） */
export interface PhotoFeedSource {
  data: InfiniteData<CursorListPage<Photo>> | undefined
  isLoading: boolean
  error: unknown
  refetch: () => unknown
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => unknown
}

export interface PhotoFeedProps {
  source: PhotoFeedSource
  emptyTitle?: string
  emptyDescription?: string
  showAuthor?: boolean
}

export function PhotoFeed({ source, emptyTitle, emptyDescription, showAuthor = false }: PhotoFeedProps) {
  const photos = useMemo(() => {
    // 游标按 id 全序，理论上不会重复；仍去重一次，避免翻页竞态把同一张作品画两遍
    const seen = new Set<string>()
    const merged: Photo[] = []
    for (const page of source.data?.pages ?? []) {
      for (const photo of page.items) {
        if (seen.has(photo.id)) continue
        seen.add(photo.id)
        merged.push(photo)
      }
    }
    return merged
  }, [source.data])

  return (
    <div className="g-photography-feed">
      {emptyDescription && photos.length === 0 && !source.isLoading && !source.error ? (
        <p className="g-photography-note">{emptyDescription}</p>
      ) : null}
      <PhotoGrid
        photos={photos}
        showAuthor={showAuthor}
        loading={source.isLoading || source.isFetchingNextPage}
        error={source.error}
        onRetry={() => void source.refetch()}
        hasMore={source.hasNextPage}
        onLoadMore={() => void source.fetchNextPage()}
        {...(emptyTitle === undefined ? {} : { emptyTitle })}
        emptyActions={[{ label: '去发布', to: '/publish' }]}
      />
    </div>
  )
}
