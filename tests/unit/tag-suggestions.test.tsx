/**
 * 标签输入建议的防抖单测（src/hooks/useTags.ts · useTagSuggestions）。
 *
 * 用假定时器精确验证 300ms：早 1ms 不发请求、到点只发一次；
 * 连续输入时旧请求被取消（组件卸载同理），不会出现「先输的词后到」的倒序覆盖。
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTagSuggestions } from '@/hooks/useTags'

const mocks = vi.hoisted(() => ({
  suggest: vi.fn(),
}))

vi.mock('@/data', () => ({
  createRepositories: () => ({ tags: { suggest: mocks.suggest } }),
}))

function Probe({ prefix, enabled = true }: { prefix: string; enabled?: boolean }) {
  const { items, loading } = useTagSuggestions(prefix, { delay: 300, enabled })
  return (
    <output>
      <span data-testid="tags">{items.map((item) => item.tag).join(',')}</span>
      <span data-testid="loading">{loading ? 'yes' : 'no'}</span>
    </output>
  )
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  mocks.suggest.mockReset()
  mocks.suggest.mockResolvedValue([{ tag: '夜景', photoCount: 3 }])
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useTagSuggestions', () => {
  it('299ms 不发请求，300ms 到点只发一次', async () => {
    render(<Probe prefix="夜" />)
    expect(screen.getByTestId('loading')).toHaveTextContent('yes')

    await advance(299)
    expect(mocks.suggest).not.toHaveBeenCalled()

    await advance(1)
    expect(mocks.suggest).toHaveBeenCalledTimes(1)
    expect(mocks.suggest).toHaveBeenCalledWith('夜', { limit: 10 })
    expect(screen.getByTestId('tags')).toHaveTextContent('夜景')
    expect(screen.getByTestId('loading')).toHaveTextContent('no')
  })

  it('持续输入只保留最后一次请求', async () => {
    const { rerender } = render(<Probe prefix="夜" />)
    await advance(100)
    rerender(<Probe prefix="夜景" />)
    await advance(100)
    rerender(<Probe prefix="夜景建" />)
    await advance(300)

    expect(mocks.suggest).toHaveBeenCalledTimes(1)
    expect(mocks.suggest).toHaveBeenCalledWith('夜景建', { limit: 10 })
  })

  it('卸载后不再写入结果（取消在途建议）', async () => {
    const { unmount } = render(<Probe prefix="夜" />)
    unmount()
    await advance(500)
    expect(mocks.suggest).not.toHaveBeenCalled()
  })

  it('disabled 或空输入时不下发请求，并清空旧结果', async () => {
    const { rerender } = render(<Probe prefix="夜" enabled={false} />)
    await advance(400)
    expect(mocks.suggest).not.toHaveBeenCalled()

    rerender(<Probe prefix="夜" />)
    await advance(400)
    expect(mocks.suggest).toHaveBeenCalledTimes(1)

    rerender(<Probe prefix="   " />)
    await advance(400)
    expect(screen.getByTestId('tags')).toHaveTextContent('')
    expect(mocks.suggest).toHaveBeenCalledTimes(1)
  })

  it('仓储失败时安静降级为空建议，不影响输入', async () => {
    mocks.suggest.mockRejectedValueOnce(new Error('offline'))
    render(<Probe prefix="夜" />)
    await advance(400)
    expect(screen.getByTestId('tags')).toHaveTextContent('')
    expect(screen.getByTestId('loading')).toHaveTextContent('no')
  })
})
