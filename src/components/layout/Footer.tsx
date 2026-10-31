import { Link } from 'react-router'
import { dataSource } from '@/data'
import { Container } from './Container'

const footerLinks = [
  { label: '外观设置', to: '/appearance' },
  { label: '关于本站', to: '/about' },
  { label: '用户协议', to: '/terms' },
  { label: '隐私政策', to: '/privacy' },
  { label: '版权声明', to: '/copyright' },
  { label: '侵权投诉', to: '/dmca' },
  { label: '开源许可', to: '/licenses' },
  { label: '社区规范', to: '/community' },
]

/** 页脚：法律页链接 + 当前数据模式的准确说明。 */
export function Footer() {
  const isApi = dataSource() === 'api'

  return (
    <footer className="g-footer">
      <Container>
        <p className="g-demo-note" role="note">
          {isApi ? (
            <><strong>在线模式</strong>：账号与公开内容由服务器保存。</>
          ) : (
            <><strong>演示模式</strong>：所有数据仅保存在你的浏览器，清除浏览数据即丢失。</>
          )}
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
