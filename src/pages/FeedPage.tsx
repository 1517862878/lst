/**
 * 关注动态 /feed（S8）。
 *
 * 只显示「我关注的人」发的作品。空态必须给出下一步动作：动态页是唯一一个
 * 内容完全由关注关系决定的页面，空着的时候用户最容易以为功能坏了
 * （其实是还没关注任何人），所以要直接把他推去发现作者。
 *
 * 8.3c：列表逻辑抽到 features/social/FollowingFeed（与首页「关注」Tab 共用），
 * 这里只保留页面外壳，避免两处各写一份去重与空态。
 */
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireAuth } from '@/components/layout/guards'
import { FollowingFeed } from '@/features/social/FollowingFeed'
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

  return (
    <Container>
      <PageHeader
        title="关注动态"
        description={isApi ? '你关注的作者最近发布的作品' : '你关注的作者最近发布的作品（本机演示数据）'}
        breadcrumbs={[{ label: '首页', to: '/' }, { label: '关注动态' }]}
      />
      <FollowingFeed />
    </Container>
  )
}
