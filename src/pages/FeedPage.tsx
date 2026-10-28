/**
 * 关注动态 /feed（S8）。
 *
 * 只显示「我关注的人」发的作品。空态必须给出下一步动作：动态页是唯一一个
 * 内容完全由关注关系决定的页面，空着的时候用户最容易以为功能坏了
 * （其实是还没关注任何人），所以要直接把他推去发现作者。
 */
import { useMemo } from 'react'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireAuth } from '@/components/layout/guards'
import { PhotoGrid } from '@/features/photos/PhotoGrid'
import { useFeed } from '@/hooks/useSocial'
import { dataSource } from '@/data'

export function FeedPage() {
  return (
    <RequireAuth>
      <FeedInner />
    </RequireAuth>
  )
}

function FeedInner() {
  const isApi = dataSource() === 'api'
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, error, refetch } = useFeed()

  // 翻页边界上同一条作品可能被两页同时返回（游标按 created_at 排序时的经典问题），
  // 这里按 id 去重：重复的 key 会让 React 报错，也会让用户看到两张一样的卡
  const photos = useMemo(() => {
    const flat = data?.pages.flatMap((page) => page.items) ?? []
    return flat.filter((photo, index) => flat.findIndex((other) => other.id === photo.id) === index)
  }, [data])

  return (
    <Container>
      <PageHeader
        title="关注动态"
        description={isApi ? '你关注的作者最近发布的作品' : '你关注的作者最近发布的作品（本机演示数据）'}
        breadcrumbs={[{ label: '首页', to: '/' }, { label: '关注动态' }]}
      />
      <PhotoGrid
        photos={photos}
        showAuthor
        loading={isLoading || isFetchingNextPage}
        error={error}
        onRetry={() => void refetch()}
        hasMore={Boolean(hasNextPage) && !isFetchingNextPage}
        onLoadMore={() => void fetchNextPage()}
        emptyTitle="关注动态还是空的"
        emptyActions={[
          { label: '去作品墙发现作者', to: '/gallery' },
          { label: '看看周榜', to: '/rankings/weekly' },
        ]}
      />
    </Container>
  )
}
