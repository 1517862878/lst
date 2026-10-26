import { Link, NavLink } from 'react-router'
import { Camera, Menu } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { IconButton } from '@/components/ui/IconButton'
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

/** 全站页头：Logo + 主导航 + 登录态/头像（FRONTEND-WORK §3.2 Header） */
export function Header({ sessionUser = null }: HeaderProps) {
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
            <Link to={`/u/${sessionUser.username}`} className="g-header-avatar-link">
              <Avatar name={sessionUser.displayName || sessionUser.username} size={32} />
            </Link>
          ) : (
            <Link to="/login" className="g-login-link">
              登录 / 注册
            </Link>
          )}
          <IconButton icon={Menu} label="打开移动端导航" className="g-mobile-menu-btn" />
        </div>
      </div>
    </header>
  )
}
