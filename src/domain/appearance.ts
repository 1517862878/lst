/**
 * 外观域模型（FRONTEND-WORK 扩展：背景系统与字体体系）。
 *
 * 设计来源：`docs/视觉规格-背景系统与字体体系.md`（下称「规格」）。
 * 三条硬约束（勿推翻）：
 *  1. 像素风基线：零圆角 / 2px 硬描边 / 实心偏移阴影 / 12px 整数倍字阶。
 *     四套配色「只在色相上分化」，不引入圆角或柔阴影。
 *  2. 四套配色 + 现有明暗主题 = 两个正交维度。`palette: 'auto'` 表示沿用
 *     现有 light/dark 令牌（现状不变），p1–p4 才覆盖为规格 §2 的实测值。
 *  3. 背景照片的遮罩强度由「采样亮度 → 查表 → 自动压暗」决定（规格 §3.4），
 *     不写死一个 alpha —— 否则雪景/逆光照片正文不可读。
 */

/* ─────────────────────────── 基础标识 ─────────────────────────── */

/** 配色：auto 沿用明暗主题，p1–p4 = 规格 §2 的四套经典配色 */
export type PaletteId = 'auto' | 'p1' | 'p2' | 'p3' | 'p4'

/** 内置主体（「现在的主体」= 像素星空，作为内置主体之一保留） */
export type SubjectId = 'px-stars' | 'px-grid' | 'px-halftone' | 'px-scanline' | 'px-none'

/** 字体搭配方案（规格 §4.2 的 T1–T4，全部 OFL-1.1 可商用） */
export type FontId = 'pixel' | 'pixel-sans' | 'serif' | 'sans'

/** 配色底的明暗属性：决定背景照片走「压暗」还是「提亮」策略 */
export type PaletteScheme = 'dark' | 'light'

/* ─────────────────────────── 配色目录 ─────────────────────────── */

export interface PaletteOption {
  id: PaletteId
  name: string
  /** 一句话定位，用于选项副标题 */
  tagline: string
  scheme: PaletteScheme
  /** 卡片预览色块：底 / 面 / 主色 / 点缀 / 文字，取规格 §2 实测值 */
  preview: { bg: string; surface: string; brand: string; accent: string; ink: string }
}

export const PALETTES: readonly PaletteOption[] = [
  {
    id: 'auto',
    name: '自动（跟随明暗主题）',
    tagline: '现状：浅色 #1b2a45 / 深色 #070b14，随系统与主题切换',
    scheme: 'dark',
    preview: { bg: '#1b2a45', surface: '#27364f', brand: '#ffb347', accent: '#5ac8fa', ink: '#f2f5fb' },
  },
  {
    id: 'p1',
    name: 'P1 星夜蓝',
    tagline: 'Starry Night · 全站默认，夜景/星空题材最佳衬底',
    scheme: 'dark',
    preview: { bg: '#12203A', surface: '#1C2E4E', brand: '#F0C070', accent: '#FF7A59', ink: '#F2F5FB' },
  },
  {
    id: 'p2',
    name: 'P2 米白纸面',
    tagline: 'Paper Day · 唯一浅底，适合长文阅读与日间强光',
    scheme: 'light',
    preview: { bg: '#F7F3E9', surface: '#FFFDF7', brand: '#1F3D63', accent: '#BB3826', ink: '#1A1611' },
  },
  {
    id: 'p3',
    name: 'P3 墨绿胶片',
    tagline: 'Kodak Green · 风光/纪实，老胶片调性',
    scheme: 'dark',
    preview: { bg: '#0F1F1A', surface: '#162C24', brand: '#E9C46A', accent: '#E76F51', ink: '#EDF3EE' },
  },
  {
    id: 'p4',
    name: 'P4 碳灰霓虹',
    tagline: 'Carbon Neon · 夜间模式/榜单页，霓虹只作点缀',
    scheme: 'dark',
    preview: { bg: '#121214', surface: '#1B1B1F', brand: '#5AA9FF', accent: '#FF5C8A', ink: '#F4F4F6' },
  },
]

export const PALETTE_IDS: readonly PaletteId[] = PALETTES.map((p) => p.id)

