/** marked + DOMPurify rendering with deterministic heading anchors. */
import { marked, type Tokens } from 'marked'
import DOMPurify from 'dompurify'

const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'blockquote',
  'pre', 'code', 'a', 'strong', 'em', 'br', 'hr', 'table', 'thead', 'tbody',
  'tr', 'th', 'td', 'img',
]
const ALLOWED_ATTR = ['href', 'title', 'src', 'alt', 'target', 'rel', 'id']

marked.setOptions({ gfm: true, breaks: true })

export function renderMarkdown(md: string): string {
  const renderer = new marked.Renderer()
  const ids = createHeadingIdGenerator()
  renderer.heading = ({ tokens, depth }: Tokens.Heading) => {
    const text = renderer.parser.parseInline(tokens)
    const plainText = tokens.map((token) => 'text' in token ? String(token.text) : '').join('')
    return `<h${depth} id="${ids.next(plainText)}">${text}</h${depth}>`
  }
  renderer.link = ({ href, title, tokens }: Tokens.Link) => {
    const safeHref = href || '#'
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
    return `<a href="${escapeHtml(safeHref)}"${titleAttr} target="_blank" rel="noopener noreferrer">${renderer.parser.parseInline(tokens)}</a>`
  }

  const raw = marked.parse(md, { renderer }) as string
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onerror', 'onclick', 'onload', 'style'],
  })
}

export function extractHeadings(md: string): Array<{ id: string; text: string; level: number }> {
  const headings: Array<{ id: string; text: string; level: number }> = []
  const ids = createHeadingIdGenerator()
  for (const line of md.split('\n')) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line.trim())
    if (!match) continue
    const level = match[1]!.length
    const text = match[2]!.trim().replace(/\s+#+$/u, '')
    headings.push({ id: ids.next(text), text, level })
  }
  return headings
}

function createHeadingIdGenerator() {
  const seen = new Map<string, number>()
  return {
    next(text: string) {
      const base = text
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/<[^>]*>/gu, '')
        .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
        .replace(/^-+|-+$/gu, '') || 'section'
      const count = seen.get(base) ?? 0
      seen.set(base, count + 1)
      return count === 0 ? base : `${base}-${count + 1}`
    },
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!)
}
