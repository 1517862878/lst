/**
 * 作品详情的「更多」菜单（8.2）。
 *
 * 只放举报：作者本人不显示（自己举报自己没有意义，后端也会拒），
 * 游客点举报会被 useReportRequest 带到登录页并回跳。
 */
import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { ReportDialog } from './ReportDialog'
import { useReportRequest } from './useReportRequest'

export interface WorkMoreMenuProps {
  photoId: string
  title: string
  /** 作者是否就是当前登录用户 */
  isAuthor: boolean
}

export function WorkMoreMenu({ photoId, title, isAuthor }: WorkMoreMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const report = useReportRequest()

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
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

  if (isAuthor) return null

  return (
    <div className="g-more-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="g-btn g-btn-secondary g-btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="作品更多操作"
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal aria-hidden="true" /> 更多
      </button>
      {open && (
        <div className="g-more-menu-popover" role="menu" aria-label="作品更多操作">
          <button
            type="button"
            role="menuitem"
            className="g-more-menu-item g-more-menu-danger"
            onClick={() => {
              setOpen(false)
              report.request({ type: 'photo', id: photoId, label: `作品《${title}》` })
            }}
          >
            举报该作品
          </button>
        </div>
      )}
      <ReportDialog target={report.target} onClose={report.close} />
    </div>
  )
}
