/**
 * 评论组件（FRONTEND-WORK §3.3 CommentList/CommentForm）。
 * 评论必须登录（用户拍板 Q-3）；纯文本渲染防 XSS（ROADMAP R-06，S5 先做）；
 * 一级回复；软删显示占位。
 *
 * 8.4b 评论区治理（三件事都围绕「作者说了算」）：
 *   · 锁：作者关掉评论后，整块输入框不再渲染，只留一句「作者已关闭这件作品的评论」；
 *     已有评论照常可读 —— 关评论不是删评论。
 *   · 排序：最新 / 最早写进 ?commentSort=，只动自己这一个键，
 *     ?season= / ?sort= 等其他参数原样保留（评论区不该顺手清掉别人的筛选）。
 *   · 删：评论作者删自己的，作品作者删这件作品下的任意一条；都要二次确认。
 */
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import type { Comment } from '@/domain/types'
import type { CommentSort } from '@/data/contracts'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Textarea } from '@/components/ui/Textarea'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  useComments,
  useDeleteComment,
  usePostComment,
  useSetCommentsLocked,
} from '@/hooks/useInteractions'
import { useProfile } from '@/hooks/useSession'
import { relativeTime } from '@/lib/time'
import { ReportDialog } from '@/features/moderation/ReportDialog'
import { useReportRequest } from '@/features/moderation/useReportRequest'

/** URL 上的排序参数名（与 ?season= / ?sort= 区分开，互不覆盖） */
const SORT_PARAM = 'commentSort'

export interface CommentSectionProps {
  photoId: string
  currentUserId: string | null
  /** 当前用户是不是这件作品的作者（决定「允许评论」开关与跨人删除按钮） */
  isAuthor?: boolean
  /** 作者是否关闭了评论（undefined = 允许） */
  commentsLocked?: boolean
}

