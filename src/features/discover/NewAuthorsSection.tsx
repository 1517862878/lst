/**
 * 首页「新作者」区块（8.3c）。
 *
 * 目标是让新注册、还没被看见的作者获得一次曝光：按「在架作品总获赞 → 作品数 →
 * 注册时间」排序（口径见 domain/discover.ts），而不是按粉丝数——新作者本来就没粉丝。
 *
 * 与精选一样：没有数据就整块隐藏（新站初期完全可能没人符合条件）。
 */
import { Link } from 'react-router'
import { Avatar } from '@/components/ui/Avatar'
import { ErrorState } from '@/components/ui/ErrorState'
import { Section } from '@/components/layout/Section'
import { Skeleton } from '@/components/ui/Skeleton'
import { FollowButton } from '@/features/social/FollowButton'
import { useNewAuthors } from '@/hooks/useDiscover'
import { accountImageUrl } from '@/lib/account'

export function NewAuthorsSection() {
  const query = useNewAuthors(6)
  const authors = query.data ?? []

  if (!query.isLoading && !query.isError && authors.length === 0) return null

  return (
    <Section title="新作者" action={{ label: '发现更多作者', to: '/gallery' }}>
      {query.isLoading ? (
        <ul className="g-new-authors" aria-hidden="true">
          {Array.from({ length: 3 }, (_, i) => (
            <li className="g-new-author-card" key={i}>
              <Skeleton variant="rect" height={96} />
            </li>
          ))}
        </ul>
      ) : query.isError ? (
        <ErrorState title="新作者加载失败" error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <ul className="g-new-authors" aria-label="新作者推荐">
          {authors.map((author) => (
            <li className="g-new-author-card" key={author.username}>
              <Link to={`/u/${author.username}`} className="g-new-author-main">
                <Avatar
                  src={accountImageUrl(author.avatarKey)}
                  name={author.displayName || author.username}
                  size={48}
                />
                <span className="g-new-author-copy">
                  <strong>{author.displayName || author.username}</strong>
                  <span>@{author.username}</span>
                  <small>
                    {author.photoCount} 件作品 · 共获赞 {author.likeTotal}
                  </small>
                </span>
              </Link>
              <FollowButton username={author.username} size="sm" />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