export function paletteOf(id: PaletteId): PaletteOption {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0]!
}

/* ─────────────────────────── 主体目录 ─────────────────────────── */

export interface SubjectOption {
  id: SubjectId
  name: string
  description: string
  /** 主体层是否需要 canvas 绘制（星空是 canvas，其余是 CSS 层） */
  canvas: boolean
}

export const SUBJECTS: readonly SubjectOption[] = [
  {
    id: 'px-stars',
    name: '像素星空（当前主体）',
    description: '把现有星空确立为内置主体 #1：像素星点 + 银河径向渐变，密度随视口自适应。',
    canvas: true,
  },
  {
    id: 'px-grid',
    name: '像素网格',
    description: '8px 方格网 + 极淡对角线，最接近地图编辑器的原始质感。',
    canvas: false,
  },
  {
    id: 'px-halftone',
    name: '像素网点',
    description: '45° 半调网点，向下逐渐加密，像印刷制版。',
    canvas: false,
  },
  {
    id: 'px-scanline',
    name: '像素扫描线',
    description: 'CRT 横向扫描线 + 顶部微光带，复古显示器质感。',
    canvas: false,
  },
  {
    id: 'px-none',
    name: '纯净无主体',
    description: '只留配色底与硬边。用于长文阅读、投屏与省电场景。',
    canvas: false,
  },
]

export const SUBJECT_IDS: readonly SubjectId[] = SUBJECTS.map((s) => s.id)

export function subjectOf(id: SubjectId): SubjectOption {
  return SUBJECTS.find((s) => s.id === id) ?? SUBJECTS[0]!
}

/* ─────────────────────────── 字体目录 ─────────────────────────── */

export interface FontOption {
  id: FontId
  name: string
  /** 方案代号（对应规格 §4.2 的 T1–T4） */
  code: string
  description: string
  /** 是否要求字号走 12 的整数倍（像素体需要，黑体/衬线不需要） */
  integerMultiple: boolean
  /** 正文可调范围（规格 §4.2 给出的各方案区间） */
  range: { min: number; max: number }
  /** 预览用 CSS 字体栈，与 appearance.css 的 [data-font] 规则保持一致 */
  previewFamily: string
}

