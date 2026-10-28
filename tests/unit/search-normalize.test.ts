import { describe, expect, it } from 'vitest'
import { normalizeSearchText, normalizeTag, parseTags } from '@/lib/search/normalize'

describe('search and tag normalization', () => {
  it('normalizes fullwidth characters, case and whitespace', () => {
    expect(normalizeSearchText('  ＮＩＫＯＮ　夜景 ')).toBe('nikon 夜景')
  })

  it('removes tag decoration and deduplicates normalized tags', () => {
    expect(parseTags('#夜景 ＃夜景，ＮＩＫＯＮ 长曝光')).toEqual(['夜景', 'nikon', '长曝光'])
  })

  it('enforces tag length and count', () => {
    expect(parseTags('a 合法 aa bb cc dd ee ff', 5)).toEqual(['合法', 'aa', 'bb', 'cc', 'dd'])
    expect(normalizeTag(' ＃Street＃ ')).toBe('street')
  })
})
