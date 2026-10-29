/**
 * 作品详情的「更多」菜单（8.2 举报 + 8.3c 编辑精选）。
 *
 * 菜单项按身份分流：
 *   · 举报：作者本人不显示（自己举报自己没有意义，后端也会拒）；游客点举报会被
 *     useReportRequest 带到登录页并回跳。
 *   · 设为 / 取消编辑精选：只有 editor / admin 看得到（服务端同样校验，UI 隐藏只是
 *     第一道闸）。点下去走乐观更新（见 useSetEditorChoice），失败会回滚并提示。
 */
import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { ReportDialog } from './ReportDialog'
import { useReportRequest } from './useReportRequest'
import { useToast } from '@/components/ui/useToast'
import { AppError } from '@/data/contracts'
import { useSetEditorChoice } from '@/hooks/useDiscover'
import { useSession } from '@/hooks/useSession'

export interface WorkMoreMenuProps {
  photoId: string
  title: string
  /** 作者是否就是当前登录用户 */
  isAuthor: boolean
  /** 当前是否已被标为编辑精选（决定菜单文案与目标状态） */
  featured?: boolean
}

export function WorkMoreMenu({ photoId, title, isAuthor, featured = false }: WorkMoreMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const report = useReportRequest()
  const toast = useToast()
  const { data: session } = useSession()
  const setEditorChoice = useSetEditorChoice(photoId)

  const isStaff = session?.role === 'editor' || session?.role === 'admin'

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

  // 作者本人没有「举报自己」的入口；但 staff 即使是作者也需要精选开关，不能一起藏掉
  if (isAuthor && !isStaff) return null

  const toggleFeatured = () => {
    setOpen(false)
    setEditorChoice.mutate(!featured, {
      onSuccess: () => {
        toast.show('success', featured ? '已取消编辑精选' : '已设为编辑精选')
      },
      onError: (error) => {
        toast.show(
          'error',
          error instanceof AppError ? error.message : '操作失败，请稍后重试',
        )
      },
    })
  }

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
          {isStaff && (
            <button
              type="button"
              role="menuitem"
              className="g-more-menu-item"
              aria-pressed={featured}
              onClick={toggleFeatured}
            >
              {featured ? '取消编辑精选' : '设为编辑精选'}
            </button>
          )}
          {!isAuthor && (
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
          )}
        </div>
      )}
      <ReportDialog target={report.target} onClose={report.close} />
    </div>
  )
}
