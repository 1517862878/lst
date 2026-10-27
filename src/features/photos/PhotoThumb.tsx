/**
 * 照片缩略图组件（FRONTEND-WORK §3.3 PhotoThumb）。
 *
 * 两条渲染路径：
 *   1) 存储层有真实图片（用户发布的作品）→ 渲染 <img>，地址由 usePhotoImage 生成
 *   2) 没有真实图片（种子数据 / 图片丢失 / 加载中）→ 回退渐变色块占位
 *
 * 为什么保留占位块：种子数据只有 imageKey 字符串、没有实际文件。
 * 直接显示 <img src=""> 会得到破图，比色块更糟。所以"读不到就回退"是常态而非异常。
 */
import type { Photo } from '@/domain/types'
import { usePhotoImage } from '@/hooks/usePhotoImage'
import { cn } from '@/lib/cn'

export interface PhotoThumbProps {
  photo: Photo
  /** thumb 小图 / display 大图 */
  size?: 'thumb' | 'display'
  priority?: boolean
  className?: string
}

/**
 * 由 photo.id 确定性生成占位色（保证同一作品永远同色）。
 *
 * 色相限制在「夜空色系」180°–280°（青 → 蓝 → 紫罗兰），
 * 不再取全色域 —— 原来会生成粉/黄/橙的色块，在深蓝星空底上非常突兀。
 * 饱和度也压低（28%），与像素风的低饱和调性一致。
 */
function hueOf(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360
  // 映射到 180–280 区间（100 度的夜空色带）
  return 180 + (h % 100)
}

export function PhotoThumb({ photo, size = 'thumb', priority = false, className }: PhotoThumbProps) {
  const key = size === 'display' ? photo.imageKey : photo.thumbKey
  const { url } = usePhotoImage(key)

  const hue = hueOf(photo.id)
  // 占位色块：夜空色系 + 低饱和，深浅两端都在蓝紫范围内
  const light = `hsl(${hue} 38% 72%)`
  const dark = `hsl(${hue} 42% 46%)`

  return (
    <div
      className={cn('g-photo-thumb', size === 'display' && 'g-photo-thumb-display', className)}
      style={{ aspectRatio: `${photo.width} / ${photo.height}` }}
      role="img"
      aria-label={url ? photo.title : `${photo.title}（示例占位图）`}
    >
      {url ? (
        <img
          src={url}
          alt={photo.title}
          className="g-photo-thumb-img"
          // 详情页大图优先加载，列表图交给浏览器懒加载
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
        />
      ) : (
        <div
          className="g-photo-thumb-fill"
          style={{ background: `linear-gradient(135deg, ${light} 0%, ${dark} 100%)` }}
        >
          <span className="g-photo-thumb-title">{photo.title.slice(0, 1)}</span>
          <span className="g-photo-thumb-meta">
            {photo.width}×{photo.height}
          </span>
        </div>
      )}
      {priority && <span className="g-visually-hidden">优先加载</span>}
    </div>
  )
}
