/**
 * 资料设置 /settings/profile（FRONTEND-WORK §2.16，P1）。
 * 展示名/简介/授权偏好 + 退出登录。
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/useToast'
import { RequireAuth } from '@/components/layout/guards'
import { useSession, useSignOut } from '@/hooks/useSession'
import { createRepositories, dataSource } from '@/data'
import type { PhotoLicense } from '@/domain/types'

export function SettingsPage() {
  return (
    <RequireAuth>
      <SettingsInner />
    </RequireAuth>
  )
}

function SettingsInner() {
  const { data: session } = useSession()
  const { signOut } = useSignOut()
  const navigate = useNavigate()
  const toast = useToast()

  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [licensePreference, setLicensePreference] = useState<PhotoLicense>('all_rights_reserved')
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const isApi = dataSource() === 'api'

  useEffect(() => {
    if (!session || loaded) return
    void createRepositories()
      .auth.getProfile(session.userId)
      .then((p) => {
        setDisplayName(p.displayName)
        setBio(p.bio)
        setLicensePreference(p.licensePreference)
        setLoaded(true)
      })
      .catch(() => {
        setLoadError(true)
        setLoaded(true)
      })
  }, [session, loaded])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isApi || loadError) return
    toast.show('success', '资料已保存（演示模式）')
  }

  const handleSignOut = async () => {
    await signOut()
    toast.show('info', '已退出登录')
    navigate('/', { replace: true })
  }

  return (
    <Container size="sm">
      <PageHeader title="资料设置" description={`当前账号：@${session?.username ?? ''}`} />
      {loadError && (
        <p className="g-auth-error" role="alert">
          资料加载失败，请刷新页面后重试。
        </p>
      )}
      {isApi && !loadError && (
        <p className="g-draft-note" role="status">
          在线资料编辑暂未开放，当前内容仅供查看。
        </p>
      )}
      <form className="g-auth-form" onSubmit={handleSave}>
        <Input
          label="昵称"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={30}
        />
        <Textarea
          label="简介"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={160}
          showCount
        />
        <div className="g-field">
          <label className="g-label" htmlFor="settings-license">
            默认作品授权
          </label>
          <select
            id="settings-license"
            className="g-select"
            value={licensePreference}
            onChange={(e) => setLicensePreference(e.target.value as PhotoLicense)}
          >
            <option value="all_rights_reserved">保留所有权利</option>
            <option value="cc_by">CC BY 4.0</option>
            <option value="cc_by_nc">CC BY-NC 4.0</option>
            <option value="cc_by_nc_nd">CC BY-NC-ND 4.0</option>
            <option value="cc0">CC0</option>
          </select>
        </div>
        <Button type="submit" disabled={isApi || loadError || !loaded}>
          {isApi ? '暂不可保存' : '保存'}
        </Button>
      </form>
      <div className="g-settings-danger">
        <h2 className="g-settings-danger-title">账号</h2>
        <Button variant="danger" onClick={() => void handleSignOut()}>
          退出登录
        </Button>
      </div>
    </Container>
  )
}
