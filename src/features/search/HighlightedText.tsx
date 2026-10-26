/**
 * 高亮组件（FRONTEND-WORK §3.3 HighlightedText）。
 * 仅包 <mark>，不解析 HTML（XSS 安全）。
 */
import type { ReactNode } from 'react'

export function HighlightedText({ text, terms }: { text: string; terms: string[] }): ReactNode {
  const active = terms.filter((t) => t.length > 0)
  if (active.length === 0) return text

  // 按首个匹配词高亮（简单实现，不重叠）
  const escaped = active.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi')
  const parts = text.split(regex)

  return parts.map((part, i) =>
    active.some((t) => t.toLowerCase() === part.toLowerCase()) ? (
      <mark key={i} className="g-highlight">
        {part}
      </mark>
    ) : (
      part
    ),
  )
}