export const FONTS: readonly FontOption[] = [
  {
    id: 'pixel',
    name: '像素原味',
    code: 'T1',
    description: '标题与正文都用 Fusion Pixel（项目自带 woff2，OFL-1.1）。风格最强，长文偏累。',
    integerMultiple: true,
    range: { min: 12, max: 24 },
    previewFamily: "'Fusion Pixel', 'Courier New', monospace",
  },
  {
    id: 'pixel-sans',
    name: '像素标题 + 黑体正文',
    code: 'T2',
    description: '标题保留像素体保品牌调性，正文换思源黑/苹方，长文可读性最好。内容站推荐。',
    integerMultiple: false,
    range: { min: 15, max: 18 },
    previewFamily: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
  },
  {
    id: 'serif',
    name: '黑白衬线',
    code: 'T3',
    description: '标题与正文都用思源宋/宋体，编辑气质。用于文章页与法律条款，不用在作品墙。',
    integerMultiple: false,
    range: { min: 16, max: 19 },
    previewFamily: "'Noto Serif SC', 'Songti SC', 'SimSun', Georgia, serif",
  },
  {
    id: 'sans',
    name: '现代无衬线',
    code: 'T4',
    description: 'Inter + 系统中文字体，克制中性。用于设置/后台类页面，首页会丢品牌个性。',
    integerMultiple: false,
    range: { min: 14, max: 17 },
    previewFamily: "Inter, system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  },
]

export const FONT_IDS: readonly FontId[] = FONTS.map((f) => f.id)

export function fontOf(id: FontId): FontOption {
  return FONTS.find((f) => f.id === id) ?? FONTS[0]!
}

/* ─────────────────────────── 背景照片 ─────────────────────────── */

/** 背景照片的元数据（localStorage）。图片二进制另存 IndexedDB（gy-appearance/photos）。 */
export interface BackgroundPhoto {
  /** IndexedDB 主键，固定 'background'，保留字段以便将来多图轮播 */
  key: string
  width: number
  height: number
  /** 文字安全区加权相对亮度 0–1（规格 §3.4 算法第 2 步） */
  luma: number
  /** 实际生效的压暗/提亮层不透明度（auto 计算，不允许用户直接改） */
  scrim: number
  /** 压暗后「纯白照片」最坏情况的实测对比度（对 --g-ink 而言） */
  contrast: number
  /** 用户可调：氛围模糊 0–20px（规格 §3.2 的 B0–B3） */
  blur: number
  /**
   * 用户可调：遮罩强度系数。1 = 规格默认（保证 AA），越小照片越透。
   * 只影响观感，对比度的真实后果由 scrimPlan 实时算给 UI 看。
   */
  strength: number
  /** 焦点（object-position 百分比），默认 50/50 */
  focusX: number
  focusY: number
  createdAt: string
}

/** 上传约束（规格 §3.1）：短边 < 1080 或长边 < 1280 直接拒绝 */
export const BG_PHOTO_LIMITS = {
  /** 原图字节上限（压缩前） */
  maxBytes: 15 * 1024 * 1024,
  /** 被拒的最小长边 */
  minLongEdge: 1280,
  /** 压缩目标长边（规格推荐 2560，存储取 2160 折中，控 IndexedDB 体积） */
  targetLongEdge: 2160,
  /** 宽高比上限（>3:1 或 <1:3 拒绝） */
  maxAspect: 3,
  /** 模糊可调上限（移动端规格上限 8px，但用户显式选择时放开到 20） */
  maxBlur: 20,
  /** 背景照片在 IndexedDB 的库名 / store 名 / 主键 */
  dbName: 'gy-appearance',
  storeName: 'photos',
  key: 'background',
} as const

export const BACKGROUND_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const

/* ─────────────────────────── 外观设置 ─────────────────────────── */

export interface AppearanceSettings {
  palette: PaletteId
  subject: SubjectId
  font: FontId
  /** 正文字号 px（以 --g-text-base 为基准，其余字阶等比推导） */
  baseFontSize: number
  /** 背景照片元数据；null 表示未上传或已删除 */
  photo: BackgroundPhoto | null
  /** 照片开关（保留照片但临时不用 = 回落到内置主体） */
  photoEnabled: boolean
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  palette: 'auto',
  subject: 'px-stars',
  font: 'pixel',
  baseFontSize: 16,
  photo: null,
  photoEnabled: true,
}

/** 字号硬边界：绝对不允许超出的范围（各字体在 FontOption.range 里再收窄） */
export const FONT_SIZE_MIN = 12
export const FONT_SIZE_MAX = 24

/* ─────────────────────────── 字阶推导 ─────────────────────────── */

/**
 * 以正文为基准等比推导其余字阶。
 * 比例沿用 tokens.css 的现状（12/14/16/24/32/48），保证放大后节奏不变。
 */
export function textScaleFor(base: number) {
  const b = clampInt(base, FONT_SIZE_MIN, FONT_SIZE_MAX)
  return {
    xs: Math.round((b * 12) / 16),
    sm: Math.round((b * 14) / 16),
    base: b,
    lg: Math.round((b * 24) / 16),
    xl: Math.round((b * 32) / 16),
    '2xl': Math.round((b * 48) / 16),
  }
}

/* ─────────────────────────── 遮罩/压暗 ─────────────────────────── */

/** 压暗层颜色（规格 §3.3 ①）：夜空蓝，比纯黑更有摄影感 */
export const SCRIM_DARK = '#0B1526'
/** 浅色方案提亮层颜色（规格 §3.4 查找表 C） */
export const SCRIM_LIGHT = '#F7F3E9'
/** 深色方案的正文色（取最亮 ink，保证最坏情况可读） */
const INK_DARK = '#FFFFFF'
/** 浅色方案的正文色 */
const INK_LIGHT = '#1A1611'

/** 方向渐变的六个锚点（规格 §3.3 ②，纯白照片上实测最低 5.14:1） */
const GRADIENT_ANCHOR_ALPHAS = [0.84, 0.7, 0.62, 0.62, 0.68, 0.86] as const
/** 渐变在竖直方向的位置，与上面六个 alpha 一一对应 */
export const GRADIENT_ANCHOR_STOPS = [0, 18, 40, 62, 82, 100] as const

export interface ScrimPlan {
  /** 压暗/提亮层颜色 */
  color: string
  /** 六个锚点的实际 alpha（已按采样亮度自动加档） */
  alphas: readonly number[]
  /** 与渐变叠出的最坏情况对比度（对纯白照片） */
  worstContrast: number
  /** 自动加档的档位，给 UI 显示用 */
  boost: number
  /** 浅色方案下照片过暗：规格要求改「实色面板承字」而非无限提亮 */
  needsPanel: boolean
}

function boostForLuma(luma: number): number {
  if (luma >= 0.75) return 0.06
  if (luma >= 0.55) return 0.03
  return 0
}

/**
 * 采样亮度 → 压暗方案（规格 §3.3 + §3.4 简化落地）。
 *
 * 深色方案：以规格给的方向渐变为基准（它本身已保证纯白照片 5.14:1），
 * 只在照片偏亮（L≥0.55）时整体加档 —— 单调且不会把暗照片压得更黑。
 *
 * 浅色方案：走查找表 C 的等效策略。照片过暗（L<0.35）时不做无上限提亮，
 * 返回 needsPanel=true，由 UI 提示改用实色面板承字（规格 §3.4 的硬边界）。
 */
export function scrimPlan(luma: number, scheme: PaletteScheme, strength = 1): ScrimPlan {
  const L = Number.isFinite(luma) ? Math.min(1, Math.max(0, luma)) : 0.5
  // strength 缩放锚点 alpha：1 = 规格默认（保证 AA），<1 = 照片更透（用户主动选择），>1 = 更暗
  const k = Number.isFinite(strength) ? Math.min(1.4, Math.max(0, strength)) : 1

  if (scheme === 'light') {
    // 查找表 C：亮度越低，提亮越少（提亮到 0.55 已让照片变白纸，失去背景意义）
    const alpha = L >= 0.3 ? 0 : L >= 0.2 ? 0.05 : L >= 0.1 ? 0.26 : 0.55
    const flat = tuple6(alpha)
    return {
      color: SCRIM_LIGHT,
      alphas: flat.map((a) => round3(Math.min(0.9, a * k))),
      worstContrast: minContrast(SCRIM_LIGHT, INK_LIGHT, flat.map((a) => round3(Math.min(0.9, a * k)))),
      boost: 0,
      needsPanel: L < 0.35,
    }
  }

  const boost = boostForLuma(L)
  const alphas = GRADIENT_ANCHOR_ALPHAS.map((a) =>
    round3(Math.min(0.94, Math.max(0, (a + boost) * (k === 1 ? 1 : k)))),
  )
  return {
    color: SCRIM_DARK,
    alphas,
    worstContrast: minContrast(SCRIM_DARK, INK_DARK, alphas),
    boost,
    needsPanel: false,
  }
}

function tuple6(v: number): readonly number[] {
  return [v, v, v, v, v, v]
}

function minContrast(scrim: string, ink: string, alphas: readonly number[]): number {
  let worst = Infinity
  for (const a of alphas) {
    // 最坏情况：照片是纯白，压暗层叠上去后的合成色
    const composite = blendOver(scrim, '#FFFFFF', a)
    worst = Math.min(worst, contrastRatio(ink, composite))
  }
  return round2(worst === Infinity ? 21 : worst)
}

/** 把 scrim 以 alpha 叠在 base 之上，返回合成色（sRGB 线性外直接加权，够用于可读性评估） */
export function blendOver(top: string, base: string, alpha: number): string {
  const t = hexToRgb(top)
  const b = hexToRgb(base)
  const r = Math.round(t.r * alpha + b.r * (1 - alpha))
  const g = Math.round(t.g * alpha + b.g * (1 - alpha))
  const bl = Math.round(t.b * alpha + b.b * (1 - alpha))
  return rgbToHex(r, g, bl)
}

/** WCAG 2.1 相对亮度 */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  const [rl, gl, bl] = [r, g, b].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl
}

