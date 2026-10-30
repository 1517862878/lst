/**
 * 首页 /（FRONTEND-WORK §2.1 + 8.3c 发现/关注双 Tab）。
 *
 * 「发现」= 全站内容（本周精选 / 编辑精选 / 新作者 / 排行榜 / 教程 / 分类 / 标签）；
 * 「关注」= 我关注的作者的动态。两种视图用 URL 上的 ?tab=following 区分：
 * 首页是分享率最高的页面，视图选择必须能被收藏/回退键还原。
 *
 * 8.3c 的两处变化：
 *   · Tab 从「两个链接」升级为 tablist + 左右方向键（见 features/discover/HomeTabs）；
 *   · 关注视图复用 features/social/FollowingFeed（与 /feed 同一套组件，不复制逻辑），
 *     首页只取前 6 条，「查看全部」仍指向 /feed。
 *
 * 8.4d：发现视图在「本周精选」之后插一条「本周主题」（features/themes/ThemeSpotlight）。
 * 首页导航不加新项 —— 390px 下顶部导航已经很挤，主题的入口走这条横幅 + 作品页的投稿按钮。
 */
import { Link, Navigate, useSearchParams } from 'react-router'
import { Container } from '@/components/layout/Container'
import { dataSource } from '@/data'
import { Section } from '@/components/layout/Section'
import { Skeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/ErrorState'
import { PhotoCard } from '@/features/photos/PhotoCard'
import { TagLink } from '@/features/tags/TagLink'
import { FeaturedSection } from '@/features/discover/FeaturedSection'
import { NewAuthorsSection } from '@/features/discover/NewAuthorsSection'
import { HomeTabs, type HomeTab } from '@/features/discover/HomeTabs'
import { FollowingFeed } from '@/features/social/FollowingFeed'
import { ThemeSpotlight } from '@/features/themes/ThemeSpotlight'
import { useArticles, useCategories, useWeeklyRanking } from '@/hooks/useContent'
import { useTags } from '@/hooks/useTags'
import { usePhotos, usePhoto } from '@/hooks/usePhotos'
import { currentIsoWeek } from '@/lib/time'

export function HomePage() {
  const isApi = dataSource() === 'api'
  const [params] = useSearchParams()

  // 8.3a 的旧参数 ?feed=following 仍然有人收藏着：直接换到 ?tab=following，
  // 而不是让老链接静默落到「发现」上（用户会以为关注动态丢了）。
  // 判断放在所有 hook 之后：提前 return 会让下面的 hooks 变成条件调用
  // （eslint rules-of-hooks 也会拦下来）。
  const legacyFollowing = params.get('feed') === 'following'
  const mode: HomeTab = params.get('tab') === 'following' ? 'following' : 'discover'

  const featuredQuery = usePhotos({ sort: 'popular', limit: 6 })
  const rankingQuery = useWeeklyRanking(currentIsoWeek(), 'live')
  const articlesQuery = useArticles({ limit: 3 })
  const categoriesQuery = useCategories()
  const hotTagsQuery = useTags({ sort: 'hot', limit: 12 })

  const featured = featuredQuery.data?.pages.flatMap((p) => p.items).slice(0, 6) ?? []
  const hotTags = hotTagsQuery.data ?? []

  if (legacyFollowing) return <Navigate to="/?tab=following" replace />

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

      <HomeTabs mode={mode}>
        {mode === 'following' ? (
          <Section title="关注动态" action={{ label: '查看全部', to: '/feed' }}>
            <FollowingFeed limit={6} />
          </Section>
        ) : (
          <>
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

            {/* 8.4d：没有「进行中」的主题时 ThemeSpotlight 自己返回 null，
                首页其余部分不受影响，也不用在这里写条件 */}
            <ThemeSpotlight />

            <FeaturedSection />
            <NewAuthorsSection />

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
                    <RankMiniItem
                      key={entry.photoId}
                      photoId={entry.photoId}
                      rank={entry.rank}
                      score={entry.score}
                    />
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
          </>
        )}
      </HomeTabs>
    </Container>
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
