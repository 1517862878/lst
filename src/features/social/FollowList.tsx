/**
 * 粉丝 / 关注列表（S8）。
 *
 * 分页用游标 + 「加载更多」按钮，而不是滚动哨兵：面板是嵌在个人主页中间的一块，
 * 滚动触发会把整页高度反复撑大，用户正在读的作品网格被不断顶走。
 */
import { Link } from 'react-router'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { useSession } from '@/hooks/useSession'
import { useFollowList } from '@/hooks/useSocial'
import type { FollowListKind } from '@/hooks/queryKeys'
import { accountImageUrl } from '@/lib/account'
import { FollowButton } from './FollowButton'

export interface FollowListProps {
  username: string
  kind: FollowListKind
}

const HEADING: Record<FollowListKind, string> = {
  followers: '粉丝',
  following: '关注',
}

export function FollowList({ username, kind }: FollowListProps) {
  const { data: session } = useSession()
  const query = useFollowList(username, kind, true)
  const profiles = query.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <div className="g-follow-panel" id="g-follow-panel" role="region" aria-label={`${HEADING[kind]}列表`}>
      <div className="g-follow-panel-head">
        <h2>{HEADING[kind]}</h2>
      </div>

      {query.isLoading ? (
        <ul className="g-follow-list" aria-hidden="true">
          {Array.from({ length: 3 }, (_, index) => (
            <li key={index} className="g-follow-item">
              <Skeleton variant="circle" width={48} height={48} />
              <Skeleton variant="text" width={140} />
            </li>
          ))}
        </ul>
      ) : query.isError ? (
        <ErrorState title={`${HEADING[kind]}列表加载失败`} error={query.error} onRetry={() => void query.refetch()} />
      ) : profiles.length === 0 ? (
        <p className="g-follow-panel-empty">
          {kind === 'followers' ? '还没有人关注这个账号。' : '这个账号还没有关注任何人。'}
        </p>
      ) : (
        <ul className="g-follow-list">
          {profiles.map((profile) => {
            const displayName = profile.displayName || profile.username
            return (
              <li key={profile.id} className="g-follow-item">
                <Link to={`/u/${profile.username}`} className="g-follow-item-main" aria-label={`查看 ${displayName} 的主页`}>
                  <Avatar src={accountImageUrl(profile.avatarKey)} name={displayName} size={48} />
                  <span className="g-follow-item-copy">
                    <strong className="g-follow-item-name">{displayName}</strong>
                    <span className="g-follow-item-username">@{profile.username}</span>
                    {profile.bio && <span className="g-follow-item-bio">{profile.bio}</span>}
                  </span>
                </Link>
                {/* 自己那一行不给关注按钮；游客也不给（点了只会被弹去登录，列表里全是这种按钮很吵） */}
                {session && session.username !== profile.username && (
                  <span className="g-follow-item-action">
                    <FollowButton username={profile.username} size="sm" />
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {query.hasNextPage && (
        <div className="g-follow-panel-foot">
          <Button
            variant="secondary"
            size="sm"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            加载更多
          </Button>
        </div>
      )}
    </div>
  )
}
