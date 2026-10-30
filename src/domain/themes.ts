/**
 * 每周主题与活动（8.4d）的纯函数。
 *
 * 这里只放**与数据源无关**的规则与文案：上限常量、slug 形状、草稿校验、
 * 倒计时/档期文案、列表分档。api 与 mock 两套仓储共用同一份校验，
 * 页面与单测也读同一份 —— 规则写三遍就会出现「前端放行、后端 400」。
 */
import type { ThemeDetail, ThemeStatus, ThemeSummary } from './types'

/** slug 形状（与数据库 `ck_photo_themes_slug_format` 逐字一致） */
export const THEME_SLUG_RE = /^[a-z0-9-]{2,40}$/

export const THEME_TITLE_MAX = 40
export const THEME_DESCRIPTION_MAX = 300
export const THEME_RULES_MAX = 1000
export const THEME_RESULT_NOTE_MAX = 500
export const THEME_ENTRY_NOTE_MAX = 200

/** 每人每个主题最多投稿的件数（与数据库 `c_max_entries_per_author` 一致） */
export const MAX_ENTRIES_PER_AUTHOR = 3

/** 详情页投稿网格每页条数（与后端默认值一致） */
export const THEME_ENTRY_PAGE_SIZE = 24

/** 一个主题在公开列表里属于哪一档 */
export type ThemeBucket = 'active' | 'upcoming' | 'past'

