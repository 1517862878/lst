/**
 * 主题创建 / 编辑表单（8.4d 后台）。
 *
 * 编辑态先取一次详情：后台列表（adminList）返回的是 ThemeSummary，**不含** rules
 * 与 resultNote —— 直接拿列表数据填表单，一保存就会把规则和结果说明清空。
 *
 * 校验只做本地能判定的部分（validateThemeDraft）：「同一时刻只能有一期进行中」
 * 「封面必须是本期投稿」这类要看库的规则留给仓储的 409/400，页面把 message 原样显示。
 */
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { ErrorState } from '@/components/ui/ErrorState'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { Textarea } from '@/components/ui/Textarea'
import { useToast } from '@/components/ui/useToast'
import {
  THEME_DESCRIPTION_MAX,
  THEME_RESULT_NOTE_MAX,
  THEME_RULES_MAX,
  THEME_STATUS_LABEL,
  THEME_TITLE_MAX,
  fromDateTimeLocal,
  suggestThemeSlug,
  toDateTimeLocal,
  validateThemeDraft,
} from '@/domain/themes'
import type { ThemeDetail, ThemeStatus, ThemeSummary } from '@/domain/types'
import { useCreateTheme, useTheme, useUpdateTheme } from '@/hooks/useThemes'

const STATUS_OPTIONS: Array<{ value: ThemeStatus; hint: string }> = [
  { value: 'draft', hint: '只有编辑能看到，不进任何公开列表' },
  { value: 'active', hint: '同一时刻只能有一期进行中' },
  { value: 'closed', hint: '归档到「往期」，可补结果说明' },
]

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export interface ThemeFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 传已有主题 = 编辑；传 null / 不传 = 新建 */
  theme?: ThemeSummary | null
}

