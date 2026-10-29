/**
 * 组照画册（8.4c）：主图 + 缩略图条 + 左右方向键。
 *
 * 只在 itemCount > 1 时渲染（判定集中在 domain/photoItems.hasPhotoGallery）；
 * 单图作品继续走原来的 PhotoThumb，连 DOM 结构都不变。
 *
 * 为什么把键盘监听放在容器上而不是 window：
 *   · 页面里还有评论输入框，全局监听会把「在输入框里按 ←」也当成翻页；
 *   · 容器是 tabIndex=0 的 role="group"，用户 Tab 进来就能用方向键，
 *     焦点不在画册里时按键不生效 —— 键盘可达但不越权。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Photo, PhotoItem } from '@/domain/types'
import { usePhotoImage } from '@/hooks/usePhotoImage'
import { cn } from '@/lib/cn'
import { PhotoItemThumb } from './PhotoItemThumb'

export interface PhotoGalleryProps {
  photo: Photo
}

function clampIndex(value: number, total: number): number {
  if (total <= 0) return 0
  if (value < 0) return 0
  if (value > total - 1) return total - 1
  return value
}

export function PhotoGallery({ photo }: PhotoGalleryProps) {
  const items: PhotoItem[] = photo.items ?? []
  const [index, setIndex] = useState(0)
  const stageRef = useRef<HTMLDivElement>(null)
  // items 变短（别人删了一张）时把下标夹回合法范围，避免主图空白
  const activeIndex = clampIndex(index, items.length)
  const active = items[activeIndex]
  const { url } = usePhotoImage(active?.imageKey ?? null)

  useEffect(() => {
    if (index !== activeIndex) setIndex(activeIndex)
  }, [index, activeIndex])

  const go = useCallback(
    (next: number) => {
      setIndex(clampIndex(next, items.length))
      // 换图后把焦点留在画册里，连续按方向键才不会掉出去
      stageRef.current?.focus()
    },
    [items.length],
  )

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault()
        go(activeIndex - 1)
        break
      case 'ArrowRight':
        event.preventDefault()
        go(activeIndex + 1)
        break
      case 'Home':
        event.preventDefault()
        go(0)
        break
      case 'End':
        event.preventDefault()
        go(items.length - 1)
        break
      default:
        break
    }
  }

  if (!active) return null

  const caption = active.caption.trim()
  const alt = caption || `${photo.title}（第 ${activeIndex + 1} 张）`
  const ratio = active.width > 0 && active.height > 0 ? `${active.width} / ${active.height}` : '4 / 3'

  return (
    <div
      ref={stageRef}
      className="g-gallery"
      role="group"
      aria-roledescription="组照画册"
      aria-label={`${photo.title}，共 ${items.length} 张`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <figure className="g-gallery-stage">
        <div className="g-gallery-image" style={{ aspectRatio: ratio }}>
          {url ? (
            <img src={url} alt={alt} className="g-gallery-img" loading="eager" decoding="async" draggable={false} />
          ) : (
            <div className="g-gallery-fill" aria-hidden="true">
              <span>{active.width}×{active.height}</span>
            </div>
          )}
        </div>
        <figcaption className="g-gallery-caption">
          {/* aria-live：翻页时读屏会听到「第 2 / 5 张」，视觉上也是一条计数 */}
          <p className="g-gallery-counter" aria-live="polite">
            第 {activeIndex + 1} / {items.length} 张
          </p>
          {caption && <p className="g-gallery-note">{caption}</p>}
        </figcaption>
      </figure>

      <ul className="g-gallery-strip" aria-label="选择要看的图">
        {items.map((item, itemIndex) => {
          const selected = itemIndex === activeIndex
          const itemCaption = item.caption.trim()
          return (
            <li key={item.id}>
              <button
                type="button"
                className={cn('g-gallery-thumb', selected && 'g-gallery-thumb-active')}
                // aria-pressed 而不是 aria-selected：这是「切换显示哪张」的开关按钮，
                // 用 pressed 状态读屏会念「已按下」，语义比重造 tablist 更准确
                aria-pressed={selected}
                aria-label={`第 ${itemIndex + 1} 张${itemCaption ? `：${itemCaption}` : ''}`}
                onClick={() => go(itemIndex)}
              >
                <PhotoItemThumb
                  thumbKey={item.thumbKey}
                  alt=""
                  width={item.width}
                  height={item.height}
                  className="g-gallery-thumb-img"
                />
                {itemIndex === 0 && <span className="g-gallery-thumb-cover">封面</span>}
              </button>
            </li>
          )
        })}
      </ul>
      <p className="g-gallery-hint">← → 切换（画册获得焦点时可用）</p>
    </div>
  )
}
