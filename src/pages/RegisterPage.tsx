/**
 * 注册页 /register（FRONTEND-WORK §2.14）。
 */
import { Container } from '@/components/layout/Container'
import { GuestOnly } from '@/components/layout/guards'
import { RegisterForm } from '@/features/auth/RegisterForm'

export function RegisterPage() {
  return (
    <GuestOnly>
      <Container size="sm">
        <div className="g-auth-page">
          <h1 className="g-page-title">注册</h1>
          <p className="g-page-subtitle">创建你的账号，开始分享作品</p>
          <RegisterForm />
        </div>
      </Container>
    </GuestOnly>
  )
}
