/**
 * 分类体系单测（2026-11 分类换代：题材维度 → 风格维度）。
 *
 * 只锁「目录常量」这一份真源：页面下拉、分类页、面包屑、卡片徽标都从它派生，
 * 所以只要它是对的，其余位置不会各自漂移。
 * 数据库侧的迁移（0038）另有 .tmp/verify-0038-legacy.sh 在独立库上验证。
 */
import { describe, expect, it } from 'vitest'
import { CATEGORIES, CATEGORY_NAME_BY_SLUG, categoryName } from '@/domain/constants'

describe('分类目录（风格维度）', () => {
    it('正好 8 个分类，且全部启用', () => {
    expect(CATEGORIES).toHaveLength(8)
    for (const c of CATEGORIES) expect(c.isActive, `${c.slug} 应启用`).toBe(true)
  })

  it('顺序为 1–8 且不重复（数据库 uq_categories_sort_order 也要求唯一）', () => {
    const orders = CATEGORIES.map((c) => c.sortOrder)
    expect([...orders].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('8 个分类的名称与顺序是定稿的那一套', () => {
    const expected = [
      ['campus-fresh', '校园清新'],
      ['travel-doc', '旅行纪实'],
      ['japanese-soft', '日系治愈'],
      ['hk-retro', '港风复古'],
      ['new-chinese', '新中式国风'],
      ['korean-clear', '韩系清透'],
      ['cinematic-dark', '暗调电影感'],
      ['american-retro', '美式复古'],
    ]
    expect(CATEGORIES.map((c) => [c.slug, c.name])).toEqual(expected)
  })

  it('不含任何旧题材分类（换代后这些 slug 必须消失）', () => {
    const legacy = [
      'landscape',
      'people',
      'architecture',
      'industrial',
      'technology',
      'macro',
      'night',
      'monochrome',
    ]
    const slugs = CATEGORIES.map((c) => c.slug)
    for (const old of legacy) expect(slugs).not.toContain(old)
  })

  it('slug 符合数据库约束 `^[a-z0-9-]{1,32}$`，名称不超过 12 字', () => {
    for (const c of CATEGORIES) {
      expect(c.slug, `${c.slug} 的 slug 形状`).toMatch(/^[a-z0-9-]{1,32}$/)
      // categories.name 的 check 是 char_length between 1 and 12
      expect(c.name.length, `${c.name} 的名称长度`).toBeGreaterThanOrEqual(1)
      expect(c.name.length, `${c.name} 的名称长度`).toBeLessThanOrEqual(12)
      // description 的 check 是最长 100
      expect(c.description.length, `${c.slug} 的说明长度`).toBeLessThanOrEqual(100)
    }
  })

  it('所有 slug 唯一', () => {
    expect(new Set(CATEGORIES.map((c) => c.slug)).size).toBe(CATEGORIES.length)
  })

  it('名称映射覆盖全部分类，未知 slug 原样返回', () => {
    for (const c of CATEGORIES) expect(CATEGORY_NAME_BY_SLUG[c.slug]).toBe(c.name)
    expect(categoryName('landscape')).toBe('landscape')
    expect(categoryName('campus-fresh')).toBe('校园清新')
  })
})
