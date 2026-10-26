import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/cn'

describe('cn（className 合并）', () => {
  it('过滤 falsy 值', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b')
  })

  it('空输入返回空串', () => {
    expect(cn()).toBe('')
  })
})
