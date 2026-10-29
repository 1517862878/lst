import { useEffect, useState, type FormEvent } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router'
import { Container } from '@/components/layout/Container'
import { PageHeader } from '@/components/layout/PageHeader'
import { Avatar } from '@/components/ui/Avatar'
import { RequireAuth } from '@/components/layout/guards'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/useToast'
import type { AccountLink } from '@/data/api/account'
import type { PhotoLicense } from '@/domain/types'
import { EXIF_VISIBILITY_OPTIONS, type ExifVisibility } from '@/domain/photography'
import { useSetExifVisibility } from '@/hooks/usePhotography'
import { useProfileByUsername } from '@/hooks/useSession'
import {
  useAccount,
  useAccountSessions,
  useChangePassword,
  useDeleteAccount,
  useRevokeSession,
  useUpdateAccount,
  useUpdatePreferences,
} from '@/hooks/useAccount'
import { useSignOut } from '@/hooks/useSession'
import { useBlockedUsers, useUnblockUser } from '@/hooks/useSocial'
import { accountImageUrl, errorMessage, isSafeProfileLink } from '@/lib/account'
import { cn } from '@/lib/cn'

const SETTINGS_TABS = [
  { slug: 'profile', label: '个人资料' },
  { slug: 'privacy', label: '隐私与通知' },
  { slug: 'security', label: '账号安全' },
  { slug: 'blocks', label: '黑名单' },
] as const

type SettingsTab = (typeof SETTINGS_TABS)[number]['slug']

function tabFromPath(pathname: string): SettingsTab {
  const slug = pathname.split('/').filter(Boolean).at(-1)
  return SETTINGS_TABS.some((item) => item.slug === slug) ? slug as SettingsTab : 'profile'
}

export function SettingsPage() {
  return <RequireAuth><SettingsInner /></RequireAuth>
}

