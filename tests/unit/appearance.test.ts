/**
 * 外观域模型单测（规格：docs/视觉规格-背景系统与字体体系.md）。
 *
 * 重点覆盖三件「错了会静默坏事」的逻辑：
 *  1. 压暗查表 —— 任何亮度的照片，正文对比度都必须 ≥4.5:1
 *  2. 设置归一化 —— 被手改坏/旧版本的 localStorage 不能把页面带到非法状态
 *  3. 字阶等比 —— 放大正文字号后，标题必须同步放大且保持整数
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DEFAULT_APPEARANCE,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  PALETTES,
  SUBJECTS,
  SUBJECT_IDS,
  blendOver,
  contrastRatio,
  normalizeAppearance,
  relativeLuminance,
  resolveAppearance,
  scrimPlan,
  subjectOf,
  textScaleFor,
  type PaletteId,
  type SubjectId,
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
    const out = normalizeAppearance({
      palette: 'p9',
      subject: 'px-colorbar',
      font: 'comic',
      baseFontSize: 40,
    })
    expect(out.palette).toBe(DEFAULT_APPEARANCE.palette)
    expect(out.subject).toBe('px-colorbar')
    expect(out.font).toBe(DEFAULT_APPEARANCE.font)
    expect(out.baseFontSize).toBe(FONT_SIZE_MAX)
  })

  it('已删除的旧主体 id 归一化到 px-none（保留「极简」偏好，不回落星空）', () => {
    for (const legacy of ['px-grid', 'px-halftone', 'px-scanline']) {
      expect(normalizeAppearance({ subject: legacy }).subject).toBe('px-none')
      expect(subjectOf(legacy as SubjectId).id).toBe('px-none')
    }
    // 真正非法的值仍然回落默认（星空）
    expect(normalizeAppearance({ subject: 'px-nope' }).subject).toBe(DEFAULT_APPEARANCE.subject)
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
  it('默认 16px 时与 tokens.css 现状一致（含首页 Hero 72px）', () => {
    expect(textScaleFor(16)).toEqual({ xs: 12, sm: 14, base: 16, lg: 24, xl: 36, '2xl': 48, hero: 72 })
  })

  it('放大到 20px 时标题同步放大且全部为整数', () => {
    const s = textScaleFor(20)
    expect(s.base).toBe(20)
    expect(s.lg).toBe(30)
    expect(s.xl).toBe(45)
    expect(s['2xl']).toBe(60)
    // Hero 单独夹在 48–72：不跟着 48/16 的比例涨到 90
    expect(s.hero).toBe(72)
    for (const v of Object.values(s)) expect(Number.isInteger(v)).toBe(true)
  })

  it('首页 Hero 档位：整数、12 的整数倍、夹在 48–72', () => {
    for (let base = FONT_SIZE_MIN; base <= FONT_SIZE_MAX; base++) {
      const hero = textScaleFor(base).hero
      expect(Number.isInteger(hero)).toBe(true)
      expect(hero % 12).toBe(0)
      expect(hero).toBeGreaterThanOrEqual(48)
      expect(hero).toBeLessThanOrEqual(72)
    }
    // 最小正文（12px）退到 60px，仍然 ≥48 且是 24 的倍数
    expect(textScaleFor(12).hero).toBe(60)
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
      subject: 'px-viewfinder',
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
      subject: 'px-sprocket',
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
    expect(resolved.effectiveSubject).toBe('px-sprocket')
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

  it('主体目录共 7 项，顺序与重设计方案 §6.1 完全一致', () => {
    expect(SUBJECTS).toHaveLength(7)
    expect(SUBJECT_IDS).toEqual([
      'px-stars',
      'px-viewfinder',
      'px-sprocket',
      'px-aperture',
      'px-colorbar',
      'px-hatch',
      'px-none',
    ])
  })

  it('三套被替换的旧主体 id 已不在目录里', () => {
    for (const legacy of ['px-grid', 'px-halftone', 'px-scanline']) {
      expect(SUBJECT_IDS).not.toContain(legacy)
    }
  })

  it('只有像素星空走 canvas，其余 6 套都是 CSS 绘制', () => {
    expect(SUBJECTS.filter((s) => s.canvas).map((s) => s.id)).toEqual(['px-stars'])
    expect(SUBJECTS.filter((s) => !s.canvas)).toHaveLength(6)
  })

  it('每套主体都有非空的名字与描述（选择页直接把这两项渲染给用户）', () => {
    for (const s of SUBJECTS) {
      expect(s.name.length).toBeGreaterThan(0)
      expect(s.description.length).toBeGreaterThan(0)
    }
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

/* ─────────────────────────── 主体取色阶梯 ─────────────────────────── */

/**
 * 直接从 CSS 源文件读令牌值，而不是在测试里抄一份常量。
 * 理由：方案文档 §3.2 的表是「实测值」，抄进测试就变成「再抄一遍」——
 * CSS 改坏时测试照样绿。这里读的是真正生效的那份声明。
 */
