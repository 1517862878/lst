/**
 * 标签链接组件单测（src/features/tags/TagLink.tsx）。
 *
 * 重点不是外观，而是两个容易出错的地方：
 *   · 路由参数必须 encodeURIComponent（标签里可能有空格、斜杠、井号）；
 *   · 标签是导航元素，必须渲染成 <a>（键盘可达、可中键新开），不能是 <button>。
 */
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { TagChips, TagLink } from '@/features/tags/TagLink'
import { tagPath } from '@/features/tags/tagPaths'

afterEach(cleanup)

function renderTag(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('features/tags/TagLink', () => {
  it('渲染为链接并带 # 前缀与计数', () => {
    renderTag(<TagLink tag="夜景" count={12} />)
    const link = screen.getByRole('link', { name: /夜景/ })
    expect(link).toHaveAttribute('href', '/tags/%E5%A4%9C%E6%99%AF')
    expect(link).toHaveTextContent('#夜景')
    expect(link).toHaveTextContent('12')
    expect(link).toHaveAttribute('data-tag', '夜景')
  })

  it('含空格与斜杠的标签被正确编码', () => {
    expect(tagPath('long exposure')).toBe('/tags/long%20exposure')
    expect(tagPath('a/b')).toBe('/tags/a%2Fb')
    renderTag(<TagLink tag="a/b" />)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/tags/a%2Fb')
  })

  it('计数缺失时不渲染计数节点', () => {
    renderTag(<TagLink tag="街头" />)
    expect(screen.getByRole('link')).not.toHaveTextContent(/\d/)
  })

  it('size 映射到各自的类名', () => {
    const { container, unmount } = renderTag(<TagLink tag="t" size="lg" />)
    expect(container.querySelector('.g-tag-chip-lg')).not.toBeNull()
    unmount()

    const small = renderTag(<TagLink tag="t" size="sm" />)
    expect(small.container.querySelector('.g-tag-chip-sm')).not.toBeNull()
  })
})

describe('features/tags/TagChips', () => {
  it('空数组不渲染空容器', () => {
    const { container } = renderTag(<TagChips tags={[]} label="作品标签" />)
    expect(container.querySelector('.g-tag-chips')).toBeNull()
  })

  it('limit 只渲染前 N 个标签', () => {
    renderTag(<TagChips tags={['a', 'b', 'c', 'd']} limit={2} />)
    expect(screen.getAllByRole('link')).toHaveLength(2)
    expect(screen.getByRole('list')).toHaveAccessibleName('标签')
  })

  it('无障碍名称可由调用方覆盖（作品标签 / 相关标签）', () => {
    renderTag(<TagChips tags={['a']} label="相关标签" />)
    expect(screen.getByRole('list', { name: '相关标签' })).toBeInTheDocument()
  })
})
