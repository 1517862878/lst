/**
 * 中文分词（ROADMAP §7 / FRONTEND-WORK §4.6）。
 * 策略：Intl.Segmenter 分词；不支持的浏览器降级 bigram（双字切分）。
 */
import { normalizeSearchText } from './normalize'

export function tokenize(text: string): string[] {
  const normalized = normalizeSearchText(text)
  if (!normalized) return []

  // 尝试 Intl.Segmenter（中文按词切分）
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    try {
      const seg = new Intl.Segmenter('zh', { granularity: 'word' })
      const tokens: string[] = []
      for (const part of seg.segment(normalized)) {
        if (part.isWordLike) tokens.push(part.segment)
      }
      if (tokens.length > 0) return dedupe(tokens)
    } catch {
      /* 降级 bigram */
    }
  }

  // bigram 兜底：双字切分（含英文单词按空格拆分）
  return dedupe(bigram(normalized))
}

/** 双字切分：中文按相邻两字，英文/数字按空格拆词 */
function bigram(text: string): string[] {
  const tokens: string[] = []
  // 英文单词
  const words = text.match(/[a-z0-9]+/g) ?? []
  tokens.push(...words)
  // 中文双字
  const han = text.match(/[\u4e00-\u9fa5]+/g) ?? []
  for (const run of han) {
    for (let i = 0; i < run.length - 1; i++) {
      tokens.push(run.slice(i, i + 2))
    }
    if (run.length === 1) tokens.push(run)
  }
  return tokens
}

function dedupe(tokens: string[]): string[] {
  return [...new Set(tokens)].filter((t) => t.length > 0)
}
