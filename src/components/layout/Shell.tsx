import { Outlet } from 'react-router'
import { Footer } from './Footer'
import { Header } from './Header'
import { PixelStarsBackground } from './PixelStarsBackground'
import { useSession } from '@/hooks/useSession'

/**
 * 全站外壳：像素星空背景 + Header + 主内容 + Footer。
 * 会话状态在此订阅（路由以 <Shell /> 无 props 渲染），Header 据此
 * 显示「空白头像 → 登录/注册菜单」或「用户头像 → 用户菜单」。
 */
export function Shell() {
  const { data: session } = useSession()
  const sessionUser = session
    ? { id: session.userId, username: session.username, displayName: session.displayName }
    : null

  return (
    <>
      <PixelStarsBackground />
      <a className="g-skip-link" href="#main">
        跳到主内容
      </a>
      <Header sessionUser={sessionUser} />
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />
    </>
  )
}
