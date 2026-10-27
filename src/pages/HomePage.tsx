/**
 * 首页 /（FRONTEND-WORK §2.1）。
 * 精选轮播（S3 简化：横向滚动精选）+ 本周榜 Top5 + 最新教程 + 分类入口。
 */
import { Link } from 'react-router'
import { Container } from '@/components/layout/Container'
import { dataSource } from '@/data'
import { Section } from '@/components/layout/Section'
import { Skeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/ErrorState'
import { PhotoCard } from '@/features/photos/PhotoCard'
import { useArticles, useCategories, useWeeklyRanking } from '@/hooks/useContent'
import { usePhotos, usePhoto } from '@/hooks/usePhotos'
import { currentIsoWeek } from '@/lib/time'

export function HomePage() {
  const isApi = dataSource() === 'api'
  const featuredQuery = usePhotos({ sort: 'popular', limit: 6 })
  const rankingQuery = useWeeklyRanking(currentIsoWeek(), 'live')
  const articlesQuery = useArticles({ limit: 3 })
  const categoriesQuery = useCategories()

  const featured = featuredQuery.data?.pages.flatMap((p) => p.items).slice(0, 6) ?? []

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
              <PhotoCard key={photo.id} photo={photo} showAuthor showDemoBadge={photo.credit === '示例素材'} />
            ))}
          </div>
        )}
      </Section>

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
