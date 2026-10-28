import { describe, expect, it } from 'vitest'
import { extractHeadings, renderMarkdown } from '@/lib/markdown'

describe('markdown rendering', () => {
  it('uses matching stable ids for duplicate CJK headings', () => {
    const markdown = '# 构图基础\n\n## 光线\n\n## 光线'
    expect(extractHeadings(markdown).map((heading) => heading.id)).toEqual(['构图基础', '光线', '光线-2'])
    const html = renderMarkdown(markdown)
    expect(html).toContain('id="构图基础"')
    expect(html).toContain('id="光线-2"')
  })

  it('hardens external links and removes executable markup', () => {
    const html = renderMarkdown('[参考](https://example.com)\n\n<script>alert(1)</script>')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).not.toContain('<script')
  })
})
