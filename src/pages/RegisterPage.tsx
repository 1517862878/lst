/**
 * 注册页 /register（FRONTEND-WORK §2.14）。
 */
import { Link } from 'react-router'
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
          <p className="g-auth-switch">
            已有账号？ <Link to="/login">返回登录</Link>
          </p>
        </div>
      </Container>
    </GuestOnly>
  )
}
