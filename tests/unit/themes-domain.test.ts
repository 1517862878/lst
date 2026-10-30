/**
 * 每周主题的领域纯函数（src/domain/themes.ts，8.4d）。
 *
 * 这些函数是三处共用的唯一口径：页面（列表/详情/后台表单）、mock 仓储、以及
 * 后端对齐的校验。所以这里逐条锁住档期分档、倒计时文案、上限文案与草稿校验 ——
 * 任何一条漂移都会表现为「列表说征集中，详情说已结束」这类对不上的界面。
 *
 * 时间一律用显式的 now 传进去（函数签名都留了这个参数），不依赖真实当前时间，
 * 否则这些断言会在某些天/某些时区突然变红。
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_ENTRIES_PER_AUTHOR,
  THEME_DESCRIPTION_MAX,
  THEME_ENTRY_NOTE_MAX,
  THEME_RESULT_NOTE_MAX,
  THEME_RULES_MAX,
  THEME_SLUG_RE,
  THEME_STATUS_LABEL,
  THEME_TITLE_MAX,
  canSubmitMore,
  formatThemeDate,
  fromDateTimeLocal,
  isThemeOpen,
  sortThemesByStartDesc,
  suggestThemeSlug,
  themeBucket,
  themeCountdown,
  themeDetailPhase,
  themeEndsText,
  themeEntryBadge,
  themeEntryLimitText,
  themePhaseLabel,
  themeStartsIn,
  themeWindowText,
  toDateTimeLocal,
  validateThemeDraft,
  type ThemeDraft,
} from '@/domain/themes'
import type { ThemeStatus } from '@/domain/types'

const NOW = new Date('2026-11-04T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const around = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * DAY).toISOString()

function draft(overrides: Partial<ThemeDraft> = {}): ThemeDraft {
  return {
    slug: 'autumn-light',
    title: '秋日光线',
    description: '侧逆光',
    rules: '一人最多 3 件',
    status: 'draft',
    startsAt: around(-1),
    endsAt: around(6),
    resultNote: '',
    ...overrides,
  }
}

const theme = (status: ThemeStatus, startsAt: number, endsAt: number) => ({
  status,
  startsAt: around(startsAt),
  endsAt: around(endsAt),
})

describe('档期分档与开放投稿', () => {
  it('themeBucket：draft 不进任何公开档，closed 一律算往期', () => {
    expect(themeBucket(theme('draft', -1, 6), NOW)).toBeNull()
    expect(themeBucket(theme('closed', -1, 6), NOW)).toBe('past')
    expect(themeBucket(theme('closed', 3, 6), NOW)).toBe('past')
  })

  it('themeBucket：active 按时间落在 active / upcoming / past 三档', () => {
    expect(themeBucket(theme('active', -1, 6), NOW)).toBe('active')
    expect(themeBucket(theme('active', 3, 6), NOW)).toBe('upcoming')
    expect(themeBucket(theme('active', -6, -1), NOW)).toBe('past')
  })

  it('isThemeOpen 左闭右开：截止那一刻就关门', () => {
    const open = theme('active', -1, 6)
    expect(isThemeOpen(open, NOW)).toBe(true)
    expect(isThemeOpen(open, new Date(open.startsAt))).toBe(true)
    expect(isThemeOpen(open, new Date(open.endsAt))).toBe(false)
    // 非 active 一律不开放，哪怕时间窗盖住现在
    expect(isThemeOpen(theme('draft', -1, 6), NOW)).toBe(false)
    expect(isThemeOpen(theme('closed', -1, 6), NOW)).toBe(false)
  })

  it('时间非法时不抛错，按「不开放、不出现在公开档」处理', () => {
    const broken = { status: 'active' as ThemeStatus, startsAt: '不是时间', endsAt: '' }
    expect(isThemeOpen(broken, NOW)).toBe(false)
    expect(themeBucket(broken, NOW)).toBe('active')
  })
})

describe('文案：档期、倒计时、窗口', () => {
  it('themePhaseLabel 三种档期各有说法，往期结果公布与否也要区分', () => {
    expect(themePhaseLabel(theme('active', 3, 6), NOW)).toBe(`${formatThemeDate(around(3))} 开始`)
    expect(themePhaseLabel(theme('active', -1, 6), NOW)).toContain('征集中 · ')
    expect(themePhaseLabel(theme('closed', -6, -1), NOW)).toBe('已结束')
    expect(themePhaseLabel({ ...theme('closed', -6, -1), resultNote: '公布了' }, NOW)).toBe(
      '已公布结果',
    )
  })

  it('themeCountdown 按剩余时长换档：分钟 / 小时 / 天', () => {
    expect(themeCountdown(new Date(NOW.getTime() + 30 * 60_000).toISOString(), NOW)).toBe(
      '还剩 30 分钟',
    )
    expect(themeCountdown(new Date(NOW.getTime() + 3 * 3_600_000 + 5 * 60_000).toISOString(), NOW)).toBe(
      '还剩 3 小时 5 分',
    )
    expect(themeCountdown(around(2), NOW)).toBe('还剩 2 天 0 小时')
    expect(themeCountdown(around(-1), NOW)).toBe('已截止')
  })

  it('themeCountdown 不足 1 分钟也说「还剩 1 分钟」，不显示「还剩 0 分钟」', () => {
    expect(themeCountdown(new Date(NOW.getTime() + 20_000).toISOString(), NOW)).toBe('还剩 1 分钟')
  })

  it('themeEndsText / themeStartsIn 带上具体日期', () => {
    const date = formatThemeDate(around(6))
    expect(themeEndsText(around(6), NOW)).toBe(`还剩 6 天 0 小时（${date} 截止）`)
    expect(themeEndsText(around(-1), NOW)).toBe(`${formatThemeDate(around(-1))} 已截止`)
    expect(themeStartsIn(around(3), NOW)).toBe('3 天后开始')
    expect(themeStartsIn(around(-1), NOW)).toBe('已开始')
    expect(themeStartsIn(new Date(NOW.getTime() + 3_600_000).toISOString(), NOW)).toBe('今天开始')
  })

  it('themeWindowText 用「A 至 B」，任一端拿不到日期就返回空串', () => {
    expect(themeWindowText(around(-1), around(6))).toBe(
      `${formatThemeDate(around(-1))} 至 ${formatThemeDate(around(6))}`,
    )
    expect(themeWindowText('', around(6))).toBe('')
    expect(themeWindowText(around(-1), '不是时间')).toBe('')
  })

  it('themeDetailPhase 给出详情页标签与档位', () => {
    expect(themeDetailPhase(theme('draft', -1, 6), NOW)).toEqual({ kind: 'draft', label: '草稿' })
    expect(themeDetailPhase(theme('active', 3, 6), NOW).label).toBe('即将开始 · 3 天后开始')
    expect(themeDetailPhase(theme('active', -1, 6), NOW).label).toContain('征集中 · 还剩 6 天')
    expect(themeDetailPhase(theme('closed', -6, -1), NOW)).toEqual({ kind: 'past', label: '已结束' })
  })
})

describe('排序与 slug', () => {
  it('sortThemesByStartDesc 按 ISO 字符串倒序，且不修改入参', () => {
    const list = [{ startsAt: around(-3) }, { startsAt: around(2) }, { startsAt: around(-10) }]
    const sorted = sortThemesByStartDesc(list)
    expect(sorted.map((item) => item.startsAt)).toEqual([
      around(2),
      around(-3),
      around(-10),
    ])
    expect(list[0]?.startsAt).toBe(around(-3))
  })

  it('suggestThemeSlug 把英文标题转成 slug，中文标题给空串（让编辑手填）', () => {
    expect(suggestThemeSlug('Autumn Light 2026!')).toBe('autumn-light-2026')
    expect(suggestThemeSlug('  城市夜色  ')).toBe('')
    expect(THEME_SLUG_RE.test(suggestThemeSlug('Autumn Light'))).toBe(true)
  })

  it('toDateTimeLocal / fromDateTimeLocal 互换不丢本地时间', () => {
    const local = '2026-11-04T20:30'
    const iso = fromDateTimeLocal(local)
    expect(toDateTimeLocal(iso)).toBe(local)
    expect(toDateTimeLocal('')).toBe('')
    expect(fromDateTimeLocal('   ')).toBe('')
    expect(fromDateTimeLocal('不是时间')).toBe('')
  })
})

describe('草稿校验', () => {
  it('合规草稿没有任何错误', () => {
    expect(validateThemeDraft(draft())).toEqual([])
  })

  it('slug 缺失或形状不对会被指出，slugLocked 时跳过 slug 校验', () => {
    expect(validateThemeDraft(draft({ slug: '' }))).toContain('请填写 slug（网址里用的短名）')
    expect(validateThemeDraft(draft({ slug: '秋日' }))).toContain(
      'slug 只能用 2–40 个小写字母、数字或连字符',
    )
    expect(validateThemeDraft(draft({ slug: 'x' }))).toContain(
      'slug 只能用 2–40 个小写字母、数字或连字符',
    )
    // 编辑态：slug 不给改，也不该因为它不是合法 slug 而拦住保存
    expect(validateThemeDraft(draft({ slug: '秋日' }), { slugLocked: true })).toEqual([])
  })

  it('标题必填且有长度上限', () => {
    expect(validateThemeDraft(draft({ title: '   ' }))).toContain('请填写主题标题')
    expect(validateThemeDraft(draft({ title: 'x'.repeat(THEME_TITLE_MAX + 1) }))).toContain(
      `标题最多 ${THEME_TITLE_MAX} 个字`,
    )
    expect(validateThemeDraft(draft({ title: 'x'.repeat(THEME_TITLE_MAX) }))).toEqual([])
  })

  it('简介 / 规则 / 结果说明各自有上限，正好等于上限时放行', () => {
    expect(validateThemeDraft(draft({ description: 'x'.repeat(THEME_DESCRIPTION_MAX + 1) }))).toContain(
      `简介最多 ${THEME_DESCRIPTION_MAX} 个字`,
    )
    expect(validateThemeDraft(draft({ rules: 'x'.repeat(THEME_RULES_MAX + 1) }))).toContain(
      `规则最多 ${THEME_RULES_MAX} 个字`,
    )
    expect(validateThemeDraft(draft({ resultNote: 'x'.repeat(THEME_RESULT_NOTE_MAX + 1) }))).toContain(
      `结果说明最多 ${THEME_RESULT_NOTE_MAX} 个字`,
    )
    expect(
      validateThemeDraft(
        draft({
          description: 'x'.repeat(THEME_DESCRIPTION_MAX),
          rules: 'x'.repeat(THEME_RULES_MAX),
          resultNote: 'x'.repeat(THEME_RESULT_NOTE_MAX),
        }),
      ),
    ).toEqual([])
  })

  it('时间必填、格式要能解析、结束必须晚于开始', () => {
    expect(validateThemeDraft(draft({ startsAt: '' }))).toContain('请选择开始时间')
    expect(validateThemeDraft(draft({ endsAt: '' }))).toContain('请选择结束时间')
    expect(validateThemeDraft(draft({ startsAt: '不是时间' }))).toContain('开始/结束时间格式不正确')
    expect(validateThemeDraft(draft({ startsAt: around(3), endsAt: around(3) }))).toContain(
      '结束时间必须晚于开始时间',
    )
    expect(validateThemeDraft(draft({ startsAt: around(3), endsAt: around(1) }))).toContain(
      '结束时间必须晚于开始时间',
    )
  })

  it('多条错误一起返回（页面一次全列出来，不让用户改一个报一个）', () => {
    const errors = validateThemeDraft(draft({ slug: '', title: '', startsAt: '', endsAt: '' }))
    expect(errors).toHaveLength(4)
  })

  it('不校验「同一时刻只能有一期进行中」这类需要看库的规则（留给后端 409）', () => {
    expect(validateThemeDraft(draft({ status: 'active' }))).toEqual([])
  })
})

describe('投稿上限与徽标', () => {
  it('canSubmitMore / themeEntryLimitText 与上限常量一致', () => {
    expect(MAX_ENTRIES_PER_AUTHOR).toBe(3)
    expect(canSubmitMore(0)).toBe(true)
    expect(canSubmitMore(2)).toBe(true)
    expect(canSubmitMore(3)).toBe(false)
    expect(themeEntryLimitText(0)).toContain('还可以投 3 件')
    expect(themeEntryLimitText(1)).toContain('还可以投 2 件')
    expect(themeEntryLimitText(2)).toContain('还可以投 1 件')
    expect(themeEntryLimitText(3)).toContain('你已投满')
    // 后端理论上不会给 4，真给了也不能说「还可以投 -1 件」
    expect(themeEntryLimitText(4)).toContain('你已投满')
  })

  it('themeEntryBadge 只在入选时给出「编辑精选」', () => {
    expect(themeEntryBadge({ isSelected: true })).toBe('编辑精选')
    expect(themeEntryBadge({ isSelected: false })).toBeNull()
  })

  it('THEME_STATUS_LABEL 覆盖三种状态', () => {
    expect(THEME_STATUS_LABEL).toEqual({ draft: '草稿', active: '进行中', closed: '已结束' })
  })

  it('评语上限与卡片使用同一常量', () => {
    expect(THEME_ENTRY_NOTE_MAX).toBe(200)
  })
})