function ThemeForm({ theme, onClose }: { theme: ThemeDetail | null; onClose: () => void }) {
  const toast = useToast()
  const createTheme = useCreateTheme()
  const updateTheme = useUpdateTheme()
  const now = Date.now()

  const [slug, setSlug] = useState(theme?.slug ?? '')
  const [slugTouched, setSlugTouched] = useState(Boolean(theme))
  const [title, setTitle] = useState(theme?.title ?? '')
  const [description, setDescription] = useState(theme?.description ?? '')
  const [rules, setRules] = useState(theme?.rules ?? '')
  const [resultNote, setResultNote] = useState(theme?.resultNote ?? '')
  const [status, setStatus] = useState<ThemeStatus>(theme?.status ?? 'draft')
  const [startsAt, setStartsAt] = useState(
    toDateTimeLocal(theme?.startsAt ?? new Date(now).toISOString()),
  )
  const [endsAt, setEndsAt] = useState(
    toDateTimeLocal(theme?.endsAt ?? new Date(now + WEEK_MS).toISOString()),
  )
  const [errors, setErrors] = useState<string[]>([])
  const [formError, setFormError] = useState('')

  const pending = createTheme.isPending || updateTheme.isPending

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const draft = {
      slug,
      title,
      description,
      rules,
      status,
      startsAt: fromDateTimeLocal(startsAt),
      endsAt: fromDateTimeLocal(endsAt),
      resultNote,
    }
    const problems = validateThemeDraft(draft, { slugLocked: Boolean(theme) })
    if (problems.length > 0) {
      setErrors(problems)
      return
    }
    setErrors([])
    setFormError('')
    try {
      if (theme) {
        await updateTheme.mutateAsync({
          id: theme.id,
          patch: {
            title,
            description,
            rules,
            status,
            startsAt: draft.startsAt,
            endsAt: draft.endsAt,
            resultNote,
          },
        })
        toast.show('success', `已保存「${title}」`)
      } else {
        await createTheme.mutateAsync({
          slug,
          title,
          description,
          rules,
          status,
          startsAt: draft.startsAt,
          endsAt: draft.endsAt,
          ...(resultNote ? { resultNote } : {}),
        })
        toast.show('success', `已创建「${title}」`)
      }
      onClose()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '保存失败，请稍后重试')
    }
  }

  return (
    <form className="g-theme-form" aria-label={theme ? '编辑主题' : '新建主题'} noValidate onSubmit={(event) => void handleSubmit(event)}>
      <Input
        label="Slug（网址短名）"
        value={slug}
        autoFocus={!theme}
        maxLength={40}
        disabled={Boolean(theme)}
        hint={
          theme
            ? 'slug 建好之后不能改：它已经写进了分享出去的链接里。'
            : '只用小写字母、数字与连字符，2–40 位。'
        }
        onChange={(event) => {
          setSlugTouched(true)
          setSlug(event.target.value)
        }}
      />

      <Input
        label="标题"
        value={title}
        maxLength={THEME_TITLE_MAX}
        hint={`最多 ${THEME_TITLE_MAX} 个字`}
        onChange={(event) => {
          const next = event.target.value
          setTitle(next)
          if (!theme && !slugTouched) setSlug(suggestThemeSlug(next))
        }}
      />

      <div className="g-theme-form-row">
        <Input
          label="开始时间"
          type="datetime-local"
          value={startsAt}
          onChange={(event) => setStartsAt(event.target.value)}
        />
        <Input
          label="结束时间"
          type="datetime-local"
          value={endsAt}
          hint="截止那一刻就关门（左闭右开）"
          onChange={(event) => setEndsAt(event.target.value)}
        />
      </div>

      <div className="g-theme-form-field">
        <label className="g-label" htmlFor="theme-status">
          状态
        </label>
        <select
          id="theme-status"
          className="g-input g-select"
          value={status}
          onChange={(event) => setStatus(event.target.value as ThemeStatus)}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {THEME_STATUS_LABEL[option.value]} · {option.hint}
            </option>
          ))}
        </select>
      </div>

      <Textarea
        label="简介"
        rows={2}
        maxLength={THEME_DESCRIPTION_MAX}
        showCount
        value={description}
        hint="会出现在首页「本周主题」条与列表卡片上。"
        onChange={(event) => setDescription(event.target.value)}
      />

      <Textarea
        label="投稿规则"
        rows={4}
        maxLength={THEME_RULES_MAX}
        showCount
        value={rules}
        hint="一行一条，换行会原样保留。"
        onChange={(event) => setRules(event.target.value)}
      />

      <Textarea
        label="结果说明"
        rows={3}
        maxLength={THEME_RESULT_NOTE_MAX}
        showCount
        value={resultNote}
        hint="主题结束后填写，会显示在详情页的「本期结果」。"
        onChange={(event) => setResultNote(event.target.value)}
      />

      {errors.length > 0 && (
        <ul className="g-theme-form-errors" role="alert">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
      {formError && (
        <p className="g-theme-feedback" role="alert">
          {formError}
        </p>
      )}

      <div className="g-theme-form-actions">
        <Button type="submit" loading={pending}>
          {theme ? '保存修改' : '创建主题'}
        </Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>
          取消
        </Button>
      </div>
    </form>
  )
}

export function ThemeFormDialog({ open, onOpenChange, theme }: ThemeFormDialogProps) {
  const editing = Boolean(theme)
  const detailQuery = useTheme(theme?.slug ?? '')

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={theme ? `编辑主题：${theme.title}` : '新建主题'}
      description="状态为「进行中」的主题会出现在首页「本周主题」条与 /themes 列表里。"
      className="g-theme-form-dialog"
    >
      {editing && detailQuery.isLoading ? (
        <div className="g-theme-form-skeleton" aria-hidden="true">
          <Skeleton variant="rect" height={40} />
          <Skeleton variant="rect" height={40} />
          <Skeleton variant="rect" height={120} />
        </div>
      ) : editing && detailQuery.isError ? (
        <ErrorState
          title="主题详情加载失败"
          error={detailQuery.error}
          onRetry={() => void detailQuery.refetch()}
        />
      ) : (
        <ThemeForm
          key={theme?.id ?? 'new'}
          theme={detailQuery.data ?? null}
          onClose={() => onOpenChange(false)}
        />
      )}
    </Dialog>
  )
}