export function CommentSection({
  photoId,
  currentUserId,
  isAuthor = false,
  commentsLocked = false,
}: CommentSectionProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const commentSort: CommentSort = searchParams.get(SORT_PARAM) === 'oldest' ? 'oldest' : 'latest'
  const commentsQuery = useComments(photoId, commentSort)
  const [body, setBody] = useState('')
  const [parentId, setParentId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [lockError, setLockError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Comment | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const post = usePostComment(photoId)
  const removeComment = useDeleteComment(photoId)
  const setLocked = useSetCommentsLocked(photoId)
  const navigate = useNavigate()
  // 举报入口：游客点击会跳登录并回跳本作品页
  const report = useReportRequest()

  const locked = commentsLocked === true

  /**
   * 只改 commentSort 一个键：克隆现有参数再增删。
   * replace 而不是 push —— 排序不是导航，不该把后退按钮塞满。
   */
  function changeSort(next: CommentSort) {
    const params = new URLSearchParams(searchParams)
    // 缺省值不写进 URL：/works/x 比 /works/x?commentSort=latest 干净，分享出去也一样
    if (next === 'latest') params.delete(SORT_PARAM)
    else params.set(SORT_PARAM, next)
    setSearchParams(params, { replace: true })
  }

  function handleLockChange(nextLocked: boolean) {
    setLockError('')
    setLocked.mutate(nextLocked, {
      onError: (err) => setLockError(err instanceof Error ? err.message : '设置失败，请稍后重试'),
      // 关评论后输入框立刻消失，正在写的那半句没有去处，直接清掉
      onSuccess: () => setParentId(null),
    })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!currentUserId) {
      navigate(`/login?next=${encodeURIComponent(`/works/${photoId}`)}`)
      return
    }
    const trimmed = body.trim()
    if (!trimmed) {
      setError('评论不能为空')
      return
    }
    post.mutate(
      { authorId: currentUserId, body: trimmed, parentId },
      {
        onSuccess: () => {
          setBody('')
          setParentId(null)
        },
        onError: (err) => setError(err instanceof Error ? err.message : '发表失败'),
      },
    )
  }

  function handleDelete() {
    if (!deleteTarget) return
    setDeleteError('')
    removeComment.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
      onError: (err) => setDeleteError(err instanceof Error ? err.message : '删除失败，请稍后重试'),
    })
  }

  /** 评论作者本人；或当前用户是作品作者（可删别人在自己作品下的评论） */
  const canDelete = (comment: Comment): boolean =>
    Boolean(currentUserId) && (comment.authorId === currentUserId || isAuthor)

  const comments = commentsQuery.data?.items ?? []
  const topLevel = comments.filter((c) => c.parentId === null)

  return (
    <section className="g-comments" aria-label="评论区">
      <div className="g-comments-head">
        <h2 className="g-comments-title">评论（{commentsQuery.data?.total ?? 0}）</h2>
        <div className="g-comment-toolbar">
          <div className="g-comment-sort" role="group" aria-label="评论排序">
            <button
              type="button"
              className="g-comment-sort-btn"
              aria-pressed={commentSort === 'latest'}
              onClick={() => changeSort('latest')}
            >
              最新
            </button>
            <button
              type="button"
              className="g-comment-sort-btn"
              aria-pressed={commentSort === 'oldest'}
              onClick={() => changeSort('oldest')}
            >
              最早
            </button>
          </div>
          {isAuthor && (
            <label className="g-comment-lock">
              <input
                type="checkbox"
                checked={!locked}
                onChange={(e) => handleLockChange(!e.target.checked)}
                aria-describedby="comment-lock-hint"
              />
              <span>允许评论</span>
              <small id="comment-lock-hint" className="g-visually-hidden">
                关闭后访客仍能看到已有评论，但不能再发表新评论。
              </small>
            </label>
          )}
        </div>
      </div>

      {lockError && (
        <p className="g-auth-error" role="alert">
          {lockError}
        </p>
      )}

      {/* 关评论：不渲染任何输入控件。给游客和登录用户同一句话——
          说了「关着」就不该再留一个写着「请先登录」的空壳把人引向一段死路 */}
      {locked ? (
        <p className="g-comment-locked" role="status">
          作者已关闭这件作品的评论
        </p>
      ) : (
        <form className="g-comment-form" onSubmit={handleSubmit}>
          {currentUserId ? (
            <>
              <Textarea
                label="发表评论"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={500}
                showCount
                placeholder={parentId ? '回复这条评论…' : '分享你的看法（评论需登录）'}
              />
              {parentId && (
                <p className="g-comment-replying" role="status">
                  正在回复某条评论{' '}
                  <Button type="button" variant="ghost" size="sm" onClick={() => setParentId(null)}>
                    取消回复
                  </Button>
                </p>
              )}
              {error && (
                <p className="g-auth-error" role="alert">
                  {error}
                </p>
              )}
              <div className="g-comment-actions">
                <Button type="submit" size="sm" loading={post.isPending}>
                  发表评论
                </Button>
              </div>
            </>
          ) : (
            <p className="g-comment-login-hint">
              请先{' '}
              {/* 用 Link 保留 base：子路径部署时原生 href 会丢失 /lst/ 前缀 */}
              <Link to={`/login?next=${encodeURIComponent(`/works/${photoId}`)}`}>登录</Link> 后再评论。
            </p>
          )}
        </form>
      )}

      {commentsQuery.isLoading ? (
        <div className="g-comment-skeletons" aria-hidden="true">
          <Skeleton variant="rect" height={60} />
          <Skeleton variant="rect" height={60} />
        </div>
      ) : topLevel.length === 0 ? (
        <EmptyState title="还没有评论" description="成为第一个评论的人吧。" />
      ) : (
        <ul className="g-comment-list">
          {topLevel.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              replies={comments.filter((r) => r.parentId === c.id)}
              onReply={() => setParentId(c.id)}
              canReply={Boolean(currentUserId) && !locked}
              canDelete={canDelete}
              onDelete={setDeleteTarget}
              currentUserId={currentUserId}
              onReport={(target) =>
                report.request({ type: 'comment', id: target.id, label: '评论' })
              }
            />
          ))}
        </ul>
      )}
      <ReportDialog target={report.target} onClose={report.close} />

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (removeComment.isPending) return
          if (!open) {
            setDeleteTarget(null)
            setDeleteError('')
          }
        }}
        title="删除这条评论？"
        description="删除后评论位置会显示「该评论已删除」，作者与读者都会看到这个占位。"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setDeleteTarget(null)}
              disabled={removeComment.isPending}
            >
              取消
            </Button>
            <Button
              variant="danger"
              loading={removeComment.isPending}
              onClick={handleDelete}
            >
              确认删除
            </Button>
          </>
        }
      >
        <p className="g-comment-delete-copy">
          将删除这条评论：
          <span className="g-comment-delete-quote">
            {deleteTarget?.body.slice(0, 60) ?? ''}
            {(deleteTarget?.body.length ?? 0) > 60 ? '…' : ''}
          </span>
        </p>
        {deleteError && (
          <p className="g-auth-error" role="alert">
            {deleteError}
          </p>
        )}
      </Dialog>
    </section>
  )
}

