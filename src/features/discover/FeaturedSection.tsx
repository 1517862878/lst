/**
 * 首页「编辑精选」区块（8.3c）。
 *
 * 与首页其它区块不同：**没有数据就整块不渲染**。精选是 staff 手工标记的内容，
 * 新站/演示环境完全可能一条都没有，显示一个「暂无精选」的空壳会让首页看起来
 * 像坏了；而工作人员在后台还没标过东西，也不该被当成异常。
 *
 * 三态齐备：加载（骨架横条）、失败（ErrorState + 重试）、有数据（横向卡片流）。
 */
import { Badge } from '@/components/ui/Badge'
import { ErrorState } from '@/components/ui/ErrorState'
import { Section } from '@/components/layout/Section'
import { Skeleton } from '@/components/ui/Skeleton'
import { PhotoCard } from '@/features/photos/PhotoCard'
import { useFeaturedPhotos } from '@/hooks/useDiscover'

export function FeaturedSection() {
  const query = useFeaturedPhotos()
  const photos = query.data?.items ?? []

  // 无数据整块隐藏（加载中与失败仍要占位，否则用户看不到「为什么慢/失败」）
  if (!query.isLoading && !query.isError && photos.length === 0) return null

  return (
    <Section title="编辑精选" action={{ label: '作品墙', to: '/gallery' }}>
      {query.isLoading ? (
        <div className="g-featured-strip" aria-hidden="true">
          {Array.from({ length: 3 }, (_, i) => (
            <div className="g-featured-card" key={i}>
              <Skeleton variant="rect" height={200} />
            </div>
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState
          title="编辑精选加载失败"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <ul className="g-featured-strip" aria-label="编辑精选作品">
          {photos.map((photo) => (
            <li className="g-featured-card" key={photo.id}>
              <div className="g-featured-card-media">
                <PhotoCard photo={photo} showAuthor showDemoBadge={photo.credit === '示例素材'} />
                <Badge tone="warning" size="sm" className="g-featured-badge">
                  编辑精选
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
