import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Container } from '@/components/layout/Container'
import { Avatar } from '@/components/ui/Avatar'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { Tabs, TabsPrimitive } from '@/components/ui/Tabs'
import { AppError, ErrorCodes } from '@/data/contracts'
import { PhotoGrid } from '@/features/photos/PhotoGrid'
import { FollowButton } from '@/features/social/FollowButton'
import { FollowStats } from '@/features/social/FollowStats'
import { ProfileMoreMenu } from '@/features/social/ProfileMoreMenu'
import { usePhotosByUsername } from '@/hooks/usePhotos'
import { useProfileByUsername, useSession } from '@/hooks/useSession'
import { accountImageUrl } from '@/lib/account'

type ProfileTab = 'works' | 'likes' | 'favorites'
type ExtendedProfile = NonNullable<ReturnType<typeof useProfileByUsername>['data']> & {
  visibility?: 'public' | 'private'
  showLikes?: boolean
  showFavorites?: boolean
  discoverable?: boolean
  isOwner?: boolean
}

export function ProfilePage() {
  const { username = '' } = useParams()
  const [tab, setTab] = useState<ProfileTab>('works')
  const [blockNotice, setBlockNotice] = useState(false)
  const { data: session } = useSession()
  const profileQuery = useProfileByUsername(username)
  const profile = profileQuery.data as ExtendedProfile | undefined
  /**
   * 本人判定，两个坑都要绕开：
   * 1. API 模式的公开资料**不返回** profiles.id，游客的 session 也是 null，
   *    直接比 `session?.userId === profile.id` 会命中 `undefined === undefined`
   *    —— 任何游客看任何主页都成了本人，于是看到「编辑资料与隐私」和「去发布」。
   *    所以先把两边都归一成空串：`'' === ''` 是可预期的假（id 非空才比），
   *    而 `undefined === undefined` 是隐形的真。
   * 2. 服务端已经按会话算好了 isOwner（它不需要前端知道 id），优先采信它；
   *    本地比较只是 mock 模式（资料里带 id）的后备。
   */
  const profileId = profile?.id ?? ''
  const sessionUserId = session?.userId ?? ''
  const isOwner = Boolean(
    profile && (profile.isOwner === true || (profileId !== '' && profileId === sessionUserId)),
  )
  const isPrivate = profile?.visibility === 'private' && !isOwner
  // 三个列表都按 username 驱动：主页拿不到 id，「本人」身份只决定能看到哪些 Tab，
  // 不改变取数口径（服务端按 username + 会话共同裁决）。
  const worksQuery = usePhotosByUsername(isPrivate ? '' : username, 'works')
  const likesQuery = usePhotosByUsername(
    !isPrivate && (isOwner || profile?.showLikes) ? username : '',
    'likes',
  )
  const favoritesQuery = usePhotosByUsername(
    !isPrivate && (isOwner || profile?.showFavorites) ? username : '',
    'favorites',
  )

  useEffect(() => {
    if (tab === 'likes' && !isOwner && !profile?.showLikes) setTab('works')
    if (tab === 'favorites' && !isOwner && !profile?.showFavorites) setTab('works')
  }, [isOwner, profile?.showFavorites, profile?.showLikes, tab])

  if (profileQuery.isLoading) return <Container><div className="g-detail-skeleton"><Skeleton variant="circle" width={64} height={64} /><Skeleton variant="text" width={200} /></div></Container>

  if (profileQuery.isError || !profile) {
    const notFound = profileQuery.error instanceof AppError && profileQuery.error.code === ErrorCodes.NOT_FOUND
    return (
      <Container size="sm">
        <div className="g-profile-boundary" role={notFound ? 'status' : undefined}>
          {notFound ? <><h1>找不到这个用户</h1><p>账号可能不存在、已注销，或用户名已更改。</p><Link className="g-login-link" to="/gallery">浏览作品墙</Link></> : <ErrorState title="个人主页加载失败" error={profileQuery.error} onRetry={() => void profileQuery.refetch()} />}
        </div>
      </Container>
    )
  }

  // 社交行：关注按钮 + 粉丝/关注数（本人主页不显示关注按钮，只显示计数）
  const socialRow = (
    <FollowStats
      username={profile.username}
      leading={isOwner ? null : <><FollowButton username={profile.username} /><ProfileMoreMenu username={profile.username} onBlocked={() => { setBlockNotice(true); void profileQuery.refetch() }} /></>}
    />
  )

  if (isPrivate) {
    return (
      <Container size="sm">
        <header className="g-profile-header"><Avatar src={accountImageUrl(profile.avatarKey)} name={profile.displayName || profile.username} size={64} /><div className="g-profile-header-info"><h1 className="g-page-title">{profile.displayName || profile.username}</h1><p className="g-page-subtitle">@{profile.username}</p>{socialRow}</div></header>
        <div className="g-profile-boundary"><h2>这是私密账号</h2><p>只有账号本人可以查看作品、喜欢和收藏。</p></div>
      </Container>
    )
  }

  const tabs = [
    { value: 'works', label: '作品' },
    ...(isOwner || profile.showLikes ? [{ value: 'likes', label: '喜欢' }] : []),
    ...(isOwner || profile.showFavorites ? [{ value: 'favorites', label: '收藏' }] : []),
  ]

  return (
    <Container>
      <header className="g-profile-header">
        <Avatar src={accountImageUrl(profile.avatarKey)} name={profile.displayName || profile.username} size={64} />
        <div className="g-profile-header-info">
          <h1 className="g-page-title">{profile.displayName || profile.username}</h1>
          <p className="g-page-subtitle">@{profile.username}{profile.bio && ` · ${profile.bio}`}</p>
          {blockNotice && <p className="g-profile-notice" role="status">你已拉黑该用户，对方无法关注你、也无法与你互动</p>}
          {profile.discoverable === false && isOwner && <p className="g-profile-notice" role="status">你的账号当前不可被搜索和推荐发现；直接访问主页仍然有效。</p>}
          {profile.links?.length > 0 && <ul className="g-profile-links" aria-label="主页链接">{profile.links.map((link, index) => <li key={`${link.url}-${index}`}><a href={link.url} target="_blank" rel="noreferrer">{link.label}</a></li>)}</ul>}
          {isOwner && <Link className="g-login-link" to="/settings/profile">编辑资料与隐私</Link>}
          {socialRow}
        </div>
      </header>
      <Tabs items={tabs} value={tab} onValueChange={(value) => setTab(value as ProfileTab)}>
        <TabsPrimitive.Content value="works" className="g-tabs-content"><PhotoGrid photos={worksQuery.data ?? []} loading={worksQuery.isLoading} error={worksQuery.error} onRetry={() => void worksQuery.refetch()} emptyTitle="还没有作品" {...(isOwner ? { emptyActions: [{ label: '去发布', to: '/publish' }] } : {})} /></TabsPrimitive.Content>
        <TabsPrimitive.Content value="likes" className="g-tabs-content"><PhotoGrid photos={likesQuery.data ?? []} loading={likesQuery.isLoading} error={likesQuery.error} onRetry={() => void likesQuery.refetch()} emptyTitle="还没有喜欢的作品" /></TabsPrimitive.Content>
        <TabsPrimitive.Content value="favorites" className="g-tabs-content"><PhotoGrid photos={favoritesQuery.data ?? []} loading={favoritesQuery.isLoading} error={favoritesQuery.error} onRetry={() => void favoritesQuery.refetch()} emptyTitle="还没有收藏的作品" /></TabsPrimitive.Content>
      </Tabs>
    </Container>
  )
}
