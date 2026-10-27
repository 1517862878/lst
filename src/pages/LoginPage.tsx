/**
 * 登录页 /login（FRONTEND-WORK §2.13）。
 * 游客专属（GuestOnly）；顶部黄色提示条（演示模式 UI 规范第 2 条）。
 */
import { useSearchParams } from 'react-router'
import { Container } from '@/components/layout/Container'
import { GuestOnly } from '@/components/layout/guards'
import { LoginForm } from '@/features/auth/LoginForm'
import { dataSource } from '@/data'

export function LoginPage() {
  const [params] = useSearchParams()
  const isApi = dataSource() === 'api'
  const next = params.get('next') ?? '/'

  return (
    <GuestOnly>
      <Container size="sm">
        <div className="g-auth-page">
          <h1 className="g-page-title">登录</h1>
          <div className="g-demo-banner" role="note">
            {isApi
              ? '在线模式：登录凭据会发送到本站服务器验证，请使用本站专用密码。'
              : '演示模式：登录仅保存在你的浏览器，密码不具安全性。'}
          </div>
          <LoginForm next={next} />
        </div>
      </Container>
    </GuestOnly>
  )
}
