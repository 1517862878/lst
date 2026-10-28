/** 注册表单：手机号验证码注册，并分别确认用户协议与隐私政策。 */
import { useCallback, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { useToast } from '@/components/ui/useToast'
import { useSignUp } from '@/hooks/useSession'
import { dataSource } from '@/data'
import { TurnstileWidget } from './TurnstileWidget'

export function RegisterForm() {
  const isApi = dataSource() === 'api'
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  const turnstileEnabled = Boolean((import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim())
  const handleTurnstileToken = useCallback((token: string) => setTurnstileToken(token), [])
  const handleTurnstileError = useCallback((message: string) => setError(message), [])
  const { signUp, requestRegistrationCode } = useSignUp()
  const navigate = useNavigate()
  const toast = useToast()

  const handleSendCode = async () => {
    const normalizedPhone = phone.trim()
    setError('')
    if (!/^1\d{10}$/.test(normalizedPhone)) {
      setError('请输入有效的 11 位手机号')
      return
    }
    setSendingCode(true)
    try {
      if (isApi && turnstileEnabled && !turnstileToken) throw new Error('请先完成人机验证')
      await requestRegistrationCode(normalizedPhone, turnstileToken || undefined)
      toast.show('success', isApi ? '验证码已发送' : '演示模式：验证码发送成功')
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证码发送失败')
    } finally {
      setSendingCode(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!termsAccepted || !privacyAccepted) {
      setError('必须同意用户协议和隐私政策才能注册')
      return
    }
    if (!/^[a-zA-Z0-9_\-\u4e00-\u9fa5]{2,20}$/u.test(username.trim())) {
      setError('用户名需 2–20 位，可用中文、字母、数字、下划线、连字符')
      return
    }
    if (!/^1\d{10}$/.test(phone.trim())) {
      setError('请输入有效的 11 位手机号')
      return
    }
    if (!/^\d{6}$/.test(code.trim())) {
      setError('验证码为 6 位数字')
      return
    }
    if (password.length < 6) {
      setError('密码至少 6 位')
      return
    }
    setSubmitting(true)
    try {
      await signUp({
        username: username.trim(),
        displayName: displayName.trim(),
        phone: phone.trim(),
        code: code.trim(),
        password,
        termsAccepted,
        privacyAccepted,
      })
      toast.show('success', '注册成功')
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="g-auth-form" onSubmit={handleSubmit} noValidate>
      <Input label="用户名" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="2–20 位，可用中文、字母、数字、下划线、连字符" hint="用于个人主页路径 /u/用户名" autoComplete="username" required />
      <Input label="昵称" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="展示名（1–30 字）" required />
      <Input label="手机号" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="11 位手机号" autoComplete="tel" inputMode="numeric" required />
      <Input
        label="验证码"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="短信验证码"
        autoComplete="one-time-code"
        inputMode="numeric"
        required
        endAdornment={<Button type="button" size="sm" variant="secondary" loading={sendingCode} disabled={!phone.trim()} onClick={handleSendCode}>发送验证码</Button>}
      />
      <Input label="密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={isApi ? '至少 6 位，请勿与其他网站共用' : '至少 6 位（演示模式不具安全性）'} autoComplete="new-password" required />
      {isApi && <TurnstileWidget action="register_code" onToken={handleTurnstileToken} onError={handleTurnstileError} />}
      <Checkbox
        label={<>我已阅读并同意 <Link to="/terms" target="_blank" rel="noreferrer">用户协议</Link></>}
        checked={termsAccepted}
        onCheckedChange={setTermsAccepted}
        required
      />
      <Checkbox
        label={<>我已阅读并同意 <Link to="/privacy" target="_blank" rel="noreferrer">隐私政策</Link></>}
        checked={privacyAccepted}
        onCheckedChange={setPrivacyAccepted}
        required
      />
      {error && <p className="g-auth-error" role="alert">{error}</p>}
      <Button type="submit" loading={submitting} className="g-auth-submit">注册</Button>
    </form>
  )
}