/** 后台「新建/编辑」表单的可提交字段（已 trim） */
export interface ThemeDraft {
  slug: string
  title: string
  description: string
  rules: string
  status: ThemeStatus
  startsAt: string
  endsAt: string
  resultNote: string
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `datetime-local` 输入框的值（本地时间，不带时区） */
export function toDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** `datetime-local` 的值 → ISO；空值/非法值返回空串，交给校验报错 */
export function fromDateTimeLocal(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString()
}

/** 日期（YYYY-MM-DD，本地时区），档期文案用 */
export function formatThemeDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 档期文案：「2026-10-28 至 2026-11-04」 */
export function themeWindowText(startsAt: string, endsAt: string): string {
  const from = formatThemeDate(startsAt)
  const to = formatThemeDate(endsAt)
  if (!from || !to) return ''
  return `${from} 至 ${to}`
}

/**
 * 主题此刻是否开放投稿。
 *
 * 与数据库 `is_open` 同一口径：status === 'active' 且 now ∈ [startsAt, endsAt)。
 * 左闭右开：截止那一刻就关门（`ends_at` 是「最后一刻」而不是「还来得及」）。
 */
export function isThemeOpen(
  theme: Pick<ThemeSummary, 'status' | 'startsAt' | 'endsAt'>,
  now: Date = new Date(),
): boolean {
  if (theme.status !== 'active') return false
  const start = new Date(theme.startsAt).getTime()
  const end = new Date(theme.endsAt).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false
  return now.getTime() >= start && now.getTime() < end
}

/** 主题在公开列表里的分档（draft 不出现在任何公开档，返回 null） */
export function themeBucket(
  theme: Pick<ThemeSummary, 'status' | 'startsAt' | 'endsAt'>,
  now: Date = new Date(),
): ThemeBucket | null {
  if (theme.status === 'draft') return null
  const start = new Date(theme.startsAt).getTime()
  const end = new Date(theme.endsAt).getTime()
  const at = now.getTime()
  if (theme.status === 'closed') return 'past'
  if (Number.isFinite(start) && at < start) return 'upcoming'
  if (Number.isFinite(end) && at >= end) return 'past'
  return 'active'
}

/**
 * 档期状态文案（列表卡片/详情页共用）。
 * resultNote 只有详情接口才返回，所以这里用可选字段而不是 Pick<ThemeSummary>：
 * 列表卡片与详情页都要调它，两边的入参形状并不相同。
 */
export function themePhaseLabel(
  theme: { status: ThemeStatus; startsAt: string; endsAt: string; resultNote?: string },
  now: Date = new Date(),
): string {
  const bucket = themeBucket(theme, now)
  if (bucket === 'upcoming') return `${formatThemeDate(theme.startsAt)} 开始`
  if (bucket === 'active') return `征集中 · ${themeEndsText(theme.endsAt, now)}`
  return theme.resultNote ? '已公布结果' : '已结束'
}

/** 截止倒计时：「还剩 3 天 4 小时」/「还剩 20 分钟」/「已截止」 */
export function themeCountdown(endsAt: string, now: Date = new Date()): string {
  const ms = new Date(endsAt).getTime() - now.getTime()
  if (!Number.isFinite(ms)) return ''
  if (ms <= 0) return '已截止'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `还剩 ${Math.max(1, minutes)} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `还剩 ${hours} 小时 ${minutes % 60} 分`
  const days = Math.floor(hours / 24)
  return `还剩 ${days} 天 ${hours % 24} 小时`
}

/** 征集截止文案：「11-04 24:00 截止」太玄，直接说还剩多久 + 具体日期 */
export function themeEndsText(endsAt: string, now: Date = new Date()): string {
  const countdown = themeCountdown(endsAt, now)
  const date = formatThemeDate(endsAt)
  if (!date) return countdown
  return countdown === '已截止' ? `${date} 已截止` : `${countdown}（${date} 截止）`
}

/** 距开始还有多久：「3 天后开始」/「今天开始」 */
export function themeStartsIn(startsAt: string, now: Date = new Date()): string {
  const ms = new Date(startsAt).getTime() - now.getTime()
  if (!Number.isFinite(ms) || ms <= 0) return '已开始'
  const hours = Math.ceil(ms / 3_600_000)
  if (hours <= 24) return '今天开始'
  return `${Math.ceil(hours / 24)} 天后开始`
}

/**
 * 列表排序：startsAt 倒序（近的在前）。
 *
 * 用字符串比较而不是 localeCompare（8.4d 冻结契约 §6 教训 13）：ISO 8601 的
 * 字典序就是时间序，而 localeCompare 的结果依赖运行环境的 ICU 与 locale，
 * mock/api/测试会在不同机器上排出不同顺序。
 */
export function sortThemesByStartDesc<T extends { startsAt: string }>(themes: readonly T[]): T[] {
  return [...themes].sort((a, b) => (a.startsAt < b.startsAt ? 1 : a.startsAt > b.startsAt ? -1 : 0))
}

/** 把标题建议成 slug；中文标题会得到空串（前端据此提示编辑手填） */
export function suggestThemeSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/**
 * 表单校验：返回**用户可见的中文错误**（空数组 = 通过）。
 *
 * 只校验「前端能在本地判定」的东西（长度、形状、时间先后）；「同一时刻只能有一个
 * 进行中的主题」「封面必须是本主题的投稿」这类需要看库的规则留给后端 409/400，
 * 前端硬编一遍只会得到两份会漂移的规则。
 */
export function validateThemeDraft(
  draft: ThemeDraft,
  options?: { slugLocked?: boolean },
): string[] {
  const errors: string[] = []
  const title = draft.title.trim()
  if (!options?.slugLocked) {
    if (!draft.slug.trim()) errors.push('请填写 slug（网址里用的短名）')
    else if (!THEME_SLUG_RE.test(draft.slug.trim()))
      errors.push('slug 只能用 2–40 个小写字母、数字或连字符')
  }
  if (!title) errors.push('请填写主题标题')
  else if (title.length > THEME_TITLE_MAX) errors.push(`标题最多 ${THEME_TITLE_MAX} 个字`)
  if (draft.description.length > THEME_DESCRIPTION_MAX)
    errors.push(`简介最多 ${THEME_DESCRIPTION_MAX} 个字`)
  if (draft.rules.length > THEME_RULES_MAX) errors.push(`规则最多 ${THEME_RULES_MAX} 个字`)
  if (draft.resultNote.length > THEME_RESULT_NOTE_MAX)
    errors.push(`结果说明最多 ${THEME_RESULT_NOTE_MAX} 个字`)
  if (!draft.startsAt) errors.push('请选择开始时间')
  if (!draft.endsAt) errors.push('请选择结束时间')
  if (draft.startsAt && draft.endsAt) {
    const start = new Date(draft.startsAt).getTime()
    const end = new Date(draft.endsAt).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(end)) errors.push('开始/结束时间格式不正确')
    else if (end <= start) errors.push('结束时间必须晚于开始时间')
  }
  return errors
}

/** 精选徽标文案（卡片与详情页共用一处，避免两处各写一套判断） */
export function themeEntryBadge(entry: { isSelected: boolean }): string | null {
  return entry.isSelected ? '编辑精选' : null
}

/** 还能不能再投一件 */
export function canSubmitMore(myEntryCount: number): boolean {
  return myEntryCount < MAX_ENTRIES_PER_AUTHOR
}

/** 投稿上限提示文案 */
export function themeEntryLimitText(count: number): string {
  if (count >= MAX_ENTRIES_PER_AUTHOR) {
    return `每个主题最多投稿 ${MAX_ENTRIES_PER_AUTHOR} 件作品，你已投满`
  }
  return `还可以投 ${MAX_ENTRIES_PER_AUTHOR - count} 件（每个主题最多 ${MAX_ENTRIES_PER_AUTHOR} 件）`
}

/** 主题状态中文名（后台用） */
export const THEME_STATUS_LABEL: Record<ThemeStatus, string> = {
  draft: '草稿',
  active: '进行中',
  closed: '已结束',
}

/** 详情页的档期标签（比 themePhaseLabel 更适合大字标题旁） */
export function themeDetailPhase(
  theme: Pick<ThemeDetail, 'status' | 'startsAt' | 'endsAt'>,
  now: Date = new Date(),
): { kind: ThemeBucket | 'draft'; label: string } {
  const bucket = themeBucket(theme, now)
  if (!bucket) return { kind: 'draft', label: '草稿' }
  if (bucket === 'upcoming') return { kind: 'upcoming', label: `即将开始 · ${themeStartsIn(theme.startsAt, now)}` }
  if (bucket === 'active') return { kind: 'active', label: `征集中 · ${themeCountdown(theme.endsAt, now)}` }
  return { kind: 'past', label: '已结束' }
}
