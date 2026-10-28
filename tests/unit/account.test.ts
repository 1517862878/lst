import { describe, expect, it } from 'vitest'
import { accountImageUrl, errorMessage, isSafeProfileLink } from '@/lib/account'

describe('accountImageUrl', () => {
  it('keeps absolute and browser-local image sources intact', () => {
    expect(accountImageUrl('https://img.example/avatar.png')).toBe('https://img.example/avatar.png')
    expect(accountImageUrl('blob:avatar')).toBe('blob:avatar')
    expect(accountImageUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc')
  })

  it('maps storage keys to the image endpoint and encodes path segments', () => {
    expect(accountImageUrl('avatar/user 1.png')).toBe('/images/avatar/user%201.png')
    expect(accountImageUrl('/images/avatar.png')).toBe('/images/avatar.png')
  })

  it('returns null for missing values', () => {
    expect(accountImageUrl(null)).toBeNull()
    expect(accountImageUrl('   ')).toBeNull()
  })
})

describe('profile link validation', () => {
  it('allows only http and https links', () => {
    expect(isSafeProfileLink('https://example.com/me')).toBe(true)
    expect(isSafeProfileLink('http://example.com')).toBe(true)
    expect(isSafeProfileLink('javascript:alert(1)')).toBe(false)
    expect(isSafeProfileLink('not a url')).toBe(false)
  })
})

describe('errorMessage', () => {
  it('uses a useful Error message and falls back for unknown values', () => {
    expect(errorMessage(new Error('保存失败'))).toBe('保存失败')
    expect(errorMessage({ message: 'ignored' }, '请重试')).toBe('请重试')
  })
})
