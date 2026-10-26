/**
 * 我的 /me（FRONTEND-WORK §2.18）。
 * 快捷入口：我的作品/我的收藏/我的喜欢 + 草稿续填。
 */
import { Link } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { RequireAuth } from '@/components/layout/guards'
import { useSession } from '@/hooks/useSession'

export function MePage() {
  return (
    <RequireAuth>
      <MeInner />
    </RequireAuth>
  )
}

function MeInner() {
  const { data: session } = useSession()
  const username = session?.username ?? ''

  return (
    <Container size="sm">
      <PageHeader title="我的" description={`欢迎，@${username}`} />
      <nav className="g-me-menu" aria-label="我的快捷入口">
        <Link to={`/u/${username}`} className="g-me-item">
          <span className="g-me-item-title">我的主页</span>
          <span className="g-me-item-desc">查看作品 / 喜欢 / 收藏</span>
        </Link>
        <Link to="/publish" className="g-me-item">
          <span className="g-me-item-title">发布作品</span>
          <span className="g-me-item-desc">上传相片与心得</span>
        </Link>
        <Link to="/settings/profile" className="g-me-item">
          <span className="g-me-item-title">资料设置</span>
          <span className="g-me-item-desc">昵称 / 简介 / 授权偏好</span>
        </Link>
      </nav>
    </Container>
  )
}
