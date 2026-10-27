/**
 * 注册表单（FRONTEND-WORK §3.3 RegisterForm）。
 * 协议必选 + 用户名格式校验（zod schema）。
 */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { useToast } from '@/components/ui/useToast'
import { useSignUp } from '@/hooks/useSession'
import { dataSource } from '@/data'

export function RegisterForm() {
  const isApi = dataSource() === 'api'
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { signUp } = useSignUp()
  const navigate = useNavigate()
  const toast = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!agreeTerms) {
      setError('必须同意用户协议才能注册')
      return
    }
    // 规则与 usernameSchema、数据库 ck_profiles_username_format 三处一致
    if (!/^[a-zA-Z0-9_\-\u4e00-\u9fa5]{2,20}$/u.test(username.trim())) {
      setError('用户名需 2–20 位，可用中文、字母、数字、下划线、连字符')
      return
    }
    if (password.length < 6) {
      setError('密码至少 6 位')
      return
    }
    setSubmitting(true)
    try {
      await signUp({ username: username.trim(), displayName: displayName.trim(), password })
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
      <Input
        label="用户名"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="2–20 位，可用中文、字母、数字、下划线、连字符"
        hint="用于个人主页路径 /u/用户名"
        autoComplete="username"
        required
      />
      <Input
        label="昵称"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder="展示名（1–30 字）"
        required
      />
      <Input
        label="密码"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={isApi ? '至少 6 位，请勿与其他网站共用' : '至少 6 位（演示模式不具安全性）'}
        autoComplete="new-password"
        required
      />
      <Checkbox
        label={
          <>
            我已阅读并同意{' '}
            {/* 用 Link 而非 <a href="/terms">：子路径部署（/lst/）下原生 href 会丢 base */}
            <Link to="/terms" target="_blank" rel="noreferrer">
              用户协议
            </Link>{' '}
            与版权条款
          </>
        }
        checked={agreeTerms}
        onCheckedChange={setAgreeTerms}
        required
      />
      {error && (
        <p className="g-auth-error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" loading={submitting} className="g-auth-submit">
        注册
      </Button>
    </form>
  )
}