function cssBlocks(css: string): Array<{ selector: string; decls: Map<string, string> }> {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Array<{ selector: string; decls: Map<string, string> }> = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(clean))) {
    const decls = new Map<string, string>()
    for (const d of (m[2] ?? '').split(';')) {
      const i = d.indexOf(':')
      if (i < 0) continue
      decls.set(d.slice(0, i).trim(), d.slice(i + 1).trim())
    }
    out.push({ selector: (m[1] ?? '').trim().replace(/\s+/g, ' '), decls })
  }
  return out
}

function readStyle(rel: string): string {
  // 不能用 import.meta.url：vitest 的 jsdom 环境把它重写成 http://localhost:3000/...，
  // new URL(...) 于是得到 http URL，readFileSync 拿不到字节（抛 ERR_INVALID_URL_SCHEME
  // 或静默返回空串）。vitest 的 cwd 始终是项目根（配置文件所在目录），用它最稳。
  const abs = resolve(process.cwd(), 'src', 'styles', rel)
  if (!existsSync(abs)) throw new Error(`读不到样式文件：${abs}（cwd=${process.cwd()}）`)
  return readFileSync(abs, 'utf8')
}

interface TokenSet {
  label: string
  bg: string
  faint: string
  mid: string
  strong: string
  accent: string
}

function tokensOf(): TokenSet[] {
  const blocks = [...cssBlocks(readStyle('tokens.css')), ...cssBlocks(readStyle('appearance.css'))]
  const pick = (match: (sel: string) => boolean, label: string): TokenSet => {
    const block = blocks.find((b) => b.decls.has('--g-subj-faint') && match(b.selector))
    if (!block) throw new Error(`找不到 ${label} 的 --g-subj-* 令牌块`)
    const get = (k: string): string => block.decls.get(k) ?? ''
    return {
      label,
      bg: get('--g-bg'),
      faint: get('--g-subj-faint'),
      mid: get('--g-subj-mid'),
      strong: get('--g-subj-strong'),
      accent: get('--g-subj-accent'),
    }
  }
  // 用 PaletteId 约束这里的清单：将来增删配色时，漏改这张表会编译报错
  const palettes = ['p1', 'p2', 'p3', 'p4'] as const satisfies readonly PaletteId[]
  return [
    pick((s) => s.startsWith(':root'), 'tokens.css :root（auto·浅）'),
    pick((s) => s.includes("[data-theme='dark']"), 'tokens.css [data-theme=dark]（auto·深）'),
    ...palettes.map((p) => pick((s) => s.includes(`[data-palette='${p}']`), `appearance.css ${p}`)),
  ]
}

/** 方案 §3.2 给出的各档对比度区间（留一点浮点/取整余量） */
const TOKEN_RANGES = {
  faint: [1.15, 1.35],
  mid: [1.65, 1.95],
  strong: [2.6, 3.0],
  accent: [5.0, 11.0],
} as const

describe('主体取色阶梯（--g-subj-*）', () => {
  const sets = tokensOf()

  it('6 套配色环境（auto 明/暗 + P1–P4）各有一套完整令牌', () => {
    expect(sets).toHaveLength(6)
    for (const t of sets) {
      for (const v of [t.bg, t.faint, t.mid, t.strong, t.accent]) {
        expect(v).toMatch(/^#[0-9a-fA-F]{6}$/)
      }
    }
  })

  it('四档对配色的对比度都落在方案 §3.2 的区间内', () => {
    for (const t of sets) {
      for (const key of ['faint', 'mid', 'strong', 'accent'] as const) {
        const [lo, hi] = TOKEN_RANGES[key]
        const c = contrastRatio(t[key], t.bg)
        expect(c, `${t.label} ${key} = ${t[key]} vs ${t.bg}`).toBeGreaterThanOrEqual(lo)
        expect(c, `${t.label} ${key} = ${t[key]} vs ${t.bg}`).toBeLessThanOrEqual(hi)
      }
    }
  })

  it('阶梯单调：faint < mid < strong < accent（对底色）', () => {
    for (const t of sets) {
      const f = contrastRatio(t.faint, t.bg)
      const m = contrastRatio(t.mid, t.bg)
      const s = contrastRatio(t.strong, t.bg)
      const a = contrastRatio(t.accent, t.bg)
      expect(f).toBeLessThan(m)
      expect(m).toBeLessThan(s)
      expect(s).toBeLessThan(a)
    }
  })

  it('结构线最高档 < 3:1（不越过装饰边界，规格 §2.6）', () => {
    for (const t of sets) {
      expect(contrastRatio(t.strong, t.bg)).toBeLessThan(3)
    }
  })

  it('走廊内（主体 × 0.22 叠底色）透出对比度 ≤1.25:1 —— 只对 faint/mid/strong 成立', () => {
    // 走廊外的 accent 是允许超标的（方案 §4.2 已明确），所以只锁三档。
    for (const t of sets) {
      for (const key of ['faint', 'mid', 'strong'] as const) {
        const composite = blendOver(t[key], t.bg, 0.22)
        expect(contrastRatio(composite, t.bg), `${t.label} ${key}`).toBeLessThanOrEqual(1.25)
      }
    }
  })
})
