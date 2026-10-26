/**
 * 个人主页 /u/:username（FRONTEND-WORK §2.15）。
 * 三 Tab：作品 / 收藏 / 喜欢（复用 usePhotosByUser）。
 */
import { useState } from 'react'
import { useParams } from 'react-router'
import { Container } from '@/components/layout/Container'
import { Tabs, TabsPrimitive } from '@/components/ui/Tabs'
import { Avatar } from '@/components/ui/Avatar'
import { Skeleton } from '@/components/ui/Skeleton'
import { PhotoGrid } from '@/features/photos/PhotoGrid'
import { usePhotosByUser } from '@/hooks/usePhotos'
import { useProfileByUsername } from '@/hooks/useSession'

export function ProfilePage() {
  const { username = '' } = useParams()
  const [tab, setTab] = useState('works')

  const profileQuery = useProfileByUsername(username)

  const userId = profileQuery.data?.id
  // 修正：三个 Tab 各自取对应数据。早先三个 Tab 共用同一个 photos 变量，
  // 导致切「收藏」看到的仍是「作品」内容（真实缺陷，由 E2E 发现）。
  const worksQuery = usePhotosByUser(userId ?? '', 'works')
  const likesQuery = usePhotosByUser(userId ?? '', 'likes')
  const favoritesQuery = usePhotosByUser(userId ?? '', 'favorites')

  if (profileQuery.isLoading) {
    return (
      <Container>
        <div className="g-detail-skeleton">
          <Skeleton variant="circle" width={64} height={64} />
          <Skeleton variant="text" width={200} />
        </div>
      </Container>
    )
  }

  if (profileQuery.isError || !profileQuery.data) {
    return (
      <Container>
        <p className="g-placeholder-text">用户不存在或已注销。</p>
      </Container>
    )
  }

  const profile = profileQuery.data

  return (
    <Container>
      <header className="g-profile-header">
        <Avatar name={profile.displayName || profile.username} size={64} />
        <div className="g-profile-header-info">
          <h1 className="g-page-title">{profile.displayName || profile.username}</h1>
          <p className="g-page-subtitle">
            @{profile.username}
            {profile.bio && ` · ${profile.bio}`}
          </p>
        </div>
      </header>

      <Tabs
        items={[
          { value: 'works', label: '作品' },
          { value: 'likes', label: '喜欢' },
          { value: 'favorites', label: '收藏' },
        ]}
        value={tab}
        onValueChange={setTab}
      >
        <TabsPrimitive.Content value="works" className="g-tabs-content">
          <PhotoGrid
            photos={worksQuery.data ?? []}
            loading={worksQuery.isLoading}
            emptyTitle="还没有作品"
            emptyActions={[{ label: '去发布', to: '/publish' }]}
          />
        </TabsPrimitive.Content>
        <TabsPrimitive.Content value="likes" className="g-tabs-content">
          <PhotoGrid
            photos={likesQuery.data ?? []}
            loading={likesQuery.isLoading}
            emptyTitle="还没有喜欢的作品"
          />
        </TabsPrimitive.Content>
        <TabsPrimitive.Content value="favorites" className="g-tabs-content">
          <PhotoGrid
            photos={favoritesQuery.data ?? []}
            loading={favoritesQuery.isLoading}
            emptyTitle="还没有收藏的作品"
          />
        </TabsPrimitive.Content>
      </Tabs>
    </Container>
  )
}
