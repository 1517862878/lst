/**
 * 登录表单（FRONTEND-WORK §3.3 LoginForm）。
 * 演示模式：一键填入演示账号 + 错误提示。
 */
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/useToast'
import { useSignIn } from '@/hooks/useSession'
import { dataSource } from '@/data'
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '@/domain/constants'

export interface LoginFormProps {
  /** 登录成功后跳转（?next= 参数） */
  next?: string
}

export function LoginForm({ next = '/' }: LoginFormProps) {
  const isApi = dataSource() === 'api'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { signIn } = useSignIn()
  const navigate = useNavigate()
  const toast = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await signIn(username.trim(), password)
      toast.show('success', '登录成功')
      navigate(next, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  const fillDemo = (uname: string) => {
    setUsername(uname)
    setPassword(DEMO_PASSWORD)
  }

  return (
    <form className="g-auth-form" onSubmit={handleSubmit} noValidate>
      <Input
        label="用户名"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="输入用户名"
        autoComplete="username"
        required
      />
      <Input
        label="密码"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={isApi ? '输入密码' : '演示密码 demo1234'}
        autoComplete="current-password"
        required
      />
      {error && (
        <p className="g-auth-error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" loading={submitting} className="g-auth-submit">
        登录
      </Button>

      {!isApi && (
        <div className="g-demo-picker" aria-label="演示账号一键填入">
          <p className="g-demo-picker-title">演示账号（点击一键填入）：</p>
          <div className="g-demo-picker-row">
            {DEMO_ACCOUNTS.map((a) => (
              <Button key={a.username} variant="ghost" size="sm" onClick={() => fillDemo(a.username)}>
                {a.displayName}（{a.username}）
              </Button>
            ))}
          </div>
          <p className="g-demo-picker-note">演示模式：密码不具安全性，请勿使用真实密码。</p>
        </div>
      )}
    </form>
  )
}
