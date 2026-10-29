/**
 * 最近搜索存储层单测（src/lib/recentSearches.ts）。
 * 关键行为：去重（大小写不敏感）、置顶、上限截断、存储不可用时静默降级。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  RECENT_SEARCH_MAX,
  RECENT_SEARCH_TERM_MAX,
  clearRecentSearches,
  normalizeSearchTerm,
  pushRecentSearch,
  readRecentSearches,
} from '@/lib/recentSearches'

beforeEach(() => {
  window.localStorage.clear()
})

describe('lib/recentSearches', () => {
  it('空存储返回空数组', () => {
    expect(readRecentSearches()).toEqual([])
  })

  it('最新一次搜索置顶，重复项去重（大小写不敏感）', () => {
    pushRecentSearch('夜景')
    pushRecentSearch('街头')
    pushRecentSearch('夜景')
    expect(readRecentSearches()).toEqual(['夜景', '街头'])

    pushRecentSearch('Landscape')
    pushRecentSearch('landscape')
    expect(readRecentSearches()).toEqual(['landscape', '夜景', '街头'])
  })

  it('折叠空白并去掉首尾空白', () => {
    expect(normalizeSearchTerm('  长   曝光 ')).toBe('长 曝光')
    expect(pushRecentSearch('  长   曝光 ')).toEqual(['长 曝光'])
  })

  it(`最多保留 ${RECENT_SEARCH_MAX} 条，超出丢最旧`, () => {
    for (let i = 0; i < RECENT_SEARCH_MAX + 3; i += 1) pushRecentSearch(`词 ${i}`)
    const items = readRecentSearches()
    expect(items).toHaveLength(RECENT_SEARCH_MAX)
    expect(items[0]).toBe(`词 ${RECENT_SEARCH_MAX + 2}`)
    expect(items).not.toContain('词 0')
  })

  it('超长关键词按上限截断，不写进超长串', () => {
    pushRecentSearch('x'.repeat(RECENT_SEARCH_TERM_MAX + 20))
    expect(readRecentSearches()[0]).toHaveLength(RECENT_SEARCH_TERM_MAX)
  })

  it('清空后读到空数组', () => {
    pushRecentSearch('夜景')
    expect(clearRecentSearches()).toEqual([])
    expect(readRecentSearches()).toEqual([])
  })

  it('存储里是坏 JSON / 非数组时降级成空数组，不抛错', () => {
    window.localStorage.setItem('g.recent-searches', '{oops')
    expect(readRecentSearches()).toEqual([])
    window.localStorage.setItem('g.recent-searches', '{"a":1}')
    expect(readRecentSearches()).toEqual([])
    window.localStorage.setItem('g.recent-searches', '[1,"夜景",null]')
    expect(readRecentSearches()).toEqual(['夜景'])
  })

  it('空白关键词不写入存储', () => {
    expect(pushRecentSearch('   ')).toEqual([])
    expect(readRecentSearches()).toEqual([])
  })
})
