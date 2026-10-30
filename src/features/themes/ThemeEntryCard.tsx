/**
 * 主题投稿卡片（8.4d）。
 *
 * 详情页的投稿网格、我的投稿列表、后台投稿管理都复用这一张卡 —— 三处各写一份
 * 判断（精选徽标、点评、作者名回退）就一定会漂移。
 *
 * 缩略图为什么不用 PhotoThumb：ThemeEntry 只有 thumbKey/imageKey，没有宽高，
 * 而 PhotoThumb 的占位块要靠 width/height 算 aspect-ratio。为了这一张卡再按
 * photoId 逐个回查作品（N 次请求）不划算，所以这里按固定比例渲染，
 * 取不到图就退化成「标题首字 + 稳定色块」，与收藏夹封面的做法一致。
 *
 * 结构上刻意**不做整卡包一层 Link**：作者名也要能点进主页，链接里套链接是
 * 非法 HTML（浏览器会把内层 <a> 拆出来），所以缩略图与标题各是一个链接。
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/Badge'
import { themeEntryBadge } from '@/domain/themes'
import type { ThemeEntry } from '@/domain/types'
import { usePhotoImage } from '@/hooks/usePhotoImage'
import { relativeTime } from '@/lib/time'
import { cn } from '@/lib/cn'

export interface ThemeEntryCardProps {
  entry: ThemeEntry
  /** 卡片底部的操作区（撤回投稿 / 精选开关），由调用方决定 */
  actions?: ReactNode
  className?: string
}

/** 与 PhotoThumb / 收藏夹封面一致的取色范围（180–280），相邻卡片不撞色 */
function hueOf(seed: string): number {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 360
  }
  return 180 + (hash % 100)
}

export function ThemeEntryCard({ entry, actions, className }: ThemeEntryCardProps) {
  const badge = themeEntryBadge(entry)
  const authorName = entry.authorDisplayName || entry.authorUsername || '匿名作者'
  const { url } = usePhotoImage(entry.thumbKey || null)
  const hue = hueOf(entry.photoId)

  return (
    <article className={cn('g-theme-entry', className)}>
      <Link
        to={`/works/${entry.photoId}`}
        className="g-theme-entry-thumb"
        aria-label={`打开作品《${entry.title}》`}
        style={{
          background: `linear-gradient(135deg, hsl(${hue} 42% 74%), hsl(${(hue + 28) % 360} 44% 52%))`,
        }}
      >
        {url ? (
          <img className="g-theme-entry-thumb-img" src={url} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="g-theme-entry-thumb-letter" aria-hidden="true">
            {(entry.title || '作').slice(0, 1)}
          </span>
        )}
      </Link>

      <div className="g-theme-entry-body">
        <h3 className="g-theme-entry-title">
          <Link to={`/works/${entry.photoId}`}>{entry.title}</Link>
        </h3>
        <p className="g-theme-entry-author">
          {entry.authorUsername ? (
            <Link
              to={`/u/${encodeURIComponent(entry.authorUsername)}`}
              className="g-theme-entry-author-link"
            >
              {authorName}
            </Link>
          ) : (
            authorName
          )}
        </p>
        <p className="g-theme-entry-meta">
          <span>投稿于 {relativeTime(entry.submittedAt)}</span>
          <span aria-label={`点赞 ${entry.likeCount}`}>♥ {entry.likeCount}</span>
          <span aria-label={`收藏 ${entry.favoriteCount}`}>★ {entry.favoriteCount}</span>
        </p>
      </div>

      {badge && (
        <p className="g-theme-entry-badge">
          <Badge tone="warning" size="sm">
            {badge}
          </Badge>
          {entry.selectedAt && (
            <span className="g-theme-entry-selected-at">入选于 {relativeTime(entry.selectedAt)}</span>
          )}
        </p>
      )}

      {entry.isSelected && entry.note && (
        <p className="g-theme-entry-note">
          <span className="g-theme-entry-note-label">编辑点评</span>
          {entry.note}
        </p>
      )}

      {actions && <div className="g-theme-entry-actions">{actions}</div>}
    </article>
  )
}
