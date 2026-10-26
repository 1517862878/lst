/**
 * 文章渲染组件（FRONTEND-WORK §3.3 ArticleReader/MarkdownBody/ArticleToc）。
 * 正文 HTML 已净化（lib/markdown），目录锚点。
 */
import { renderMarkdown, extractHeadings } from '@/lib/markdown'
import type { Article } from '@/domain/types'
import { Badge } from '@/components/ui/Badge'
import { formatDate } from '@/lib/time'

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: '入门',
  intermediate: '进阶',
  advanced: '高级',
}

const DIFFICULTY_TONES: Record<string, 'info' | 'success' | 'warning'> = {
  beginner: 'success',
  intermediate: 'info',
  advanced: 'warning',
}

export function ArticleReader({ article }: { article: Article }) {
  const html = renderMarkdown(article.bodyMd)
  const headings = extractHeadings(article.bodyMd)

  return (
    <article className="g-article">
      <header className="g-article-header">
        <h1 className="g-article-title">{article.title}</h1>
        <div className="g-article-meta">
          <Badge tone={DIFFICULTY_TONES[article.difficulty] ?? 'info'}>
            {DIFFICULTY_LABELS[article.difficulty] ?? article.difficulty}
          </Badge>
          <span>约 {article.readingMinutes} 分钟</span>
          <span>更新于 {formatDate(article.updatedAt)}</span>
        </div>
        {article.summary && <p className="g-article-summary">{article.summary}</p>}
      </header>

      {headings.length > 0 && (
        <nav className="g-article-toc" aria-label="文章目录">
          <p className="g-article-toc-title">目录</p>
          <ul>
            {headings.map((h) => (
              <li key={h.id} style={{ paddingLeft: (h.level - 1) * 12 }}>
                <a href={`#${h.id}`}>{h.text}</a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div
        className="g-article-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  )
}
