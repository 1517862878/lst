/**
 * 首页 /（FRONTEND-WORK §2.1 + 8.3a 发现/关注双 Feed）。
 * 「发现」= 全站精选；「关注」= 我关注的作者动态。两种 Feed 用 URL 上的
 * ?feed=following 区分：首页是分享率最高的页面，Feed 选择必须能被收藏/回退键还原。
 */
import { Link, useSearchParams } from 'react-router'
import { Container } from '@/components/layout/Container'
import { dataSource } from '@/data'
import { Section } from '@/components/layout/Section'
import { Skeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/ErrorState'
import { PhotoCard } from '@/features/photos/PhotoCard'
import { TagLink } from '@/features/tags/TagLink'
import { useArticles, useCategories, useWeeklyRanking } from '@/hooks/useContent'
import { useTags } from '@/hooks/useTags'
import { usePhotos, usePhoto } from '@/hooks/usePhotos'
import { useFeed } from '@/hooks/useSocial'
import { useSession } from '@/hooks/useSession'
import { currentIsoWeek } from '@/lib/time'

type FeedMode = 'discover' | 'following'

/** 双 Feed 切换：真链接 + aria-current，键盘直接 Tab 可达 */
function FeedSwitch({ mode }: { mode: FeedMode }) {
  return (
    <nav className="g-feed-switch" aria-label="首页内容">
      <Link
        to="/"
        className="g-feed-switch-link"
        aria-current={mode === 'discover' ? 'page' : undefined}
      >
        发现
      </Link>
      <Link
        to="/?feed=following"
        className="g-feed-switch-link"
        aria-current={mode === 'following' ? 'page' : undefined}
      >
        关注
      </Link>
    </nav>
  )
}

export function HomePage() {
  const isApi = dataSource() === 'api'
  const [params] = useSearchParams()
  const mode: FeedMode = params.get('feed') === 'following' ? 'following' : 'discover'

  const featuredQuery = usePhotos({ sort: 'popular', limit: 6 })
  const rankingQuery = useWeeklyRanking(currentIsoWeek(), 'live')
  const articlesQuery = useArticles({ limit: 3 })
  const categoriesQuery = useCategories()
  const hotTagsQuery = useTags({ sort: 'hot', limit: 12 })

  const featured = featuredQuery.data?.pages.flatMap((p) => p.items).slice(0, 6) ?? []
  const hotTags = hotTagsQuery.data ?? []

  return (
    <Container>
      <section className="g-hero" aria-label="站点介绍">
        <h1 className="g-hero-title">工科影展</h1>
        <p className="g-hero-subtitle">分享你的拍摄作品、拍摄地点与心得</p>
        <p className="g-hero-note" role="note">
          {isApi
            ? '在线模式：账号与公开内容由服务器保存。'
            : '演示模式：所有数据仅保存在你的浏览器，清除浏览数据即丢失。'}
        </p>
        <div className="g-hero-actions">
          <Link to="/gallery" className="g-btn g-btn-primary">
            浏览作品
          </Link>
          <Link to="/publish" className="g-btn g-btn-secondary">
            分享作品
          </Link>
        </div>
      </section>

      <FeedSwitch mode={mode} />

      {mode === 'following' ? (
        <HomeFollowingFeed />
      ) : (
        <Section title="本周精选" action={{ label: '作品墙', to: '/gallery' }}>
          {featuredQuery.isLoading ? (
            <div className="g-home-grid" aria-hidden="true">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} variant="rect" height={220} />
              ))}
            </div>
          ) : featuredQuery.isError ? (
            <ErrorState
              title="精选作品加载失败"
              error={featuredQuery.error}
              onRetry={() => void featuredQuery.refetch()}
            />
          ) : (
            <div className="g-home-grid">
              {featured.map((photo) => (
                <PhotoCard
                  key={photo.id}
                  photo={photo}
                  showAuthor
                  showDemoBadge={photo.credit === '示例素材'}
                />
              ))}
            </div>
          )}
        </Section>
      )}

      <Section title="本周排行榜" action={{ label: '查看完整榜单', to: '/rankings/weekly' }}>
        {rankingQuery.isLoading ? (
          <div className="g-home-grid" aria-hidden="true">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} variant="rect" height={80} />
            ))}
          </div>
        ) : rankingQuery.isError ? (
          <ErrorState
            title="排行榜加载失败"
            error={rankingQuery.error}
            onRetry={() => void rankingQuery.refetch()}
          />
        ) : (
          <ol className="g-rank-mini" aria-label="本周排行榜前五">
            {rankingQuery.data?.entries.slice(0, 5).map((entry) => (
              <RankMiniItem key={entry.photoId} photoId={entry.photoId} rank={entry.rank} score={entry.score} />
            ))}
          </ol>
        )}
      </Section>

      <Section title="最新教程" action={{ label: '学习板块', to: '/learn' }}>
        {articlesQuery.isLoading ? (
          <Skeleton variant="rect" height={80} />
        ) : articlesQuery.isError ? (
          <ErrorState
            title="教程加载失败"
            error={articlesQuery.error}
            onRetry={() => void articlesQuery.refetch()}
          />
        ) : (
          <ul className="g-learn-teaser" aria-label="最新教程列表">
            {articlesQuery.data?.items.slice(0, 3).map((a) => (
              <li key={a.id}>
                <Link to={`/learn/${a.slug}`} className="g-learn-teaser-item">
                  <span className="g-learn-teaser-title">{a.title}</span>
                  <span className="g-learn-teaser-meta">{a.difficulty}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="浏览分类">
        {categoriesQuery.isError ? (
          <ErrorState
            title="分类加载失败"
            error={categoriesQuery.error}
            onRetry={() => void categoriesQuery.refetch()}
          />
        ) : (
          <div className="g-category-chips" aria-label="分类快捷入口">
            {(categoriesQuery.data ?? []).map((c) => (
              <Link key={c.slug} to={`/categories/${c.slug}`} className="g-category-chip">
                {c.name}
              </Link>
            ))}
          </div>
        )}
      </Section>

      <Section title="热门标签" action={{ label: '全部标签', to: '/tags' }}>
        {hotTagsQuery.isError ? (
          <ErrorState
            title="热门标签加载失败"
            error={hotTagsQuery.error}
            onRetry={() => void hotTagsQuery.refetch()}
          />
        ) : hotTagsQuery.isLoading ? (
          <div className="g-tag-chips" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} variant="rect" width={64 + (i % 3) * 16} height={28} />
            ))}
          </div>
        ) : hotTags.length === 0 ? (
          <p className="g-placeholder-text">还没有标签，发布作品时填写标签即可出现在这里。</p>
        ) : (
          <ul className="g-tag-chips g-tag-chips-home" aria-label="热门标签">
            {hotTags.map((tag) => (
              <li key={tag.tag}>
                <TagLink tag={tag.tag} count={tag.photoCount} size="md" />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Container>
  )
}

/**
 * 首页「关注」Feed。
 *
 * 三个状态必须分开表达：未登录（给登录入口）、加载中（骨架）、空（还没关注人）。
 * 全都渲染成「空着」会让用户以为关注功能坏了。
 */
function HomeFollowingFeed() {
  const { data: session, isLoading: sessionLoading } = useSession()

  return (
    <Section title="关注动态" action={{ label: '查看全部', to: '/feed' }}>
      {sessionLoading ? (
        <div className="g-home-grid" aria-hidden="true">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} variant="rect" height={220} />
          ))}
        </div>
      ) : session ? (
        <FollowingFeedGrid />
      ) : (
        <div className="g-feed-switch-guest">
          <p>登录后这里会显示你关注的作者最近发布的作品。</p>
          <div className="g-hero-actions">
            <Link to={`/login?next=${encodeURIComponent('/?feed=following')}`} className="g-btn g-btn-primary g-btn-sm">
              去登录
            </Link>
            <Link to="/gallery" className="g-btn g-btn-secondary g-btn-sm">
              先去发现作者
            </Link>
          </div>
        </div>
      )}
    </Section>
  )
}