/** WCAG 2.1 对比度，1–21 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '').trim()
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  const n = Number.parseInt(full.slice(0, 6), 16)
  if (!Number.isFinite(n)) return { r: 0, g: 0, b: 0 }
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) => clampInt(v, 0, 255).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase()
}

/* ─────────────────────────── 校验/归一化 ─────────────────────────── */

export function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min
  return Math.min(max, Math.max(min, Math.round(v)))
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

/** 把任意来源（localStorage / 用户输入）归一化成合法设置，非法字段逐项回落 */
export function normalizeAppearance(raw: unknown): AppearanceSettings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const palette = PALETTE_IDS.includes(src.palette as PaletteId) ? (src.palette as PaletteId) : DEFAULT_APPEARANCE.palette
  const subject = SUBJECT_IDS.includes(src.subject as SubjectId)
    ? (src.subject as SubjectId)
    : DEFAULT_APPEARANCE.subject
  const font = FONT_IDS.includes(src.font as FontId) ? (src.font as FontId) : DEFAULT_APPEARANCE.font
  // 字号先按「该字体自己的可调区间」夹紧：像素体只允许 12/14/16/24，黑体是 15–18 …
  const fontRange = fontOf(font).range
  const lo = Math.max(fontRange.min, FONT_SIZE_MIN)
  const hi = Math.min(fontRange.max, FONT_SIZE_MAX)
  // 缺省不是「夹到下限」而是「回默认 16px」：旧数据没有这个字段时不能被悄悄改成最小字号
  const rawSize = Number(src.baseFontSize)
  const baseFontSize = clampInt(Number.isFinite(rawSize) ? rawSize : DEFAULT_APPEARANCE.baseFontSize, lo, hi)

  return {
    palette,
    subject,
    font,
    baseFontSize,
    photo: normalizePhoto(src.photo),
    photoEnabled: typeof src.photoEnabled === 'boolean' ? src.photoEnabled : true,
  }
}

