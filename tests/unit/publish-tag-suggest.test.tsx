/**
 * 发布页标签候选单测（src/features/tags/PublishTagSuggest.tsx，8.3a）。
 *
 * 这个组件的价值在于「让全站标签可聚合」，所以断言重点是替换语义：
 *   · 只替换**正在输入的那个词**，已确定的标签原样保留；
 *   · 已选标签不重复出现在候选里；
 *   · 到了上限（默认 5 个）就整块消失。
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  items: [
    { tag: '夜景', photoCount: 12 },
    { tag: '夜色', photoCount: 3 },
  ],
  args: [] as Array<[string, Record<string, unknown>]>,
  /** 没有正在输入的词时，热门候选从这里来 */
  hot: [] as Array<{ tag: string; photoCount: number }>,
}))

vi.mock('@/hooks/useTags', () => ({
  useTagSuggestions: (prefix: string, options: Record<string, unknown>) => {
    mocks.args.push([prefix, options])
    return { items: prefix ? mocks.items : [], loading: false }
  },
  useTags: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useTagDetail: () => ({ data: undefined, refetch: vi.fn() }),
  useTagPhotos: () => ({ data: undefined, refetch: vi.fn() }),
  useTagSearchList: () => ({ data: mocks.hot, error: null, isLoading: false, refetch: vi.fn() }),
}))

const { PublishTagSuggest } = await import('@/features/tags/PublishTagSuggest')

afterEach(() => {
  cleanup()
  mocks.args.length = 0
})

describe('PublishTagSuggest', () => {
  it('按正在输入的那个词请求建议（带 300ms 防抖与条数上限）', () => {
    render(<PublishTagSuggest value="城市 夜" onChange={vi.fn()} />)
    expect(mocks.args.at(-1)).toEqual(['夜', expect.objectContaining({ delay: 300, limit: 5, enabled: true })])
  })

  it('点击候选替换掉未完成的词，保留已确定的标签', async () => {
    const onChange = vi.fn()
    render(<PublishTagSuggest value="城市 夜" onChange={onChange} />)

    await userEvent.setup().click(screen.getByRole('button', { name: /#夜景/ }))
    expect(onChange).toHaveBeenCalledWith('城市 夜景 ')
  })

  it('末尾有空格 = 没有正在输入的词，不显示候选', () => {
    const onChange = vi.fn()
    render(<PublishTagSuggest value="城市 夜 " onChange={onChange} />)

    expect(mocks.args.at(-1)?.[0]).toBe('')
    expect(screen.queryByRole('group', { name: '标签候选' })).not.toBeInTheDocument()
  })

  it('已选中的标签不再出现在候选里', () => {
    render(<PublishTagSuggest value="夜景 夜" onChange={vi.fn()} />)
    const group = screen.getByRole('group', { name: '标签候选' })
    expect(group).not.toHaveTextContent('#夜景')
    expect(group).toHaveTextContent('#夜色')
  })

  it('达到上限后整块不渲染，也不再请求建议', () => {
    // parseTags 会丢掉长度 < 2 的词，所以这里用两字母占位
    render(<PublishTagSuggest value="aa bb cc dd ee" onChange={vi.fn()} max={5} />)
    expect(screen.queryByRole('group', { name: '标签候选' })).not.toBeInTheDocument()
    expect(mocks.args.at(-1)?.[1]).toMatchObject({ enabled: false })
  })

  it('空输入不请求建议', () => {
    render(<PublishTagSuggest value="   " onChange={vi.fn()} />)
    expect(mocks.args.at(-1)?.[0]).toBe('')
    expect(screen.queryByRole('group', { name: '标签候选' })).not.toBeInTheDocument()
  })

  it('没有正在输入的词时，给热门标签候选（点一下追加到末尾）', async () => {
    mocks.hot = [
      { tag: '风光', photoCount: 20 },
      { tag: '黑白', photoCount: 18 },
    ]
    const onChange = vi.fn()
    render(<PublishTagSuggest value="" onChange={onChange} />)

    const group = screen.getByRole('group', { name: '标签候选' })
    expect(group).toHaveTextContent('热门')
    await userEvent.setup().click(screen.getByRole('button', { name: /#风光/ }))
    expect(onChange).toHaveBeenCalledWith('风光 ')
    // 变换热候选不该顺手打前缀请求
    expect(mocks.args.at(-1)?.[1]).toMatchObject({ enabled: false })
    mocks.hot = []
  })

  it('热门候选里也不会重复已输入的标签', () => {
    mocks.hot = [
      { tag: '风光', photoCount: 20 },
      { tag: '黑白', photoCount: 18 },
    ]
    render(<PublishTagSuggest value="风光 " onChange={vi.fn()} />)

    const group = screen.getByRole('group', { name: '标签候选' })
    expect(group).not.toHaveTextContent('#风光')
    expect(group).toHaveTextContent('#黑白')
    mocks.hot = []
  })
})
