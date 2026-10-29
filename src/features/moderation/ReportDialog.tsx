/**
 * 举报对话框（8.2）。
 *
 * 三个入口（作品更多菜单 / 评论操作区 / 主页更多菜单）共用这一个组件，
 * 回执与校验只此一份：
 *   · 理由必选，未选时 role="alert" 提示（不是只靠红色边框）；
 *   · 补充说明 0–500 字，aria-describedby 指向字数说明；
 *   · 成功后**不关闭**，就地展示回执编号 —— 用户要能把这串编号抄走或截图。
 */
import { useId, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Textarea } from '@/components/ui/Textarea'
import { AppError } from '@/data/contracts'
import type { ReportReason, ReportTargetType } from '@/domain/types'
import { useSubmitReport } from '@/hooks/useModeration'
import { REPORT_REASON_OPTIONS, reasonLabel, targetKindLabel } from './copy'

export interface ReportTargetRef {
  type: ReportTargetType
  id: string
  /** 人类可读的目标描述，如「作品《山间晨雾》」；用于对话框标题与确认文案 */
  label: string
}

export interface ReportDialogProps {
  /** null = 关闭 */
  target: ReportTargetRef | null
  onClose: () => void
}

export function ReportDialog({ target, onClose }: ReportDialogProps) {
  // 关闭时不挂载内部组件：这样页面只是「放了一个举报入口」就不会订阅举报 mutation，
  // 也就不会因为缺少 QueryClient 之类的上下文而报错（入口在多个页面复用）。
  if (!target) return null
  // key 让换目标时直接重建，输入、错误、回执都自然清空，不依赖 effect 里手动重置
  return <ReportDialogBody key={`${target.type}:${target.id}`} target={target} onClose={onClose} />
}

interface ReportDialogBodyProps {
  target: ReportTargetRef
  onClose: () => void
}

function ReportDialogBody({ target, onClose }: ReportDialogBodyProps) {
  const [reason, setReason] = useState<ReportReason | ''>('')
  const [detail, setDetail] = useState('')
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState<string | null>(null)
  const groupId = useId()
  const detailId = useId()
  const submit = useSubmitReport()

  const handleSubmit = async () => {
    if (!reason) {
      setError('请选择一个举报理由')
      return
    }
    setError('')
    try {
      const result = await submit.mutateAsync({
        targetType: target.type,
        targetId: target.id,
        reason,
        detail: detail.trim(),
      })
      setReceipt(result.reportId)
    } catch (err) {
      setError(err instanceof AppError ? err.message : '提交失败，请稍后重试')
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submit.isPending) onClose()
      }}
      title={receipt ? '举报已提交' : `举报${target.label}`}
      description={
        receipt
          ? '我们会尽快审核，处理结果可以在「举报与处罚」里查看。'
          : `请选择举报理由，补充说明有助于我们更快判断（${targetKindLabel(target.type)}）。`
      }
      footer={
        receipt ? (
          <>
            <Link className="g-btn g-btn-secondary g-btn-md" to="/me/moderation">
              查看我的举报
            </Link>
            <Button onClick={onClose}>完成</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={submit.isPending}>
              取消
            </Button>
            <Button variant="danger" loading={submit.isPending} onClick={() => void handleSubmit()}>
              提交举报
            </Button>
          </>
        )
      }
    >
      {receipt ? (
        <div className="g-report-receipt" role="status">
          <p className="g-report-receipt-label">回执编号</p>
          <p className="g-report-receipt-code">{receipt}</p>
          <p className="g-report-receipt-hint">
            {reason ? `举报理由：${reasonLabel(reason)}。` : ''}处理进度可在「举报与处罚 → 我的举报」查看。
          </p>
        </div>
      ) : (
        <div className="g-report-form">
          <fieldset className="g-report-reasons" aria-describedby={error ? `${groupId}-error` : undefined}>
            <legend className="g-label">举报理由</legend>
            {REPORT_REASON_OPTIONS.map((option) => (
              <label key={option.value} className="g-choice">
                <input
                  type="radio"
                  name={`${groupId}-reason`}
                  value={option.value}
                  checked={reason === option.value}
                  onChange={() => {
                    setReason(option.value)
                    setError('')
                  }}
                />
                <span className="g-choice-body">
                  <span className="g-choice-label">{option.label}</span>
                  <span className="g-choice-hint">{option.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {error && (
            <p className="g-auth-error" id={`${groupId}-error`} role="alert">
              {error}
            </p>
          )}

          <div className="g-report-detail">
            <Textarea
              id={detailId}
              label="补充说明（选填）"
              hint="最多 500 字，写清时间、位置或具体问题"
              maxLength={500}
              showCount
              rows={4}
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
            />
          </div>
        </div>
      )}
    </Dialog>
  )
}
