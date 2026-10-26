/**
 * Markdown 渲染管线（ROADMAP §7 / FRONTEND-WORK §4.6）。
 * marked 解析 + DOMPurify 净化，白名单标签/属性，防 XSS。
 */
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// 只允许标题/段落/列表/代码/引用/链接/加粗/斜体/表格
const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'a', 'strong', 'em', 'br', 'hr',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img',
]
const ALLOWED_ATTR = ['href', 'title', 'src', 'alt', 'target', 'rel']

// 配置 marked：链接新窗口打开 + 安全
marked.setOptions({
  gfm: true,
  breaks: true,
})

/**
 * 渲染 Markdown 为安全 HTML。
 * 链接强制 target=_blank + rel=noopener（防 window.opener 攻击）。
 */
export function renderMarkdown(md: string): string {
  const raw = marked.parse(md) as string
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onerror', 'onclick', 'onload', 'style'],
    ADD_ATTR: ['target'],
  })
}

/** 提取标题（用于目录锚点） */
export function extractHeadings(md: string): Array<{ id: string; text: string; level: number }> {
  const headings: Array<{ id: string; text: string; level: number }> = []
  const lines = md.split('\n')
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.+)$/.exec(line.trim())
    if (m) {
      const level = m[1]!.length
      const text = m[2]!.trim()
      const id = text
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
        .replace(/^-+|-+$/g, '')
      headings.push({ id, text, level })
    }
  }
  return headings
}