function normalizePhoto(raw: unknown): BackgroundPhoto | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  if (typeof p.key !== 'string' || !p.key) return null
  const luma = clampFloat(Number(p.luma), 0, 1, 0.5)
  // 压暗计划是按「当前配色方案」推的，配色在渲染时才知道；这里只做兜底归一化
  const plan = scrimPlan(luma, 'dark')
  return {
    key: p.key,
    width: clampInt(Number(p.width), 1, 20000),
    height: clampInt(Number(p.height), 1, 20000),
    luma,
    scrim: clampFloat(Number(p.scrim), 0, 1, plan.alphas[2] ?? 0.62),
    contrast: Number.isFinite(Number(p.contrast)) ? clampFloat(Number(p.contrast), 1, 21, plan.worstContrast) : plan.worstContrast,
    blur: clampInt(Number(p.blur), 0, BG_PHOTO_LIMITS.maxBlur),
    strength: clampFloat(Number(p.strength), 0.4, 1.4, 1),
    focusX: clampInt(Number(p.focusX), 0, 100) || 50,
    focusY: clampInt(Number(p.focusY), 0, 100) || 50,
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString(),
  }
}

function clampFloat(v: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, v))
}

/* ─────────────────────────── 汇总视图 ─────────────────────────── */

/** 页面与背景层共用的派生视图：照片是否真的在生效、当前压暗计划是什么 */
export interface ResolvedAppearance {
  settings: AppearanceSettings
  palette: PaletteOption
  scheme: PaletteScheme
  /** 照片实际生效（有元数据 + 开关打开） */
  photoActive: boolean
  /** 生效的内置主体（照片生效时主体让位，主体层不渲染） */
  effectiveSubject: SubjectId
  scrim: ScrimPlan
  scale: ReturnType<typeof textScaleFor>
}

export function resolveAppearance(settings: AppearanceSettings): ResolvedAppearance {
  const palette = paletteOf(settings.palette)
  const photoActive = Boolean(settings.photo) && settings.photoEnabled
  return {
    settings,
    palette,
    scheme: palette.scheme,
    photoActive,
    effectiveSubject: photoActive ? 'px-none' : settings.subject,
    scrim: scrimPlan(settings.photo?.luma ?? 0.5, palette.scheme, settings.photo?.strength ?? 1),
    scale: textScaleFor(settings.baseFontSize),
  }
}
