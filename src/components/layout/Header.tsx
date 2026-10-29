import { useEffect, useId, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router'
import { Camera, Menu, X } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { IconButton } from '@/components/ui/IconButton'
import type { UserRole } from '@/domain/types'
import { useSignOut } from '@/hooks/useSession'
import { accountImageUrl } from '@/lib/account'
import { cn } from '@/lib/cn'
import { NotificationBell } from './NotificationBell'

export interface HeaderProps {
  sessionUser: { username: string; displayName: string; avatarKey: string | null } | null
  /**
   * 会话角色（8.2）。只用来决定账号菜单里是否显示「审核台」——
   * 真正的权限判定在 /admin 页面与后端，菜单项只是入口，不是授权。
   */
  role?: UserRole | null
}

interface NavItem {
  label: string
  to: string
  match?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { label: '首页', to: '/', match: true },
  { label: '作品墙', to: '/gallery' },
  { label: '分类', to: '/categories' },
  { label: '周榜', to: '/rankings/weekly' },
  { label: '学习', to: '/learn' },
  { label: '搜索', to: '/search' },
  { label: '关注', to: '/feed' },
  { label: '通知', to: '/notifications' },
]

/**
 * 次级导航（8.4a）：摄影专业化的浏览入口。
 *
 * 不塞进 NAV_ITEMS —— 主导航已有 8 项，再加会把「作品墙/分类」挤到第二行；
 * 器材与地点是「作品墙的下钻维度」，语义上属于同一条浏览动线，所以单独一行。
 */
const SUBNAV_ITEMS: NavItem[] = [
  { label: '器材', to: '/gear' },
  { label: '地点', to: '/places' },
]

export function Header({ sessionUser, role = null }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const accountRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const firstItemRef = useRef<HTMLAnchorElement>(null)
  const menuId = useId()
  const { signOut } = useSignOut()

  const closeAccountMenu = (restoreFocus = false) => {
    setAccountOpen(false)
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    setMenuOpen(false)
    setAccountOpen(false)
  }, [location.pathname, location.search])

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 861px)')
    const close = () => {
      if (desktop.matches) setMenuOpen(false)
    }
    close()
    desktop.addEventListener('change', close)
    return () => desktop.removeEventListener('change', close)
  }, [])

  useEffect(() => {
    if (!accountOpen) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) closeAccountMenu()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeAccountMenu(true)
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    window.requestAnimationFrame(() => firstItemRef.current?.focus())
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [accountOpen])

  const logout = async () => {
    await signOut()
    closeAccountMenu()
    navigate('/', { replace: true })
  }

  const handleMenuKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    const index = items.indexOf(document.activeElement as HTMLElement)
    let next = index
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % items.length
    else if (event.key === 'ArrowUp') next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else if (event.key === 'Tab') {
      closeAccountMenu()
      return
    } else return
    event.preventDefault()
    items[next]?.focus()
  }

  const displayName = sessionUser?.displayName || sessionUser?.username || ''

  return (
    <header className="g-header">
      <div className="g-header-inner">
        <Link to="/" className="g-brand" aria-label="工科影展首页">
          <Camera className="g-brand-icon" aria-hidden="true" />
          <span className="g-brand-name">工科影展</span>
        </Link>
        <nav className="g-nav" aria-label="主导航">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.match ?? false} className={({ isActive }) => cn('g-nav-link', isActive && 'g-nav-link-active')}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="g-header-right">
          {/* 铃铛对游客也渲染：点进去由 RequireAuth 带到登录页并回跳，
              与「未登录点关注」是同一条路径；游客不查未读数（见 enabled） */}
          <NotificationBell enabled={Boolean(sessionUser)} />
          {sessionUser ? (
            <div className="g-account-menu" ref={accountRef}>
              <button
                ref={triggerRef}
                className="g-header-avatar-link"
                aria-label={`${displayName}的账号菜单`}
                aria-haspopup="menu"
                aria-controls={menuId}
                aria-expanded={accountOpen}
                onClick={() => setAccountOpen((value) => !value)}
                onKeyDown={(event) => {
                  if (!accountOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                    event.preventDefault()
                    setAccountOpen(true)
                  }
                }}
              >
                <Avatar src={accountImageUrl(sessionUser.avatarKey)} name={displayName} size={32} />
              </button>
              {accountOpen && (
                <div id={menuId} className="g-account-popover" role="menu" aria-label="账号菜单" onKeyDown={handleMenuKeys}>
                  <div className="g-account-popover-head">
                    <strong>{displayName}</strong>
                    <span>@{sessionUser.username}</span>
                  </div>
                  <Link ref={firstItemRef} role="menuitem" to="/me">我的工作台</Link>
                  <Link role="menuitem" to={`/u/${sessionUser.username}`}>个人主页</Link>
                  {/* 治理入口紧挨「个人主页」：都跟「我的账号」有关，往上一项是工作台，方向键顺序稳定 */}
                  <Link role="menuitem" to="/me/moderation">举报与处罚</Link>
                  {(role === 'editor' || role === 'admin') && (
                    <Link role="menuitem" to="/admin">审核台</Link>
                  )}
                  <Link role="menuitem" to="/settings/profile">设置与隐私</Link>
                  <button role="menuitem" onClick={() => void logout()}>退出登录</button>
                </div>
              )}
            </div>
          ) : (
            <div className="g-auth-links" aria-label="账号入口">
              <Link to="/login" className="g-login-link">登录</Link>
              <Link to="/register" className="g-login-link g-register-link">注册</Link>
            </div>
          )}
          <IconButton
            icon={menuOpen ? X : Menu}
            label={menuOpen ? '关闭移动端导航' : '打开移动端导航'}
            className="g-mobile-nav-btn"
            aria-expanded={menuOpen}
            aria-controls="g-mobile-nav"
            onClick={() => setMenuOpen((value) => !value)}
          />
        </div>
      </div>
      <nav className="g-subnav" aria-label="浏览维度">
        <span className="g-subnav-label" aria-hidden="true">按器材/地点</span>
        {SUBNAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => cn('g-subnav-link', isActive && 'g-subnav-link-active')}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      {menuOpen && (
        <nav id="g-mobile-nav" className="g-mobile-nav" aria-label="移动端导航">
          {[...NAV_ITEMS, ...SUBNAV_ITEMS].map((item) => (
            <NavLink key={item.to} to={item.to} end={item.match ?? false} className={({ isActive }) => cn('g-nav-link', isActive && 'g-nav-link-active')} onClick={() => setMenuOpen(false)}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  )
}
