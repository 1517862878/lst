/**
 * 关注动态（8.3c 抽出的共用组件）。
 *
 * 为什么抽出来：首页「关注」Tab 与 /feed 页展示的是同一件东西，只是外壳与
 * 条数不同。以前首页里有一份复制品（HomeFollowingFeed + FollowingFeedGrid），
 * 两处各自处理去重/空态/未登录，改一处忘一处就会「首页能看、/feed 空白」。
 * 现在只有这一份逻辑，差异只通过 `limit`（首页只要前几条）与外壳体现。
 *
 * 三态必须分开：未登录（给登录入口 + 回跳）、加载中（骨架）、空（还没关注人）。
 */
import { Link } from 'react-router'
import { Skeleton } from '@/components/ui/Skeleton'
import { useSession } from '@/hooks/useSession'
import { useFeed } from '@/hooks/useSocial'
import { PhotoGrid } from '@/features/photos/PhotoGrid'

export interface FollowingFeedProps {
  /** 只显示前 N 条（首页）；不传 = 完整列表 + 无限滚动（/feed） */
  limit?: number
  /** 骨架数量；默认与 limit 对齐，未传 limit 时用 3 */
  skeletonCount?: number
}

export function FollowingFeed({ limit, skeletonCount }: FollowingFeedProps) {
  const { data: session, isLoading: sessionLoading } = useSession()

  if (sessionLoading) {
    return <FeedSkeleton count={skeletonCount ?? limit ?? 3} />
  }
  if (!session) {
    return (
      <div className="g-feed-switch-guest">
        <p>登录后这里会显示你关注的作者最近发布的作品。</p>
        <div className="g-hero-actions">
          <Link
            to={`/login?next=${encodeURIComponent('/?tab=following')}`}
            className="g-btn g-btn-primary g-btn-sm"
          >
            去登录
          </Link>
          <Link to="/gallery" className="g-btn g-btn-secondary g-btn-sm">
            先去发现作者
          </Link>
        </div>
      </div>
    )
  }
  return <FollowingFeedList {...(limit !== undefined ? { limit } : {})} />
}

function FeedSkeleton({ count }: { count: number }) {
  return (
    <div className="g-home-grid" aria-hidden="true">
      {Array.from({ length: Math.max(count, 1) }, (_, i) => (
        <Skeleton key={i} variant="rect" height={220} />
      ))}
    </div>
  )
}

function FollowingFeedList({ limit }: { limit?: number }) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, error, refetch } = useFeed()

  // 游标翻页在边界上可能返回重复项，按 id 去重后再渲染（重复 key 会让 React 报错）
  const photos = (data?.pages.flatMap((page) => page.items) ?? []).filter(
    (photo, index, all) => all.findIndex((other) => other.id === photo.id) === index,
  )
  const visible = limit ? photos.slice(0, limit) : photos

  return (
    <PhotoGrid
      photos={visible}
      showAuthor
      loading={isLoading || isFetchingNextPage}
      error={error}
      onRetry={() => void refetch()}
      // 首页只展示前几条，翻页交给「查看全部」
      hasMore={!limit && Boolean(hasNextPage) && !isFetchingNextPage}
      onLoadMore={() => void fetchNextPage()}
      emptyTitle="关注动态还是空的"
      emptyActions={[
        { label: '去作品墙发现作者', to: '/gallery' },
        { label: '看看周榜', to: '/rankings/weekly' },
      ]}
    />
  )
}
