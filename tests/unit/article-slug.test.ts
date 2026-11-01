/**
 * slug 生成（0039 用户发文）。
 *
 * 为什么值得单测：这段逻辑决定「URL 是否合法可存」。
 * 纯中文标题必须退化成合法占位 slug —— 生成不合法 slug 会让发布直接 400，
 * 而作者看不出是自己标题的锅。
 */
import { describe, expect, it } from 'vitest'
import { slugFromTitle } from '@/features/learn/slugFromTitle'

const SLUG_RE = /^[a-z0-9-]{1,80}$/

describe('slugFromTitle', () => {
  it('英文标题转成小写连字符', () => {
    expect(slugFromTitle('My First Article')).toBe('my-first-article')
  })

  it('连续符号与首尾符号被压掉', () => {
    expect(slugFromTitle('  --Hello,   World!!--  ')).toBe('hello-world')
  })

  it('保留数字', () => {
    expect(slugFromTitle('ISO 6400 test')).toBe('iso-6400-test')
  })

  it('纯中文标题退化为合法占位 slug', () => {
    const slug = slugFromTitle('构图的三个基本问题')
    expect(slug).toMatch(SLUG_RE)
    expect(slug.startsWith('article-')).toBe(true)
  })

  it('单个字母标题也算太短，退化为占位 slug', () => {
    expect(slugFromTitle('a')).toMatch(/^article-/)
  })

  it('无论输入什么，结果都符合数据库 slug 约束', () => {
    const inputs = ['', '   ', '!!!', '中文标题', 'Mixed 中文 English', 'x'.repeat(200), '🎞️']
    for (const input of inputs) {
      expect(slugFromTitle(input)).toMatch(SLUG_RE)
    }
  })

  it('超长标题截断后仍合法', () => {
    const slug = slugFromTitle('a'.repeat(10) + 'b'.repeat(200))
    expect(slug.length).toBeLessThanOrEqual(80)
    expect(slug).toMatch(SLUG_RE)
  })
})
