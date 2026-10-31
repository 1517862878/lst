/**
 * 字号档位工具（从 AppearancePage 抽出）。
 *
 * 为什么单独成文件：路由用 `lazyNamed(...)` 的 `PageModule` 是「导出必须都是组件」的
 * 索引签名，页面文件里再导出普通函数会让整条路由的类型检查失败。
 */
import { FONT_SIZE_MAX, FONT_SIZE_MIN, clampInt } from '@/domain/appearance'

/* ─────────────────────────── 字号档位 ─────────────────────────── */

/**
 * 字号档位表。
 *  · 像素体：只给 12 / 14 / 16 / 24（12 的整数倍 + 既有令牌 14/16），避免非整数缩放糊字形
 *  · 其它字体：按 range 逐 1px
 */
export function fontSizeLevels(integerMultiple: boolean, range: { min: number; max: number }): number[] {
  if (!integerMultiple) {
    const out: number[] = []
    for (let v = range.min; v <= range.max; v++) out.push(v)
    return out
  }
  const allowed = [12, 14, 16, 24]
  const filtered = allowed.filter(
    (v) => v >= Math.max(range.min, FONT_SIZE_MIN) && v <= Math.min(range.max, FONT_SIZE_MAX),
  )
  return filtered.length > 0 ? filtered : [clampInt(16, range.min, range.max)]
}

/** 找到与当前字号最近的档位下标（字号可能来自旧设置，不在档位表内） */
export function nearestLevelIndex(levels: readonly number[], value: number): number {
  let best = 0
  let bestDiff = Infinity
  for (let i = 0; i < levels.length; i++) {
    const diff = Math.abs((levels[i] ?? value) - value)
    if (diff < bestDiff) {
      bestDiff = diff
      best = i
    }
  }
  return best
}
