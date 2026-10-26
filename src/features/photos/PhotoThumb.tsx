/**
 * 照片缩略图组件（FRONTEND-WORK §3.3 PhotoThumb）。
 * 静态期：无真实图片文件，用主色占位（宽高比 + 标题首字母）。
 * 动态期：替换为真实 Storage 图片，组件 props 不变。
 */
import type { Photo } from '@/domain/types'
import { cn } from '@/lib/cn'

export interface PhotoThumbProps {
  photo: Photo
  /** thumb 小图 / display 大图（静态期都渲染占位色块） */
  size?: 'thumb' | 'display'
  priority?: boolean
  className?: string
}

/** 由 photo.id 确定性生成占位色（保证同一作品永远同色） */
function hueOf(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360
  return h
}

export function PhotoThumb({ photo, size = 'thumb', priority = false, className }: PhotoThumbProps) {
  const hue = hueOf(photo.id)
  const light = `hsl(${hue} 45% 88%)`
  const dark = `hsl(${hue} 45% 62%)`

  return (
    <div
      className={cn('g-photo-thumb', size === 'display' && 'g-photo-thumb-display', className)}
      style={{ aspectRatio: `${photo.width} / ${photo.height}` }}
      role="img"
      aria-label={`${photo.title}（示例占位图）`}
    >
      <div
        className="g-photo-thumb-fill"
        style={{ background: `linear-gradient(135deg, ${light} 0%, ${dark} 100%)` }}
      >
        <span className="g-photo-thumb-title">{photo.title.slice(0, 1)}</span>
        <span className="g-photo-thumb-meta">
          {photo.width}×{photo.height}
        </span>
      </div>
      {priority && <span className="g-visually-hidden">优先加载</span>}
    </div>
  )
}
