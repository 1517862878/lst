/**
 * 申诉对话框（8.2）。
 *
 * 两条来源共用：被驳回的举报、被处罚的记录。校验口径与后端一致（10–2000 字），
 * 前端先挡一次是为了让用户在弹窗里立刻看到字数差多少，而不是提交后等一个 400。
 */
import { useEffect, useId, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Textarea } from '@/components/ui/Textarea'
import { AppError } from '@/data/contracts'
import { useSubmitAppeal } from '@/hooks/useModeration'

export interface AppealSubject {
  kind: 'report' | 'sanction'
  id: string
  /** 展示用描述，如「举报 #rep-1 的驳回结论」 */
  label: string
}

export interface AppealDialogProps {
  subject: AppealSubject | null
  onClose: () => void
  onSubmitted?: () => void
}

const MIN = 10
const MAX = 2000

export function AppealDialog({ subject, onClose, onSubmitted }: AppealDialogProps) {
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const fieldId = useId()
  const submit = useSubmitAppeal()

  useEffect(() => {
    setMessage('')
    setError('')
    submit.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject?.kind, subject?.id])

  const handleSubmit = async () => {
    if (!subject) return
    const trimmed = message.trim()
    if (trimmed.length < MIN) {
      setError(`申诉说明至少 ${MIN} 个字，请补充具体理由`)
      return
    }
    if (trimmed.length > MAX) {
      setError(`申诉说明最多 ${MAX} 个字`)
      return
    }
    setError('')
    try {
      await submit.mutateAsync(
        subject.kind === 'report'
          ? { reportId: subject.id, message: trimmed }
          : { sanctionId: subject.id, message: trimmed },
      )
      onSubmitted?.()
      onClose()
    } catch (err) {
      setError(err instanceof AppError ? err.message : '提交失败，请稍后重试')
    }
  }

  return (
    <Dialog
      open={subject !== null}
      onOpenChange={(open) => {
        if (!open && !submit.isPending) onClose()
      }}
      title="提交申诉"
      description={subject ? `针对「${subject.label}」说明你认为处理有误的理由。` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submit.isPending}>
            取消
          </Button>
          <Button loading={submit.isPending} onClick={() => void handleSubmit()}>
            提交申诉
          </Button>
        </>
      }
    >
      <Textarea
        id={fieldId}
        label="申诉说明"
        required
        hint={`${MIN}–${MAX} 字，写清事实与依据；复核结果会通知你`}
        maxLength={MAX}
        showCount
        rows={6}
        value={message}
        error={error || undefined}
        onChange={(event) => {
          setMessage(event.target.value)
          if (error) setError('')
        }}
      />
    </Dialog>
  )
}
