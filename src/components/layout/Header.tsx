import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { Camera, Menu, X } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { IconButton } from '@/components/ui/IconButton'
import { cn } from '@/lib/cn'

export interface HeaderProps {
  /**
   * 登录态：由 Shell 通过 useSession() 注入，null 表示未登录。
   * 刻意不给默认值 —— 漏传要在编译期报错，而不是静默显示成"未登录"。
   */
  sessionUser: { username: string; displayName: string } | null
}

interface NavItem {
  label: string
  to: string
  /** 是否精确匹配。只给首页用：否则 "/" 在所有路由上都算激活 */
  match?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { label: '首页', to: '/', match: true },
  { label: '作品墙', to: '/gallery' },
  { label: '分类', to: '/categories' },
  { label: '周榜', to: '/rankings/weekly' },
  { label: '学习', to: '/learn' },
  { label: '搜索', to: '/search' },
]

/** 全站页头：Logo + 主导航 + 登录态/头像（FRONTEND-WORK §3.2 Header） */
export function Header({ sessionUser }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  const navItems = NAV_ITEMS

  // 路由变化后收起：点菜单里的链接、浏览器前进后退都不会把菜单留在展开态
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname, location.search])

  // 视口回到桌面档（断点与 index.css 的 860px 保持一致）时收起：.g-mobile-nav
  // 自身没有桌面档隐藏规则，不收起会在宽屏上留下一块重复导航。
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 861px)')
    const closeOnDesktop = () => {
      if (desktop.matches) setMenuOpen(false)
    }
    closeOnDesktop()
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])

  return (
    <header className="g-header">
      <div className="g-header-inner">
        <Link to="/" className="g-brand" aria-label="工科影展首页">
          <Camera className="g-brand-icon" aria-hidden="true" />
          <span className="g-brand-name">工科影展</span>
        </Link>

        <nav className="g-nav" aria-label="主导航">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.match ?? false}
              className={({ isActive }) => cn('g-nav-link', isActive && 'g-nav-link-active')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="g-header-right">
          {sessionUser ? (
            <Link
              to={`/u/${sessionUser.username}`}
              className="g-header-avatar-link"
              aria-label={`查看 ${sessionUser.displayName || sessionUser.username} 的个人主页`}
            >
              <Avatar name={sessionUser.displayName || sessionUser.username} size={32} />
            </Link>
          ) : (
            <div className="g-auth-links" aria-label="账号入口">
              <Link to="/login" className="g-login-link">
                登录
              </Link>
              <Link to="/register" className="g-login-link g-register-link">
                注册
              </Link>
            </div>
          )}
          <IconButton
            icon={menuOpen ? X : Menu}
            label={menuOpen ? '关闭移动端导航' : '打开移动端导航'}
            className="g-mobile-nav-btn"
            aria-expanded={menuOpen}
            aria-controls="g-mobile-nav"
            onClick={() => setMenuOpen((open) => !open)}
          />
        </div>
      </div>

      {/* 移动端导航：≤860px 由 CSS 显示汉堡按钮，展开后渲染此折叠菜单（index.css .g-mobile-nav） */}
      {menuOpen && (
        <nav id="g-mobile-nav" className="g-mobile-nav" aria-label="移动端导航">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.match ?? false}
              className={({ isActive }) => cn('g-nav-link', isActive && 'g-nav-link-active')}
              // 点链接就收起。只看 location 变化不够：点「当前所在页」的链接时路由不变，
              // 菜单会留在展开态挡住页面。
              onClick={() => setMenuOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  )
}
