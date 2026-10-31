/**
 * 外观域模型单测（规格：docs/视觉规格-背景系统与字体体系.md）。
 *
 * 重点覆盖三件「错了会静默坏事」的逻辑：
 *  1. 压暗查表 —— 任何亮度的照片，正文对比度都必须 ≥4.5:1
 *  2. 设置归一化 —— 被手改坏/旧版本的 localStorage 不能把页面带到非法状态
 *  3. 字阶等比 —— 放大正文字号后，标题必须同步放大且保持整数
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APPEARANCE,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  PALETTES,
  SUBJECTS,
  blendOver,
  contrastRatio,
  normalizeAppearance,
  relativeLuminance,
  resolveAppearance,
  scrimPlan,
  textScaleFor,
} from '@/domain/appearance'
import { fontSizeLevels, nearestLevelIndex } from '@/lib/appearanceFontSize'

describe('scrimPlan 压暗查表', () => {
  it('深色方案：从极暗到极亮的每个采样亮度都保证 ≥4.5:1', () => {
    for (let luma = 0; luma <= 1.0001; luma += 0.02) {
      const plan = scrimPlan(luma, 'dark')
      expect(plan.worstContrast).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('深色方案：偏亮照片会自动加档，偏暗照片保持基础档（单调）', () => {
    const dark = scrimPlan(0.05, 'dark')
    const bright = scrimPlan(0.85, 'dark')
    expect(dark.boost).toBe(0)
    expect(bright.boost).toBeGreaterThan(0)
    expect(bright.alphas[2]!).toBeGreaterThan(dark.alphas[2]!)
  })

  it('浅色方案：不无限提亮，偏暗照片改走「实色面板承字」', () => {
    const veryDark = scrimPlan(0.05, 'light')
    expect(veryDark.needsPanel).toBe(true)
    expect(veryDark.color).toBe('#F7F3E9')

    const brightPaper = scrimPlan(0.6, 'light')
    expect(brightPaper.needsPanel).toBe(false)
    expect(brightPaper.alphas[2]).toBe(0)
  })

  it('可见度系数调低时对比度同步下降，但强度 1 仍是安全基准', () => {
    const safe = scrimPlan(0.5, 'dark', 1)
    const seeThrough = scrimPlan(0.5, 'dark', 0.55)
    const darker = scrimPlan(0.5, 'dark', 1.3)

    expect(safe.worstContrast).toBeGreaterThanOrEqual(4.5)
    expect(seeThrough.worstContrast).toBeLessThan(safe.worstContrast)
    expect(darker.worstContrast).toBeGreaterThan(safe.worstContrast)
  })

  it('非法/缺失亮度按中性值处理，不抛异常', () => {
    expect(() => scrimPlan(Number.NaN, 'dark')).not.toThrow()
    expect(scrimPlan(Number.NaN, 'dark').worstContrast).toBeGreaterThanOrEqual(4.5)
  })
})

describe('对比度工具', () => {
  it('黑白是 21:1，同色是 1:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0)
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5)
  })

  it('blendOver 在 alpha=0/1 时分别等于底/顶', () => {
    expect(blendOver('#000000', '#FFFFFF', 0)).toBe('#FFFFFF')
    expect(blendOver('#000000', '#FFFFFF', 1)).toBe('#000000')
  })

  it('相对亮度：纯白 1、纯黑 0', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5)
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
  })
})

describe('normalizeAppearance 归一化', () => {
  it('空值回落到默认设置', () => {
    expect(normalizeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE)
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE)
    expect(normalizeAppearance('垃圾')).toEqual(DEFAULT_APPEARANCE)
  })

  it('非法配色/主体/字体逐项回落，合法项保留', () => {
    const out = normalizeAppearance({ palette: 'p9', subject: 'px-grid', font: 'comic', baseFontSize: 40 })
    expect(out.palette).toBe(DEFAULT_APPEARANCE.palette)
    expect(out.subject).toBe('px-grid')
    expect(out.font).toBe(DEFAULT_APPEARANCE.font)
    expect(out.baseFontSize).toBe(FONT_SIZE_MAX)
  })

  it('字号夹在可调范围内，小数取整', () => {
    expect(normalizeAppearance({ baseFontSize: 9 }).baseFontSize).toBe(FONT_SIZE_MIN)
    expect(normalizeAppearance({ baseFontSize: 15.6 }).baseFontSize).toBe(16)
  })

  it('照片元数据缺 key 时视为没有照片', () => {
    expect(normalizeAppearance({ photo: { width: 10 } }).photo).toBeNull()
  })

  it('照片元数据合法时保留，缺失字段取安全默认', () => {
    const out = normalizeAppearance({ photo: { key: 'background', luma: 0.9 } })
    expect(out.photo?.key).toBe('background')
    expect(out.photo?.blur).toBe(0)
    expect(out.photo?.focusX).toBe(50)
    expect(out.photo?.focusY).toBe(50)
  })
})

describe('textScaleFor 字阶等比', () => {
  it('默认 16px 时与 tokens.css 现状一致', () => {
    expect(textScaleFor(16)).toEqual({ xs: 12, sm: 14, base: 16, lg: 24, xl: 32, '2xl': 48 })
  })

  it('放大到 20px 时标题同步放大且全部为整数', () => {
    const s = textScaleFor(20)
    expect(s.base).toBe(20)
    expect(s.lg).toBe(30)
    expect(s['2xl']).toBe(60)
    for (const v of Object.values(s)) expect(Number.isInteger(v)).toBe(true)
  })

  it('超出范围时夹紧', () => {
    expect(textScaleFor(99).base).toBe(FONT_SIZE_MAX)
    expect(textScaleFor(-1).base).toBe(FONT_SIZE_MIN)
  })
})

describe('resolveAppearance 派生视图', () => {
  it('照片生效时内置主体让位为 px-none', () => {
    const resolved = resolveAppearance({
      ...DEFAULT_APPEARANCE,
      subject: 'px-grid',
      photo: {
        key: 'background',
        width: 2000,
        height: 1200,
        luma: 0.7,
        scrim: 0.62,
        contrast: 5.1,
        blur: 2,
        strength: 1,
        focusX: 50,
        focusY: 50,
        createdAt: '2026-10-31T00:00:00.000Z',
      },
      photoEnabled: true,
    })
    expect(resolved.photoActive).toBe(true)
    expect(resolved.effectiveSubject).toBe('px-none')
    expect(resolved.scrim.worstContrast).toBeGreaterThanOrEqual(4.5)
  })

  it('关掉照片开关后主体恢复', () => {
    const resolved = resolveAppearance({
      ...DEFAULT_APPEARANCE,
      subject: 'px-halftone',
      photo: {
        key: 'background',
        width: 1000,
        height: 1000,
        luma: 0.5,
        scrim: 0.6,
        contrast: 5,
        blur: 0,
        strength: 1,
        focusX: 50,
        focusY: 50,
        createdAt: '2026-10-31T00:00:00.000Z',
      },
      photoEnabled: false,
    })
    expect(resolved.photoActive).toBe(false)
    expect(resolved.effectiveSubject).toBe('px-halftone')
  })

  it('四套配色的中性亮度压暗都达到 AA', () => {
    for (const p of PALETTES) {
      const resolved = resolveAppearance({ ...DEFAULT_APPEARANCE, palette: p.id })
      expect(resolved.scrim.worstContrast).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('目录完整性', () => {
  it('内置主体里保留了「像素星空」这个现有主体', () => {
    expect(SUBJECTS[0]?.id).toBe('px-stars')
  })

  it('四套经典配色 + 自动共 5 项，且只有 P2 是浅底', () => {
    expect(PALETTES).toHaveLength(5)
    expect(PALETTES.filter((p) => p.scheme === 'light').map((p) => p.id)).toEqual(['p2'])
  })
})

describe('字号档位', () => {
  it('像素体只给整数倍/既有令牌档位', () => {
    expect(fontSizeLevels(true, { min: 12, max: 24 })).toEqual([12, 14, 16, 24])
  })

  it('非像素体逐 1px 覆盖范围', () => {
    expect(fontSizeLevels(false, { min: 15, max: 18 })).toEqual([15, 16, 17, 18])
  })

  it('最近档位下标：越界值也能定位到端点', () => {
    const levels = [12, 14, 16, 24]
    expect(nearestLevelIndex(levels, 16)).toBe(2)
    expect(nearestLevelIndex(levels, 30)).toBe(3)
    expect(nearestLevelIndex(levels, 5)).toBe(0)
  })
})
