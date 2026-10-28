import { Link } from 'react-router'
import { Avatar } from '@/components/ui/Avatar'
import { Skeleton } from '@/components/ui/Skeleton'
import { useProfile } from '@/hooks/useSession'
import { cn } from '@/lib/cn'

export interface AuthorLinkProps {
  authorId: string
  variant?: 'compact' | 'card'
  className?: string
}

/** 统一解析作品作者；资料失败时只降级作者区域，不影响作品本身。 */
export function AuthorLink({ authorId, variant = 'compact', className }: AuthorLinkProps) {
  const profileQuery = useProfile(authorId)
  const isCard = variant === 'card'

  if (profileQuery.isLoading) {
    return (
      <div
        className={cn('g-author-link', isCard && 'g-author-link-card', className)}
        aria-label="正在加载作者资料"
      >
        <Skeleton variant="circle" width={isCard ? 48 : 32} height={isCard ? 48 : 32} />
        <div className="g-author-link-copy" aria-hidden="true">
          <Skeleton variant="text" width={96} />
          {isCard && <Skeleton variant="text" width={150} />}
        </div>
      </div>
    )
  }

  const profile = profileQuery.data
  if (!profile || profileQuery.isError) {
    return (
      <div className={cn('g-author-link g-author-link-unavailable', className)} role="status">
        <Avatar name="作者" size={isCard ? 48 : 32} />
        <span>作者资料暂不可用</span>
      </div>
    )
  }

  const label = `查看作者 ${profile.displayName} 的主页`

  return (
    <Link
      to={`/u/${profile.username}`}
      className={cn('g-author-link', isCard && 'g-author-link-card', className)}
      aria-label={label}
    >
      <Avatar src={profile.avatarKey} name={profile.displayName} size={isCard ? 48 : 32} />
      <span className="g-author-link-copy">
        <strong className="g-author-link-name">{profile.displayName}</strong>
        {isCard ? (
          <>
            <span className="g-author-link-username">@{profile.username}</span>
            {profile.bio && <span className="g-author-link-bio">{profile.bio}</span>}
          </>
        ) : (
          <span className="g-author-link-username">@{profile.username}</span>
        )}
      </span>
      {isCard && <span className="g-author-link-action">查看主页 →</span>}
    </Link>
  )
}
