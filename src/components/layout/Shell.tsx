import { Outlet } from 'react-router'
import { Footer } from './Footer'
import { Header } from './Header'
import { SiteBackground } from './SiteBackground'
import { RestrictionBanner } from './RestrictionBanner'
import { useSession } from '@/hooks/useSession'

/**
 * 全站外壳：背景层 + Header + 主内容 + Footer（FRONTEND-WORK §3.2 Shell）。
 *
 * 背景层由 SiteBackground 负责（配色底 / 内置主体 / 用户照片三层）：
 * 原先 Shell 直接挂 PixelStarsBackground，现在星空只是「内置主体之一」，
 * 具体渲染哪个主体、是否让位给用户照片，都由外观设置决定。
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
      <SiteBackground />
      <a className="g-skip-link" href="#main">
        跳到主内容
      </a>
      <Header sessionUser={sessionUser} role={sessionUser?.role ?? null} />
      {/* 账号限制横幅：紧跟页头、压在全部路由内容之上；未登录/未受限时自身返回 null */}
      <RestrictionBanner restriction={sessionUser?.restriction ?? null} />
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />
    </>
  )
}