function SettingsInner() {
  const account = useAccount()
  const location = useLocation()
  const navigate = useNavigate()
  const activeTab = tabFromPath(location.pathname)

  if (account.isLoading) return <Container size="md"><p className="g-placeholder-text" role="status">正在加载账号设置…</p></Container>
  if (account.isError || !account.data) {
    return <Container size="md"><ErrorState title="账号设置加载失败" error={account.error} onRetry={() => void account.refetch()} /></Container>
  }

  return (
    <Container size="md">
      <PageHeader title="设置与隐私" description={`账号 @${account.data.username} · 手机 ${account.data.phone ?? '未绑定'}`} />
      <div className="g-settings-layout">
        <nav className="g-settings-nav" aria-label="设置分类">
          {SETTINGS_TABS.map((item) => (
            <NavLink key={item.slug} to={`/settings/${item.slug}`} className={({ isActive }) => cn('g-settings-nav-link', isActive && 'g-settings-nav-link-active')}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <main className="g-settings-main" aria-labelledby={`settings-${activeTab}-title`}>
          {activeTab === 'profile' && <ProfileSettings account={account.data} />}
          {activeTab === 'privacy' && (
            <>
              <PrivacySettings account={account.data} />
              {/* 拍摄参数是摄影侧的独立设置（profiles.exif_visibility），
                  与账户偏好不同接口，所以单独一块、单独保存，避免一次保存改两处而看不出来 */}
              <ExifVisibilitySettings username={account.data.username} />
            </>
          )}
          {activeTab === 'security' && <SecuritySettings onDeleted={() => navigate('/', { replace: true })} />}
          {activeTab === 'blocks' && <BlockedUsersSettings />}
        </main>
      </div>
    </Container>
  )
}

function ProfileSettings({ account }: { account: NonNullable<ReturnType<typeof useAccount>['data']> }) {
  const update = useUpdateAccount()
  const toast = useToast()
  const [name, setName] = useState(account.displayName)
  const [bio, setBio] = useState(account.bio)
  const [avatarKey, setAvatarKey] = useState(account.avatarKey ?? '')
  const [license, setLicense] = useState<PhotoLicense>(account.licensePreference)
  const [links, setLinks] = useState<AccountLink[]>(account.links)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    setName(account.displayName)
    setBio(account.bio)
    setAvatarKey(account.avatarKey ?? '')
    setLicense(account.licensePreference)
    setLinks(account.links)
  }, [account])

  const updateLink = (index: number, patch: Partial<AccountLink>) => setLinks((current) => current.map((link, itemIndex) => itemIndex === index ? { ...link, ...patch } : link))

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setFormError('')
    const cleanedLinks = links.map((link) => ({ label: link.label.trim(), url: link.url.trim() })).filter((link) => link.label || link.url)
    if (!name.trim()) return setFormError('昵称不能为空。')
    const incomplete = cleanedLinks.find((link) => !link.label || !link.url)
    if (incomplete) return setFormError('每条主页链接都需要填写名称和网址。')
    if (cleanedLinks.some((link) => !isSafeProfileLink(link.url))) return setFormError('主页链接必须是有效的 http 或 https 地址。')
    try {
      await update.mutateAsync({ displayName: name.trim(), bio: bio.trim(), licensePreference: license, links: cleanedLinks, avatarKey: avatarKey.trim() || null })
      toast.show('success', '个人资料已保存')
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  return (
    <section className="g-settings-panel">
      <h2 id="settings-profile-title">个人资料</h2>
      <p className="g-settings-intro">更新公开昵称、简介、头像和主页链接。</p>
      <form className="g-auth-form" onSubmit={save} noValidate>
        {formError && <p className="g-auth-error" role="alert">{formError}</p>}
        <Input label="昵称" value={name} onChange={(event) => setName(event.target.value)} maxLength={30} required />
        <Textarea label="简介" value={bio} onChange={(event) => setBio(event.target.value)} maxLength={160} showCount />
        <Input label="头像地址或存储键" value={avatarKey} onChange={(event) => setAvatarKey(event.target.value)} hint="支持 https 图片地址或站内图片存储键。" />
        <div className="g-field">
          <label className="g-label" htmlFor="settings-license">默认作品授权</label>
          <select id="settings-license" className="g-select" value={license} onChange={(event) => setLicense(event.target.value as PhotoLicense)}>
            <option value="all_rights_reserved">保留所有权利</option><option value="cc_by">CC BY 4.0</option><option value="cc_by_nc">CC BY-NC 4.0</option><option value="cc_by_nc_nd">CC BY-NC-ND 4.0</option><option value="cc0">CC0</option>
          </select>
        </div>
        <fieldset className="g-settings-fieldset">
          <legend>主页链接</legend>
          <p className="g-settings-hint">最多 3 条，将展示在公开个人主页。</p>
          {links.map((link, index) => (
            <div className="g-settings-link-row" key={index}>
              <Input label={`链接 ${index + 1} 名称`} value={link.label} onChange={(event) => updateLink(index, { label: event.target.value })} maxLength={30} />
              <Input label={`链接 ${index + 1} 地址`} type="url" value={link.url} onChange={(event) => updateLink(index, { url: event.target.value })} placeholder="https://example.com" />
              <Button variant="secondary" size="sm" onClick={() => setLinks((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`删除链接 ${index + 1}`}>删除</Button>
            </div>
          ))}
          {links.length < 3 && <Button variant="secondary" size="sm" onClick={() => setLinks((current) => [...current, { label: '', url: '' }])}>添加链接</Button>}
        </fieldset>
        <Button type="submit" loading={update.isPending}>保存个人资料</Button>
      </form>
    </section>
  )
}

function PrivacySettings({ account }: { account: NonNullable<ReturnType<typeof useAccount>['data']> }) {
  const update = useUpdatePreferences()
  const toast = useToast()
  const [visibility, setVisibility] = useState(account.visibility)
  const [discoverable, setDiscoverable] = useState(account.discoverable)
  const [showLikes, setShowLikes] = useState(account.showLikes)
  const [showFavorites, setShowFavorites] = useState(account.showFavorites)
  const [accountSecurity, setAccountSecurity] = useState(account.notificationPreferences.accountSecurity ?? true)
  const [productUpdates, setProductUpdates] = useState(account.notificationPreferences.productUpdates ?? true)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    setVisibility(account.visibility)
    setDiscoverable(account.discoverable)
    setShowLikes(account.showLikes)
    setShowFavorites(account.showFavorites)
    setAccountSecurity(account.notificationPreferences.accountSecurity ?? true)
    setProductUpdates(account.notificationPreferences.productUpdates ?? true)
  }, [account])

  const save = async () => {
    setFormError('')
    try {
      await update.mutateAsync({
        visibility,
        discoverable,
        showLikes,
        showFavorites,
        notificationPreferences: { ...account.notificationPreferences, accountSecurity, productUpdates },
      })
      toast.show('success', '隐私与通知设置已保存')
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  return (
    <section className="g-settings-panel">
      <h2 id="settings-privacy-title">隐私与通知</h2>
      <p className="g-settings-intro">控制个人主页访问、站内发现和通知偏好。</p>
      {formError && <p className="g-auth-error" role="alert">{formError}</p>}
      <fieldset className="g-settings-fieldset"><legend>主页可见性</legend>
        <label className="g-settings-check"><input type="checkbox" checked={visibility === 'private'} onChange={(event) => setVisibility(event.target.checked ? 'private' : 'public')} /><span><strong>私密账号</strong><small>其他访客无法查看你的作品、喜欢和收藏；你仍可预览自己的主页。</small></span></label>
        <label className="g-settings-check"><input type="checkbox" checked={discoverable} onChange={(event) => setDiscoverable(event.target.checked)} /><span><strong>允许被发现</strong><small>关闭后不出现在搜索、推荐和发现入口，但知道主页地址的访客仍可访问公开主页。</small></span></label>
        <label className="g-settings-check"><input type="checkbox" checked={showLikes} onChange={(event) => setShowLikes(event.target.checked)} /><span><strong>展示喜欢</strong><small>在个人主页显示喜欢的作品标签。</small></span></label>
        <label className="g-settings-check"><input type="checkbox" checked={showFavorites} onChange={(event) => setShowFavorites(event.target.checked)} /><span><strong>展示收藏</strong><small>在个人主页显示收藏的作品标签。</small></span></label>
      </fieldset>
      <fieldset className="g-settings-fieldset"><legend>通知偏好</legend>
        <label className="g-settings-check"><input type="checkbox" checked={accountSecurity} onChange={(event) => setAccountSecurity(event.target.checked)} /><span><strong>账号安全通知</strong><small>接收登录、密码和设备相关提醒。</small></span></label>
        <label className="g-settings-check"><input type="checkbox" checked={productUpdates} onChange={(event) => setProductUpdates(event.target.checked)} /><span><strong>产品动态</strong><small>接收功能更新和社区活动消息。</small></span></label>
      </fieldset>
      <Button onClick={() => void save()} loading={update.isPending}>保存隐私与通知</Button>
    </section>
  )
}

/**
 * 拍摄参数公开范围（8.4a ①）。
 *
 * 账户级默认值存在 profiles.exif_visibility；单张作品还有自己的开关（发布/编辑页）。
 * 有效可见性 = 账户隐藏 OR 单张隐藏，所以这里的文案必须说清「隐藏后所有作品都不显示」，
 * 否则作者会以为单个作品的开关能把它打开。
 */
function ExifVisibilitySettings({ username }: { username: string }) {
  const profile = useProfileByUsername(username)
  const save = useSetExifVisibility()
  const toast = useToast()
  const current: ExifVisibility = profile.data?.exifVisibility === 'hidden' ? 'hidden' : 'public'
  const [visibility, setVisibility] = useState<ExifVisibility>(current)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    setVisibility(current)
  }, [current])

  const submit = async () => {
    setFormError('')
    try {
      await save.mutateAsync(visibility)
      toast.show('success', '拍摄参数公开范围已保存')
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  return (
    <section className="g-settings-panel" aria-labelledby="settings-exif-title">
      <h2 id="settings-exif-title">拍摄参数公开范围</h2>
      <p className="g-settings-intro">
        控制作品详情里的相机、镜头与曝光参数。隐藏后每件作品都显示「作者未公开拍摄参数」，
        单张作品的开关无法把它重新打开。
      </p>
      {formError && <p className="g-auth-error" role="alert">{formError}</p>}
      <fieldset className="g-settings-fieldset">
        <legend>默认范围</legend>
        <div className="g-exif-visibility-options">
          {EXIF_VISIBILITY_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="g-exif-visibility-option"
              data-checked={visibility === option.value}
            >
              <input
                type="radio"
                name="exif-visibility"
                value={option.value}
                checked={visibility === option.value}
                onChange={() => setVisibility(option.value)}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <Button onClick={() => void submit()} loading={save.isPending} disabled={visibility === current}>
        保存拍摄参数设置
      </Button>
    </section>
  )
}

function BlockedUsersSettings() {
  const blocked = useBlockedUsers()
  const unblock = useUnblockUser()
  const toast = useToast()
  const [unblocking, setUnblocking] = useState<string | null>(null)
  const users = blocked.data?.pages.flatMap((page) => page.items) ?? []

  const remove = async (username: string) => {
    setUnblocking(username)
    try {
      await unblock.mutateAsync(username)
      toast.show('success', `已解除对 @${username} 的拉黑`)
    } catch (error) {
      toast.show('error', errorMessage(error))
    } finally {
      setUnblocking(null)
    }
  }

  return (
    <section className="g-settings-panel">
      <h2 id="settings-blocks-title">黑名单</h2>
      <p className="g-settings-intro">已拉黑的用户无法关注你，也无法与你互动。</p>
      {blocked.isLoading && <p className="g-placeholder-text" role="status">正在加载黑名单…</p>}
      {blocked.isError && <ErrorState title="黑名单加载失败" error={blocked.error} onRetry={() => void blocked.refetch()} />}
      {!blocked.isLoading && !blocked.isError && users.length === 0 && <div className="g-social-empty"><p>黑名单为空</p><p>你还没有拉黑任何用户。</p></div>}
      {users.length > 0 && <ul className="g-block-list">{users.map((user) => <li className="g-block-item" key={user.username}><div className="g-block-user"><Avatar src={accountImageUrl(user.avatarKey)} name={user.displayName || user.username} size={48} /><span><strong>{user.displayName || user.username}</strong><small>@{user.username}</small>{user.bio && <small>{user.bio}</small>}</span></div><Button variant="secondary" size="sm" loading={unblocking === user.username} disabled={unblock.isPending && unblocking !== user.username} onClick={() => void remove(user.username)}>解除拉黑</Button></li>)}</ul>}
      {blocked.hasNextPage && <div className="g-follow-panel-foot"><Button variant="secondary" loading={blocked.isFetchingNextPage} onClick={() => void blocked.fetchNextPage()}>加载更多</Button></div>}
    </section>
  )
}

function SecuritySettings({ onDeleted }: { onDeleted: () => void }) {
  const sessions = useAccountSessions()
  const revoke = useRevokeSession()
  const changePassword = useChangePassword()
  const deleteAccount = useDeleteAccount()
  const { signOut } = useSignOut()
  const navigate = useNavigate()
  const toast = useToast()
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [securityError, setSecurityError] = useState('')
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault()
    setSecurityError('')
    if (newPassword.length < 8 || newPassword.length > 64) return setSecurityError('新密码需 8–64 位。')
    try {
      await changePassword.mutateAsync({ oldPassword, newPassword })
      toast.show('success', '密码已更新，请重新登录')
      navigate('/login', { replace: true })
    } catch (error) {
      setSecurityError(errorMessage(error))
    }
  }

  const revokeSession = async (id: string) => {
    setSecurityError('')
    setRevokingId(id)
    try {
      await revoke.mutateAsync(id)
      toast.show('success', '设备已下线')
    } catch (error) {
      setSecurityError(errorMessage(error))
    } finally {
      setRevokingId(null)
    }
  }

  const logout = async () => {
    if (signingOut) return
    setSigningOut(true)
    setSecurityError('')
    try {
      await signOut()
      navigate('/', { replace: true })
    } catch (error) {
      setSecurityError(errorMessage(error))
      setSigningOut(false)
    }
  }

  const removeAccount = async () => {
    if (deleteConfirm !== '注销账号' || deleteAccount.isPending) return
    setSecurityError('')
    try {
      await deleteAccount.mutateAsync({ password: deletePassword, reason: '用户主动注销' })
      toast.show('info', '账号已注销')
      onDeleted()
    } catch (error) {
      setSecurityError(errorMessage(error))
    }
  }

  return (
    <section className="g-settings-panel">
      <h2 id="settings-security-title">账号安全</h2>
      <p className="g-settings-intro">管理登录设备、密码和账号生命周期。</p>
      {securityError && <p className="g-auth-error" role="alert">{securityError}</p>}
      <section className="g-settings-section"><h3>登录设备</h3>
        {sessions.isLoading && <p role="status">正在加载设备…</p>}
        {sessions.isError && <ErrorState title="设备列表加载失败" error={sessions.error} onRetry={() => void sessions.refetch()} />}
        {sessions.data?.map((session) => <div className="g-session-row" key={session.id}><div><strong>{session.currentSession ? '当前设备' : '其他设备'}</strong><small>{session.userAgent || '未知浏览器'} · 最近活动 {new Date(session.lastSeenAt).toLocaleString()}</small></div>{!session.currentSession && <Button variant="secondary" size="sm" loading={revokingId === session.id} disabled={revoke.isPending && revokingId !== session.id} onClick={() => void revokeSession(session.id)}>下线</Button>}</div>)}
      </section>
      <section className="g-settings-section"><h3>修改密码</h3><form className="g-auth-form" onSubmit={submitPassword}><Input type="password" autoComplete="current-password" label="当前密码" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} required /><Input type="password" autoComplete="new-password" label="新密码（8–64 位）" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} maxLength={64} required /><Button type="submit" loading={changePassword.isPending}>更新密码</Button></form></section>
      <section className="g-settings-danger"><h3 className="g-settings-danger-title">敏感操作</h3><Button variant="secondary" loading={signingOut} disabled={deleteAccount.isPending || changePassword.isPending} onClick={() => void logout()}>退出当前账号</Button><details><summary>永久注销账号</summary><p>注销后作品和评论将被隐藏，账号无法恢复。</p><Input type="password" autoComplete="current-password" label="账号密码" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} /><Input label="输入“注销账号”确认" value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} /><Button variant="danger" loading={deleteAccount.isPending} disabled={deleteConfirm !== '注销账号' || signingOut || changePassword.isPending} onClick={() => void removeAccount()}>永久注销</Button></details></section>
    </section>
  )
}