function CommentItem({
  comment,
  replies,
  onReply,
  canReply,
  canDelete,
  onDelete,
  currentUserId,
  onReport,
}: {
  comment: Comment
  replies: Comment[]
  onReply: () => void
  canReply: boolean
  canDelete: (comment: Comment) => boolean
  onDelete: (comment: Comment) => void
  currentUserId: string | null
  onReport: (comment: Comment) => void
}) {
  // 软删：显示占位（ROADMAP §5.3）
  if (comment.status === 'removed' || comment.deletedAt) {
    return (
      <li className="g-comment-item g-comment-item-removed">
        <p className="g-comment-removed-text">该评论已删除</p>
      </li>
    )
  }

  const isOwn = comment.authorId === currentUserId

  return (
    <li className="g-comment-item">
      <CommentBody comment={comment} />
      <div className="g-comment-item-actions">
        {canReply && (
          <button type="button" className="g-comment-reply-btn" onClick={onReply}>
            回复
          </button>
        )}
        {canDelete(comment) && (
          <button
            type="button"
            className="g-comment-delete-btn"
            onClick={() => onDelete(comment)}
            aria-label={isOwn ? '删除这条评论' : '删除他人评论（作品作者）'}
          >
            删除
          </button>
        )}
        {!isOwn && (
          <button
            type="button"
            className="g-comment-report-btn"
            onClick={() => onReport(comment)}
            aria-label="举报这条评论"
          >
            举报
          </button>
        )}
      </div>
      {replies.length > 0 && (
        <ul className="g-comment-replies">
          {replies.map((r) => (
            <li key={r.id}>
              {r.status === 'removed' || r.deletedAt ? (
                <p className="g-comment-removed-text">该评论已删除</p>
              ) : (
                <>
                  <CommentBody comment={r} />
                  <div className="g-comment-item-actions g-comment-item-actions-reply">
                    {canDelete(r) && (
                      <button
                        type="button"
                        className="g-comment-delete-btn"
                        onClick={() => onDelete(r)}
                        aria-label={
                          r.authorId === currentUserId ? '删除这条回复' : '删除他人回复（作品作者）'
                        }
                      >
                        删除
                      </button>
                    )}
                    {r.authorId !== currentUserId && (
                      <button
                        type="button"
                        className="g-comment-report-btn"
                        onClick={() => onReport(r)}
                        aria-label="举报这条回复"
                      >
                        举报
                      </button>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function CommentBody({ comment }: { comment: Comment }) {
  // 纯文本渲染：React 默认转义，XSS 天然防御（ROADMAP R-06）
  const profileQuery = useProfile(comment.authorId)
  const authorName = profileQuery.data?.displayName ?? profileQuery.data?.username ?? '用户'
  return (
    <div className="g-comment-body">
      <Avatar name={authorName} size={32} />
      <div className="g-comment-content">
        <p className="g-comment-meta">
          <span className="g-comment-author">{authorName}</span>
          <span className="g-comment-time">{relativeTime(comment.createdAt)}</span>
        </p>
        <p className="g-comment-text">{comment.body}</p>
      </div>
    </div>
  )
}
