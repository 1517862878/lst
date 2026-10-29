/**
 * /me「数据」区（8.3d）：创作数据卡 + 作品数据表。
 *
 * 两条硬规则：
 *   1. **失败不阻塞**：统计接口挂了只把这一个区块降级成「数据暂不可用 + 重试」，
 *      /me 的快捷入口、最近作品照常渲染。统计是锦上添花，不是页面骨架。
 *   2. **数字格式固定**：千分位 + tabular-nums，见 lib/format.ts 的说明。
 *
 * 作品数据表在窄屏（≤560px）会从「横向表格」变成「一条一卡的键值列表」：
 * 不靠横向滚动兜底 —— 390px 的屏幕上横向滚动的表格等于逼用户左右搓，
 * 而且首列往往被滚出视野，看到的是「3」看不出这是哪件作品的数字。
 */
import { Link } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { PHOTO_STATS_LIMIT } from '@/domain/stats'
import type { CreatorStats, PhotoStats } from '@/domain/types'
import { useCreatorStats, usePhotoStats } from '@/hooks/useStats'
import { formatNumber } from '@/lib/format'
import { formatDate } from '@/lib/time'

/** 九张统计卡。顺序即阅读顺序：先「有多少」，再「有多少人看」，最后「朋友」。 */
const METRICS: ReadonlyArray<{ key: keyof CreatorStats; label: string }> = [
  { key: 'photoCount', label: '作品' },
  { key: 'publishedCount', label: '在架' },
  { key: 'draftCount', label: '草稿' },
  { key: 'likeTotal', label: '获赞' },
  { key: 'favoriteTotal', label: '收藏' },
  { key: 'commentTotal', label: '评论' },
  { key: 'viewTotal', label: '浏览' },
  { key: 'followerCount', label: '粉丝' },
  { key: 'followingCount', label: '关注' },
]

const STATUS_LABEL: Record<PhotoStats['status'], string> = {
  published: '在架',
  draft: '草稿',
  removed: '已下架',
}

/** 统计数字的降级占位：一句话 + 重试，不占满整屏（错误态大图标在这里太重） */
function StatsUnavailable({ onRetry, label }: { onRetry: () => void; label: string }) {
  return (
    <p className="g-me-stats-degraded" role="status">
      <span>{label}</span>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        重试
      </Button>
    </p>
  )
}

export function CreatorStatsCards() {
  const query = useCreatorStats()

  if (query.isError) {
    return <StatsUnavailable label="数据暂不可用" onRetry={() => void query.refetch()} />
  }

  return (
    <ul className="g-me-stat-cards" aria-label="创作数据">
      {METRICS.map((metric) => (
        <li key={metric.key}>
          {query.isLoading ? (
            // 骨架保留卡片尺寸，避免数字到位时整块跳动（CLS）
            <Skeleton variant="text" width={44} height={28} />
          ) : (
            <strong className="g-me-stat-value">{formatNumber(query.data?.[metric.key] ?? 0)}</strong>
          )}
          <span className="g-me-stat-label">{metric.label}</span>
        </li>
      ))}
    </ul>
  )
}

/** 表头：列名与顺序和 api_my_photo_stats 返回的字段一一对应 */
const COLUMNS = ['作品', '状态', '发布', '获赞', '收藏', '评论', '浏览'] as const

export function PhotoStatsTable() {
  const query = usePhotoStats({ limit: PHOTO_STATS_LIMIT })
  const rows: PhotoStats[] = query.data ?? []

  if (query.isLoading) {
    return (
      <div className="g-photo-stats-skeleton" aria-hidden="true">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} variant="text" height={36} />
        ))}
      </div>
    )
  }

  // 表格失败与卡片失败分开降级：一个是「影响力汇总」，一个是「逐条明细」，
  // 汇总挂了不代表明细挂了（两个端点本来就是分开的）
  if (query.isError) {
    return <StatsUnavailable label="作品数据暂不可用" onRetry={() => void query.refetch()} />
  }

  if (rows.length === 0) {
    return (
      <p className="g-me-stats-empty">
        还没有作品数据，发布第一件作品后这里会显示每一件的播放与互动。
      </p>
    )
  }

  return (
    <div className="g-photo-stats-scroll">
      <table className="g-photo-stats">
        <caption className="g-visually-hidden">我的作品数据（最近 {rows.length} 件）</caption>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.photoId}>
              {/* 第一列是行标题：读屏用户听到「作品《海边》」才知道后面那串数字属于谁 */}
              <th scope="row" className="g-photo-stats-title">
                <Link to={`/works/${row.photoId}`}>{row.title}</Link>
                {row.featuredAt && (
                  <span className="g-photo-stats-featured">
                    精选
                  </span>
                )}
              </th>
              <td data-label="状态">{STATUS_LABEL[row.status]}</td>
              <td data-label="发布">{row.publishedAt ? formatDate(row.publishedAt) : '—'}</td>
              {/* 数字列统一 tabular-nums 右对齐：位数不同也能按位对齐比较 */}
              <td data-label="获赞" className="g-photo-stats-num">
                {formatNumber(row.likeCount)}
              </td>
              <td data-label="收藏" className="g-photo-stats-num">
                {formatNumber(row.favoriteCount)}
              </td>
              <td data-label="评论" className="g-photo-stats-num">
                {formatNumber(row.commentCount)}
              </td>
              <td data-label="浏览" className="g-photo-stats-num">
                {formatNumber(row.viewCount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 作品数超过一页时给一句说明：表里只放前 PHOTO_STATS_LIMIT 行，别让人以为总数就这些 */
function PhotoStatsFootnote({ total }: { total: number }) {
  if (total <= PHOTO_STATS_LIMIT) return null
  return (
    <p className="g-photo-stats-note">
      共 {formatNumber(total)} 件作品，这里显示最近 {PHOTO_STATS_LIMIT} 件。
    </p>
  )
}

/** 供 /me 之外的页面复用的完整「数据」区（目前只有 /me 用） */
export function CreatorStatsSection() {
  const stats = useCreatorStats()
  return (
    <>
      <section className="g-me-section" aria-labelledby="me-stats-heading">
        <h2 id="me-stats-heading">数据</h2>
        <CreatorStatsCards />
      </section>
      <section className="g-me-section" aria-labelledby="me-photo-stats-heading">
        <h2 id="me-photo-stats-heading">作品数据</h2>
        <PhotoStatsTable />
        <PhotoStatsFootnote total={stats.data?.photoCount ?? 0} />
      </section>
    </>
  )
}
