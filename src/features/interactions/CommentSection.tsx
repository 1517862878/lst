/**
 * 评论组件（FRONTEND-WORK §3.3 CommentList/CommentForm）。
 * 评论必须登录（用户拍板 Q-3）；纯文本渲染防 XSS（ROADMAP R-06，S5 先做）；
 * 一级回复；软删显示占位。
 */
import { useState } from 'react'
import { useNavigate } from 'react-router'
import type { Comment } from '@/domain/types'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { useComments, usePostComment } from '@/hooks/useInteractions'
import { useProfile } from '@/hooks/useSession'
import { relativeTime } from '@/lib/time'

export interface CommentSectionProps {
  photoId: string
  currentUserId: string | null
}

export function CommentSection({ photoId, currentUserId }: CommentSectionProps) {
  const commentsQuery = useComments(photoId)
  const [body, setBody] = useState('')
  const [parentId, setParentId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const post = usePostComment(photoId)
  const navigate = useNavigate()

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

  const comments = commentsQuery.data?.items ?? []
  const topLevel = comments.filter((c) => c.parentId === null)

  return (
    <section className="g-comments" aria-label="评论区">
      <h2 className="g-comments-title">评论（{commentsQuery.data?.total ?? 0}）</h2>

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
            <a href={`/login?next=${encodeURIComponent(`/works/${photoId}`)}`}>登录</a> 后再评论。
          </p>
        )}
      </form>

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
              currentUserId={currentUserId}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function CommentItem({
  comment,
  replies,
  onReply,
  currentUserId,
}: {
  comment: Comment
  replies: Comment[]
  onReply: () => void
  currentUserId: string | null
}) {
  // 软删：显示占位（ROADMAP §5.3）
  if (comment.status === 'removed' || comment.deletedAt) {
    return (
      <li className="g-comment-item g-comment-item-removed">
        <p className="g-comment-removed-text">该评论已删除</p>
      </li>
    )
  }

  return (
    <li className="g-comment-item">
      <CommentBody comment={comment} />
      <div className="g-comment-item-actions">
        {currentUserId && (
          <button type="button" className="g-comment-reply-btn" onClick={onReply}>
            回复
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
                <CommentBody comment={r} />
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
