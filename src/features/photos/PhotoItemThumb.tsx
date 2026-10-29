/**
 * 组照单张的缩略图（8.4c）。
 *
 * 两条来源：
 *   1) 已经上传好的键（imageKey / thumbKey）→ 走 usePhotoImage 从存储层读 Blob；
 *   2) 刚选中的本地文件 → 调用方给 previewUrl（object URL），不再读存储。
 *
 * 读不到时回退占位块而不是破图：种子数据只有键没有文件，这种情况是常态。
 */
import { usePhotoImage } from '@/hooks/usePhotoImage'
import { cn } from '@/lib/cn'

export interface PhotoItemThumbProps {
  /** 缩略图键（读存储用） */
  thumbKey?: string | null
  /** 本地预览地址；给了就完全跳过存储读取 */
  previewUrl?: string | null
  alt: string
  width: number
  height: number
  className?: string
}

export function PhotoItemThumb({ thumbKey, previewUrl, alt, width, height, className }: PhotoItemThumbProps) {
  const { url } = usePhotoImage(previewUrl ? null : (thumbKey ?? null))
  const src = previewUrl ?? url
  const ratio = width > 0 && height > 0 ? `${width} / ${height}` : '4 / 3'

  return (
    // 用 span 而不是 div：画册缩略图把它放进 <button> 里，button 只允许短语内容
    <span className={cn('g-item-thumb', className)} style={{ aspectRatio: ratio }}>
      {src ? (
        <img src={src} alt={alt} className="g-item-thumb-img" loading="lazy" decoding="async" draggable={false} />
      ) : (
        <span className="g-item-thumb-fill" aria-hidden="true">
          <span>{width > 0 && height > 0 ? `${width}×${height}` : '预览'}</span>
        </span>
      )}
    </span>
  )
}
