/**
 * 公开主页「代表作」置顶块（8.4a ④）。
 *
 * 未设置时整块不渲染（返回 null）——不留空标题占位：访客看到的应当是
 * 「这个主页有什么」，而不是「这个作者没配什么」。
 *
 * 数据来自资料投影里的作品摘要（id + title + thumbKey），所以置顶作品
 * 即使不在首屏作品流里也能展示；也不额外发请求去逐件取详情。
 */
import { Link } from 'react-router'
import type { PinnedPhoto } from '@/domain/types'
import { usePhotoImage } from '@/hooks/usePhotoImage'

function PinnedThumb({ thumbKey }: { thumbKey: string | null }) {
  const { url } = usePhotoImage(thumbKey)
  if (!url) {
    // 种子数据没有真实文件：保留色块位，避免出现破图
    return <span className="g-pinned-thumb g-pinned-thumb-empty" aria-hidden="true" />
  }
  return <img src={url} alt="" className="g-pinned-thumb" loading="lazy" decoding="async" />
}

export interface PinnedShowcaseProps {
  pinned?: PinnedPhoto[] | undefined
  className?: string
}

export function PinnedShowcase({ pinned, className }: PinnedShowcaseProps) {
  if (!pinned || pinned.length === 0) return null

  return (
    <section className={['g-pinned-block', className].filter(Boolean).join(' ')} aria-labelledby="profile-pinned-title">
      <div className="g-pinned-head">
        <h2 className="g-pinned-title" id="profile-pinned-title">
          代表作
        </h2>
        <span className="g-pinned-sub">作者置顶的 {pinned.length} 件作品</span>
      </div>
      <ul className="g-pinned-grid">
        {pinned.map((photo, index) => (
          <li key={photo.id} className="g-pinned-item">
            <Link to={`/works/${photo.id}`} className="g-pinned-card">
              {/* 序号对读屏有意义（置顶顺序即作者排序），所以不做 aria-hidden */}
              <span className="g-pinned-order">{index + 1}</span>
              <PinnedThumb thumbKey={photo.thumbKey} />
              <span className="g-pinned-card-title">{photo.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
