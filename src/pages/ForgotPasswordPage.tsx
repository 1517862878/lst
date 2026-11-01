/**
 * 忘记密码页 /forgot-password（2026-11 补齐）。
 *
 * 后端 /api/auth/password/request-code 与 /password/reset 早就实现了，
 * 但前端一直没有任何页面调用它们 —— 用户丢了密码只能改库或注销账号。
 * 这个页面就是那个缺失的入口。
 *
 * 两步式（与注册页同一套交互，用户不用学第二遍）：
 *   1) 填手机号 → 发送验证码
 *   2) 填验证码 + 新密码 → 重置
 *
 * 两个刻意的设计：
 *   · 第 1 步无论手机号是否注册过都显示「已发送」（服务端就是这么回的），
 *     否则这个页面会变成「查这个号码有没有注册」的探测工具。
 *   · 本地开发（SMS_PROVIDER=console）服务端会回 devCode，页面直接显示出来 ——
 *     否则开发时验证码只躺在后端控制台日志里，前端根本没法走完流程。
 */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/useToast'
import { usePasswordReset } from '@/hooks/useSession'
import { PASSWORD_MIN_LENGTH } from '@/domain/schemas'

const PHONE_RE = /^1\d{10}$/

export function ForgotPasswordPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const { requestCode, reset } = usePasswordReset()

  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [devCode, setDevCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const sendCode = async () => {
    setError('')
    const normalized = phone.trim()
    if (!PHONE_RE.test(normalized)) {
      setError('请输入有效的 11 位手机号')
      return
    }
    setSending(true)
    try {
      const result = await requestCode(normalized)
      setCodeSent(true)
      // 本地开发会把验证码直接带回来，显示出来免得去翻后端日志
      if (result.devCode) setDevCode(result.devCode)
      toast.show('success', '如果该手机号已注册，验证码已发送')
    } catch (e) {
      setError(e instanceof Error ? e.message : '验证码发送失败')
    } finally {
      setSending(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!PHONE_RE.test(phone.trim())) {
      setError('请输入有效的 11 位手机号')
      return
    }
    if (!/^\d{6}$/.test(code.trim())) {
      setError('验证码为 6 位数字')
      return
    }
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setError(`密码至少 ${PASSWORD_MIN_LENGTH} 位`)
      return
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }
    setSubmitting(true)
    try {
      await reset({ phone: phone.trim(), code: code.trim(), newPassword })
      toast.show('success', '密码已重置，请用新密码登录')
      navigate('/login', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Container size="md">
      <PageHeader
        title="重置密码"
        description="用注册手机号接收验证码，验证后设置新密码"
        breadcrumbs={[{ label: '登录', to: '/login' }, { label: '重置密码' }]}
      />

      <form className="g-auth-form" onSubmit={submit} noValidate>
        <Input
          label="注册手机号"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="11 位手机号"
          autoComplete="tel"
          inputMode="numeric"
          required
          endAdornment={
            <Button
              type="button"
              size="sm"
              variant="secondary"
              loading={sending}
              disabled={!phone.trim()}
              onClick={() => void sendCode()}
            >
              发送验证码
            </Button>
          }
        />

        {devCode && (
          <p className="g-auth-note" role="status">
            本地开发模式：验证码为 <strong>{devCode}</strong>（生产环境通过短信下发）
          </p>
        )}
        {codeSent && !devCode && (
          <p className="g-auth-note" role="status">
            如果该手机号已注册，验证码已发送，5 分钟内有效。
          </p>
        )}

        <Input
          label="验证码"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="6 位短信验证码"
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={6}
          required
        />
        <Input
          label={`新密码（${PASSWORD_MIN_LENGTH}–64 位）`}
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="请勿与其他网站共用"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={64}
          required
        />
        <Input
          label="确认新密码"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          maxLength={64}
          required
        />

        {error && (
          <p className="g-auth-error" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" loading={submitting} className="g-auth-submit">
          重置密码
        </Button>

        <p className="g-auth-note">
          想起来了？<Link to="/login">直接登录</Link>
        </p>
      </form>
    </Container>
  )
}
