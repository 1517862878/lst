import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { IconButton } from '@/components/ui/IconButton'
import { useToast } from '@/components/ui/useToast'
import { onSanctionBlocked } from '@/lib/restrictionNotice'
import {
  restrictionExpiryText,
  restrictionScope,
  restrictionTitle,
  type SessionRestriction,
} from '@/domain/restrictions'

/**
 * 8.2 补口：全站账号限制横幅。
 *
 * 位置在 Shell 的 Header 与 <main> 之间，因此所有路由都能看到；
 * 访客（没有 session）和未受限账号不渲染任何节点。
 *
 * 关闭状态按「限制指纹」记在 sessionStorage：
 *   · 只对本次标签页会话有效，关掉浏览器/新标签页会重新提示；
 *   · 限制种类、期限或原因变化 → 指纹变化 → 即使之前关过也重新出现，
 *     避免「警告升级成封禁」被上一次的关闭操作吞掉。
 */
const DISMISS_KEY = 'gy:restriction-dismissed'

function readDismissed(): string | null {
  try {
    return sessionStorage.getItem(DISMISS_KEY)
  } catch {
    // 隐私模式/禁用存储时退化为「本次挂载内可关闭」，不影响渲染
    return null
  }
}

function restrictionToken(restriction: SessionRestriction): string {
  return [restriction.kind, restriction.endsAt ?? 'forever', restriction.reasonCode, restriction.reasonDetail].join('|')
}

export function RestrictionBanner({ restriction }: { restriction: SessionRestriction | null }) {
  const toast = useToast()
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState<string | null>(() => readDismissed())

  // 403 限制提示：请求层只广播，弹 toast 与跳转都在这里做。
  // 没有挂载 toast 的场景（例如纯数据层单测）不会受影响。
  useEffect(
    () =>
      onSanctionBlocked((notice) => {
        toast.show('error', notice.message, {
          action: { label: '去申诉', onClick: () => navigate('/me/moderation') },
        })
      }),
    [toast, navigate],
  )

  if (!restriction) return null

  const token = restrictionToken(restriction)
  if (dismissed === token) return null

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, token)
    } catch {
      // 存不下也要关掉当前这条
    }
    setDismissed(token)
  }

  return (
    <div
      className={cn(
        'g-restriction-banner',
        restriction.kind === 'warning' && 'g-restriction-banner-warning',
      )}
      role="status"
    >
      <div className="g-container g-restriction-inner">
        <span className="g-restriction-mark" aria-hidden="true">
          !
        </span>
        <div className="g-restriction-body">
          <p className="g-restriction-title">{restrictionTitle(restriction.kind)}</p>
          <p className="g-restriction-text">{restrictionScope(restriction.kind)}</p>
          <p className="g-restriction-meta">
            {restrictionExpiryText(restriction.endsAt)}
            {restriction.reasonDetail ? ` · 原因：${restriction.reasonDetail}` : null}
          </p>
        </div>
        <div className="g-restriction-actions">
          <Link className="g-btn g-btn-sm g-btn-secondary" to="/me/moderation">
            提交申诉
          </Link>
          <IconButton
            icon={X}
            label="关闭限制提示（仅本次会话）"
            size="sm"
            className="g-restriction-close"
            onClick={dismiss}
          />
        </div>
      </div>
    </div>
  )
}
