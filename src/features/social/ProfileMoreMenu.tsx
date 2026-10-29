import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/useToast'
import { ReportDialog } from '@/features/moderation/ReportDialog'
import { useReportRequest } from '@/features/moderation/useReportRequest'
import { AppError } from '@/data/contracts'
import { useBlockUser } from '@/hooks/useSocial'

export interface ProfileMoreMenuProps {
  username: string
  /**
   * 被举报对象 id。API 模式的公开资料**不返回** profiles.id（服务端按 username 授权），
   * 所以这里可以省略 —— 省略时退回 username，后端两种都能解析，mock 模式永远是真实 id。
   */
  profileId?: string
  /** 展示名（举报对话框标题用，缺省回落 @username） */
  displayName?: string
  onBlocked: () => void
}

export function ProfileMoreMenu({ username, profileId, displayName, onBlocked }: ProfileMoreMenuProps) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const block = useBlockUser(username)
  const toast = useToast()
  const report = useReportRequest()

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        setConfirming(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const submit = async () => {
    try {
      await block.mutateAsync()
      setOpen(false)
      setConfirming(false)
      toast.show('success', '已拉黑该用户')
      onBlocked()
    } catch (error) {
      toast.show('error', error instanceof AppError ? error.message : '拉黑失败，请稍后重试')
    }
  }

  return (
    <div className="g-profile-more" ref={rootRef}>
      <button ref={triggerRef} type="button" className="g-btn g-btn-secondary g-btn-md" aria-haspopup="menu" aria-expanded={open} aria-label="更多操作" onClick={() => setOpen((value) => !value)}>
        <MoreHorizontal aria-hidden="true" /> 更多
      </button>
      {open && (
        <div className="g-profile-more-popover" role="menu" aria-label="个人主页更多操作">
          {!confirming && (
            <button
              type="button"
              role="menuitem"
              className="g-profile-more-item"
              onClick={() => {
                setOpen(false)
                report.request({
                  type: 'profile',
                  id: profileId ?? username,
                  label: displayName ? `用户 ${displayName}` : `用户 @${username}`,
                })
              }}
            >
              举报 @{username}
            </button>
          )}
          {!confirming ? (
            <button type="button" role="menuitem" className="g-profile-more-danger" onClick={() => setConfirming(true)}>拉黑 @{username}</button>
          ) : (
            <div className="g-profile-block-confirm" role="alertdialog" aria-labelledby="profile-block-title" aria-describedby="profile-block-desc">
              <strong id="profile-block-title">确认拉黑 @{username}？</strong>
              <p id="profile-block-desc">你们将互相无法关注或互动，已有关注关系也会解除。</p>
              <div className="g-profile-block-actions">
                <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>取消</Button>
                <Button variant="danger" size="sm" loading={block.isPending} onClick={() => void submit()}>确认拉黑</Button>
              </div>
            </div>
          )}
        </div>
      )}
      <ReportDialog target={report.target} onClose={report.close} />
    </div>
  )
}
