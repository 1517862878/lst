/**
 * 标签链接（标签体系 8.3a 的统一出口）。
 *
 * 全站所有「#标签」都走这里，原因：
 *   · 标签在聚合口径上是「一个可跳转的实体」，不是装饰文字——作品卡、作品详情、
 *     搜索建议、热门标签区必须都指向 /tags/:tag，而不是各写各的按钮；
 *   · 路由参数必须 encodeURIComponent（标签里可能有空格、斜杠），
 *     散落在各处拼字符串迟早漏编。
 */
import { Link } from 'react-router'
import { cn } from '@/lib/cn'
import { tagPath } from './tagPaths'

export type TagLinkSize = 'sm' | 'md' | 'lg'

export interface TagLinkProps {
  tag: string
  /** 关联作品数（可选；给了就在标签后显示计数） */
  count?: number
  size?: TagLinkSize
  className?: string
  onClick?: () => void
}

export function TagLink({ tag, count, size = 'md', className, onClick }: TagLinkProps) {
  return (
    <Link
      to={tagPath(tag)}
      className={cn('g-tag-chip', `g-tag-chip-${size}`, className)}
      onClick={onClick}
      data-tag={tag}
    >
      <span className="g-tag-chip-label">#{tag}</span>
      {typeof count === 'number' && (
        <span className="g-tag-chip-count" aria-label={`${count} 件作品`}>
          {count}
        </span>
      )}
    </Link>
  )
}

export interface TagChipsProps {
  tags: readonly string[]
  size?: TagLinkSize
  /** 无障碍名称：不同位置的标签列表语义不同（作品标签 / 相关标签） */
  label?: string
  className?: string
  /** 是否显示「#」；作品详情里默认显示 */
  limit?: number
}

/** 标签行（作品卡 / 作品详情用）：空数组时不渲染空容器 */
export function TagChips({ tags, size = 'sm', label = '标签', className, limit }: TagChipsProps) {
  const shown = typeof limit === 'number' ? tags.slice(0, limit) : tags
  if (shown.length === 0) return null
  return (
    <ul className={cn('g-tag-chips', className)} aria-label={label}>
      {shown.map((tag) => (
        <li key={tag}>
          <TagLink tag={tag} size={size} />
        </li>
      ))}
    </ul>
  )
}
