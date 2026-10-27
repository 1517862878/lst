import { Outlet } from 'react-router'
import { Footer } from './Footer'
import { Header } from './Header'
import { PixelStarsBackground } from './PixelStarsBackground'
import { useSession } from '@/hooks/useSession'

/**
 * 全站外壳：星空背景 + Header + 主内容 + Footer（FRONTEND-WORK §3.2 Shell）。
 *
 * 登录态由 Shell 自己订阅（useSession），不再经由路由层用 props 透传：
 * 原先的 `sessionUser = null` 默认值会把"上游忘了传"静默降级成"永远显示未登录"，
 * 而 useSession 内部是 useSyncExternalStore，登录/登出/其它标签页变更都会自动刷新。
 */
export function Shell() {
  // useSession() 是 TanStack Query 的查询结果，取 data（Session | null；未登录为 null）
  const { data: sessionUser = null } = useSession()
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
