import { Outlet } from 'react-router'
import { Footer } from './Footer'
import { Header } from './Header'
import { PixelStarsBackground } from './PixelStarsBackground'

export interface ShellProps {
  /** 页头会话信息（登录态）；静态期由 useSession 提供 */
  sessionUser?: { id: string; username: string; displayName: string } | null
}

/** 全站外壳：星空背景 + Header + 主内容 + Footer（FRONTEND-WORK §3.2 Shell） */
export function Shell({ sessionUser = null }: ShellProps) {
  return (
    <>
      {/* 像素星空背景：仅深色主题显示，z-index -1 垫在内容之下 */}
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
