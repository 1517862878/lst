import { Link } from 'react-router'
import { Container } from './Container'

const footerLinks = [
  { label: '关于本站', to: '/about' },
  { label: '用户协议', to: '/terms' },
  { label: '隐私政策', to: '/privacy' },
  { label: '版权声明', to: '/copyright' },
  { label: '侵权投诉', to: '/dmca' },
  { label: '开源许可', to: '/licenses' },
  { label: '社区规范', to: '/community' },
]

/**
 * 页脚：法律页链接 + 演示模式常驻声明。
 * ROADMAP 5.5 演示模式 UI 规范第 1 条：页脚固定一行演示声明。
 */
export function Footer() {
  return (
    <footer className="g-footer">
      <Container>
        <p className="g-demo-note" role="note">
          <strong>演示模式</strong>：所有数据仅保存在你的浏览器，清除浏览数据即丢失。
        </p>
        <nav className="g-footer-links" aria-label="页脚导航">
          {footerLinks.map((l) => (
            <Link key={l.to} to={l.to} className="g-footer-link">
              {l.label}
            </Link>
          ))}
        </nav>
        <p className="g-footer-copy">© 2026 工科影展 · 作品版权归作者所有</p>
      </Container>
    </footer>
  )
}
