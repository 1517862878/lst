/**
 * 搜索输入建议单测（src/features/search/SearchCombobox.tsx）。
 *
 * 覆盖三件容易做错的事：
 *   · ARIA combobox 契约（aria-expanded / aria-activedescendant / role=option）；
 *   · 键盘全流程：↑↓ 移动高亮、Enter 选中、Escape 收起；
 *   · 有高亮项时 Enter 只选中，不额外提交一次表单。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchCombobox } from '@/features/search/SearchCombobox'

const mocks = vi.hoisted(() => ({
  suggest: vi.fn(),
}))

vi.mock('@/hooks/useTags', () => ({
  // 真正的 300ms 防抖在 tag-suggestions.test.tsx 里测；这里只关心交互与无障碍
  useTagSuggestions: (prefix: string) =>
    prefix.trim()
      ? { items: [{ tag: '夜景', photoCount: 3 }], loading: false }
      : { items: [], loading: false },
  useTagSearchList: () => ({ data: [], error: null, isLoading: false, refetch: vi.fn() }),
}))

afterEach(() => {
  cleanup()
  mocks.suggest.mockReset()
})

function setup(initialQuery = '') {
  const onSubmitQuery = vi.fn()
  const onPickTag = vi.fn()
  render(
    <SearchCombobox initialQuery={initialQuery} onSubmitQuery={onSubmitQuery} onPickTag={onPickTag} />,
  )
  return { user: userEvent.setup(), onSubmitQuery, onPickTag }
}

describe('SearchCombobox', () => {
  it('未输入时不下拉，输入后弹出「搜索」与标签建议', async () => {
    const { user } = setup()
    const box = screen.getByRole('combobox')
    expect(box).toHaveAttribute('aria-expanded', 'false')

    await user.click(box)
    await user.type(box, '夜')

    const list = await screen.findByRole('listbox', { name: '搜索建议' })
    expect(list).toBeInTheDocument()
    expect(box).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('option', { name: /搜索「夜」/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /#夜景/ })).toBeInTheDocument()
  })

  it('↓ 移动高亮并同步 aria-activedescendant / aria-selected', async () => {
    const { user, onPickTag } = setup()
    const box = screen.getByRole('combobox')
    await user.click(box)
    await user.type(box, '夜')
    await screen.findByRole('listbox')

    await user.keyboard('{ArrowDown}')
    const first = screen.getByRole('option', { name: /搜索「夜」/ })
    expect(first).toHaveAttribute('aria-selected', 'true')
    expect(box).toHaveAttribute('aria-activedescendant', first.id)

    await user.keyboard('{ArrowDown}')
    const second = screen.getByRole('option', { name: /#夜景/ })
    expect(second).toHaveAttribute('aria-selected', 'true')
    expect(first).toHaveAttribute('aria-selected', 'false')

    // ↑ 回到第一个
    await user.keyboard('{ArrowUp}')
    expect(first).toHaveAttribute('aria-selected', 'true')

    // 选中标签建议
    await user.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(onPickTag).toHaveBeenCalledWith('夜景'))
    expect(box).toHaveAttribute('aria-expanded', 'false')
  })

  it('高亮「搜索」项时 Enter 提交关键词且不重复提交表单', async () => {
    const { user, onSubmitQuery } = setup()
    const box = screen.getByRole('combobox')
    await user.click(box)
    await user.type(box, '夜景')
    await screen.findByRole('listbox')

    await user.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(onSubmitQuery).toHaveBeenCalledTimes(1))
    expect(onSubmitQuery).toHaveBeenCalledWith('夜景')
  })

  it('没有高亮项时回车走原生表单提交', async () => {
    const { user, onSubmitQuery } = setup()
    const box = screen.getByRole('combobox')
    await user.click(box)
    await user.type(box, '长曝光{Enter}')
    await waitFor(() => expect(onSubmitQuery).toHaveBeenCalledWith('长曝光'))
  })

  it('Escape 收起下拉但保留输入内容', async () => {
    const { user } = setup()
    const box = screen.getByRole('combobox')
    await user.click(box)
    await user.type(box, '夜')
    await screen.findByRole('listbox')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(box).toHaveAttribute('aria-expanded', 'false'))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(box).toHaveValue('夜')
  })

  it('初值来自 URL，变化时输入框跟随', async () => {
    const { container, rerender } = render(
      <SearchCombobox initialQuery="夜景" onSubmitQuery={vi.fn()} onPickTag={vi.fn()} />,
    )
    expect(screen.getByRole('combobox')).toHaveValue('夜景')

    rerender(<SearchCombobox initialQuery="街头" onSubmitQuery={vi.fn()} onPickTag={vi.fn()} />)
    expect(screen.getByRole('combobox')).toHaveValue('街头')
    expect(container.querySelector('.g-search-bar')).not.toBeNull()
  })
})
