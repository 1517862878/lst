/**
 * 我的工作台 /me。
 *
 * 8.3d 加了「数据」区：账号级汇总卡片 + 逐件作品数据表（见
 * features/stats/CreatorStatsSection.tsx）。这两块与页面其它部分**解耦**：
 * 统计接口失败只在原地降级成「数据暂不可用」，快捷入口与最近作品照常可用。
 *
 * 原来的三格「账号概览」（作品/收藏/喜欢）被九格数据卡取代：一个小格子里
 * 同时塞「我收藏了多少」与「我的作品被收藏了多少」两种语义，是这个块最容易被
 * 读错的地方；现在「收藏」只表示「我的作品被收藏的次数」，个人收藏夹从
 * 快捷入口进。
 */
import { Link } from 'react-router'
import { Container } from '@/components/layout/Container'
import { Avatar } from '@/components/ui/Avatar'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireAuth } from '@/components/layout/guards'
import { useSession } from '@/hooks/useSession'
import { usePhotosByUser } from '@/hooks/usePhotos'
import { PhotoGrid } from '@/features/photos/PhotoGrid'
import { CreatorStatsSection } from '@/features/stats/CreatorStatsSection'
import { PinnedWorksPicker } from '@/features/profiles/PinnedWorksPicker'
import { accountImageUrl } from '@/lib/account'

export function MePage() {
  return (
    <RequireAuth>
      <MeInner />
    </RequireAuth>
  )
}

function MeInner() {
  const { data: session } = useSession()
  const works = usePhotosByUser(session?.userId ?? '', 'works')
  const username = session?.username ?? ''

  return (
    <Container>
      <div className="g-dashboard-heading">
        <Avatar
          src={accountImageUrl(session?.avatarKey)}
          name={session?.displayName || username}
          size={64}
        />
        <PageHeader
          title="我的工作台"
          description={`欢迎回来，${session?.displayName || `@${username}`}`}
        />
      </div>

      <nav className="g-me-menu" aria-label="我的快捷入口">
        <Link to="/publish" className="g-me-item">
          <span className="g-me-item-title">发布作品</span>
          <span className="g-me-item-desc">上传相片与心得</span>
        </Link>
        <Link to={`/u/${username}`} className="g-me-item">
          <span className="g-me-item-title">查看个人主页</span>
          <span className="g-me-item-desc">作品、喜欢与收藏</span>
        </Link>
        <Link to="/me/collections" className="g-me-item">
          <span className="g-me-item-title">我的收藏夹</span>
          <span className="g-me-item-desc">按主题整理、分享作品</span>
        </Link>
        <Link to="/settings/profile" className="g-me-item">
          <span className="g-me-item-title">设置与隐私</span>
          <span className="g-me-item-desc">资料、隐私、设备与账号安全</span>
        </Link>
      </nav>

      <CreatorStatsSection />

      {/* 代表作选择器：数据复用上面的 works 查询，不额外请求 */}
      <PinnedWorksPicker photos={works.data ?? []} />

      <section className="g-me-section">
        <h2>最近作品</h2>
        <PhotoGrid
          photos={(works.data ?? []).slice(0, 4)}
          loading={works.isLoading}
          error={works.error}
          onRetry={() => void works.refetch()}
          emptyTitle="还没有作品"
          emptyActions={[{ label: '发布第一件作品', to: '/publish' }]}
        />
      </section>
    </Container>
  )
}
