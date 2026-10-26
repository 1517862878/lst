import { Outlet } from 'react-router'
import { Footer } from './Footer'
import { Header } from './Header'

export interface ShellProps {
  /** 页头会话信息（登录态）；静态期由 useSession 提供 */
  sessionUser?: { id: string; username: string; displayName: string } | null
}

/** 全站外壳：Header + 主内容 + Footer + 演示模式角标（FRONTEND-WORK §3.2 Shell） */
export function Shell({ sessionUser = null }: ShellProps) {
  return (
    <>
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
