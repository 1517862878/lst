import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Camera, LogIn, LogOut, Menu, Settings, User, UserPlus, UserRound, X } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { useSignOut } from '@/hooks/useSession'
import { cn } from '@/lib/cn'

export interface HeaderProps {
  sessionUser?: { id: string; username: string; displayName: string } | null
}

const navItems = [
  { label: '首页', to: '/', match: true },
  { label: '作品墙', to: '/gallery' },
  { label: '分类', to: '/categories' },
  { label: '周榜', to: '/rankings/weekly' },
  { label: '学习', to: '/learn' },
]

/**
 * 全站页头：Logo 左 + 主导航居中 + 右上角头像菜单。
 * 未登录时右上角显示空白头像图标，点击弹出「登录 / 注册」菜单；
 * 已登录时显示用户头像，菜单含个人主页、我的、设置与退出登录。
 */
export function Header({ sessionUser = null }: HeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { signOut } = useSignOut()

  // 滚动后页头切换为玻璃态 + 底部细线（提示词 §5 Navbar treatment）
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // 路由变化时收起移动端菜单
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  return (
    <header className={cn('g-header', scrolled && 'g-header-scrolled')}>
      <div className="g-header-inner">
        <Link to="/" className="g-brand" aria-label="工科影展首页">
          <span className="g-brand-icon-wrap" aria-hidden="true">
            <Camera className="g-brand-icon" />
          </span>
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
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="g-avatar-trigger"
                aria-label={sessionUser ? `打开用户菜单（${sessionUser.displayName}）` : '打开登录菜单'}
              >
                {sessionUser ? (
                  <Avatar name={sessionUser.displayName || sessionUser.username} size={32} />
                ) : (
                  <span className="g-avatar-blank" aria-hidden="true">
                    <UserRound />
                  </span>
                )}
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="g-menu" align="end" sideOffset={10}>
                {sessionUser ? (
                  <>
                    <DropdownMenu.Label className="g-menu-label">
                      {sessionUser.displayName || sessionUser.username}
                    </DropdownMenu.Label>
                    <DropdownMenu.Separator className="g-menu-sep" />
                    <DropdownMenu.Item asChild className="g-menu-item">
                      <Link to={`/u/${sessionUser.username}`}>
                        <User aria-hidden="true" />
                        个人主页
                      </Link>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item asChild className="g-menu-item">
                      <Link to="/me">
                        <Camera aria-hidden="true" />
                        我的
                      </Link>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item asChild className="g-menu-item">
                      <Link to="/settings/profile">
                        <Settings aria-hidden="true" />
                        设置
                      </Link>
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="g-menu-sep" />
                    <DropdownMenu.Item className="g-menu-item g-menu-item-danger" onSelect={() => void handleSignOut()}>
                      <LogOut aria-hidden="true" />
                      退出登录
                    </DropdownMenu.Item>
                  </>
                ) : (
                  <>
                    <DropdownMenu.Item asChild className="g-menu-item">
                      <Link to="/login">
                        <LogIn aria-hidden="true" />
                        登录
                      </Link>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item asChild className="g-menu-item">
                      <Link to="/register">
                        <UserPlus aria-hidden="true" />
                        注册
                      </Link>
                    </DropdownMenu.Item>
                  </>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <button
            type="button"
            className="g-mobile-menu-btn"
            aria-label={mobileOpen ? '关闭移动端导航' : '打开移动端导航'}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav className="g-mobile-nav" aria-label="移动端导航">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.match ?? false}
              className={({ isActive }) => cn('g-mobile-nav-link', isActive && 'g-nav-link-active')}
            >
              {item.label}
            </NavLink>
          ))}
          {!sessionUser && (
            <div className="g-mobile-nav-auth">
              <Link to="/login" className="g-btn g-btn-secondary g-btn-sm">
                登录
              </Link>
              <Link to="/register" className="g-btn g-btn-primary g-btn-sm">
                注册
              </Link>
            </div>
          )}
        </nav>
      )}
    </header>
  )
}