function FollowingFeedGrid() {
  const { data, isLoading, error, refetch } = useFeed()
  // 游标翻页在边界上可能返回重复项，按 id 去重后再渲染（重复 key 会让 React 报错）
  const photos = (data?.pages.flatMap((page) => page.items) ?? []).filter(
    (photo, index, all) => all.findIndex((other) => other.id === photo.id) === index,
  )

  if (error) {
    return <ErrorState title="关注动态加载失败" error={error} onRetry={() => void refetch()} />
  }
  if (isLoading) {
    return (
      <div className="g-home-grid" aria-hidden="true">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} variant="rect" height={220} />
        ))}
      </div>
    )
  }
  if (photos.length === 0) {
    return (
      <div className="g-feed-switch-guest">
        <p>你关注的作者还没有新作品。去作品墙或标签页找到想关注的人。</p>
        <div className="g-hero-actions">
          <Link to="/gallery" className="g-btn g-btn-secondary g-btn-sm">
            浏览作品墙
          </Link>
          <Link to="/tags" className="g-btn g-btn-secondary g-btn-sm">
            按标签发现
          </Link>
        </div>
      </div>
    )
  }
  return (
    <div className="g-home-grid">
      {photos.slice(0, 6).map((photo) => (
        <PhotoCard key={photo.id} photo={photo} showAuthor />
      ))}
    </div>
  )
}

function RankMiniItem({ photoId, rank, score }: { photoId: string; rank: number; score: number }) {
  const { data: photo } = usePhoto(photoId)
  return (
    <li className="g-rank-mini-item">
      <span className="g-rank-mini-rank" aria-label={`第 ${rank} 名`}>
        {rank}
      </span>
      <Link to={`/works/${photoId}`} className="g-rank-mini-link">
        {photo?.title ?? '加载中…'}
      </Link>
      <span className="g-rank-mini-score">{score.toFixed(1)} 分</span>
    </li>
  )
}
