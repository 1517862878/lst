/**
 * /me 的主页代表作选择器（8.4a ④）。
 *
 * 规则：最多 3 件、顺序即展示顺序、可清空。上移/下移而不是拖拽 ——
 * 拖拽键盘不可达，而这是要能在手机与读屏里都完成的操作。
 *
 * 保存走 ProfileRepository.setPinned，以服务端返回为准（越权/已撤回的 id 会被拒），
 * 所以成功后才把本地顺序重置成服务端顺序。
 */
import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Pin, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/useToast'
import { EmptyState } from '@/components/ui/EmptyState'
import { PINNED_MAX, movePinned, normalizePinnedIds, togglePinned } from '@/domain/photography'
import type { Photo } from '@/domain/types'
import { useSetPinned } from '@/hooks/usePhotography'
import { useProfileByUsername, useSession } from '@/hooks/useSession'

export interface PinnedWorksPickerProps {
  /** 本人全部在架作品（/me 已经拉过，不重复请求） */
  photos: Photo[]
}

export function PinnedWorksPicker({ photos }: PinnedWorksPickerProps) {
  const { data: session } = useSession()
  const profileQuery = useProfileByUsername(session?.username ?? '')
  const save = useSetPinned()
  const toast = useToast()

  const serverIds = normalizePinnedIds(profileQuery.data?.pinnedPhotoIds ?? [])
  const [ids, setIds] = useState<string[]>(serverIds)

  // 服务端顺序变了（保存成功、其它标签页改动）就跟随，避免本地残留一份过期顺序
  const serverKey = serverIds.join(',')
  useEffect(() => {
    setIds(normalizePinnedIds(serverKey === '' ? [] : serverKey.split(',')))
  }, [serverKey])

  const titleOf = (id: string) => photos.find((photo) => photo.id === id)?.title ?? '（作品已不在架）'
  const rest = photos.filter((photo) => !ids.includes(photo.id))
  const dirty = ids.join(',') !== serverIds.join(',')

  const add = (id: string) => {
    const next = togglePinned(ids, id)
    if (!next) {
      toast.show('info', `最多选 ${PINNED_MAX} 件代表作，先移除一件再加`)
      return
    }
    setIds(next)
  }

  const remove = (id: string) => {
    const next = togglePinned(ids, id)
    setIds(next ?? ids)
  }

  const move = (index: number, delta: -1 | 1) => setIds(movePinned(ids, index, delta))

  const submit = async () => {
    try {
      const result = await save.mutateAsync(ids)
      setIds(normalizePinnedIds(result.pinnedPhotoIds))
      toast.show('success', ids.length === 0 ? '已清空主页代表作' : '主页代表作已更新')
    } catch (error) {
      toast.show('error', error instanceof Error ? error.message : '保存失败，请稍后重试')
    }
  }

  return (
    <section className="g-pinned-block" aria-labelledby="me-pinned-title">
      <div className="g-pinned-head">
        <h2 className="g-pinned-title" id="me-pinned-title">
          主页代表作
        </h2>
        <span className="g-pinned-sub">
          已选 {ids.length}/{PINNED_MAX} 件 · 公开主页按此顺序置顶
        </span>
      </div>

      {ids.length === 0 ? (
        <p className="g-photography-note">还没有选代表作。选 1–3 件作品，它们会置顶显示在公开主页。</p>
      ) : (
        <ol className="g-pinned-picker" aria-label="已选代表作（按展示顺序）">
          {ids.map((id, index) => (
            <li key={id} className="g-pinned-row">
              <span className="g-pinned-order" aria-hidden="true">{index + 1}</span>
              <span className="g-pinned-row-title">{titleOf(id)}</span>
              <span className="g-pinned-row-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={`把「${titleOf(id)}」上移`}
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => move(index, 1)}
                  disabled={index === ids.length - 1}
                  aria-label={`把「${titleOf(id)}」下移`}
                >
                  <ArrowDown aria-hidden="true" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(id)} aria-label={`移除「${titleOf(id)}」`}>
                  <X aria-hidden="true" />
                </Button>
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="g-pinned-actions">
        <Button onClick={() => void submit()} loading={save.isPending} disabled={!dirty || save.isPending}>
          保存代表作
        </Button>
        <Button
          variant="secondary"
          onClick={() => setIds([])}
          disabled={ids.length === 0 || save.isPending}
        >
          清空
        </Button>
      </div>

      <h3 className="g-pinned-sub" id="me-pinned-picker-title">
        从我的作品里添加
      </h3>
      {photos.length === 0 ? (
        <EmptyState title="还没有可设为代表作的作品" description="发布并通过审核后即可选择" actions={[{ label: '去发布', to: '/publish' }]} />
      ) : rest.length === 0 ? (
        <p className="g-photography-note">全部作品都已设为代表作。</p>
      ) : (
        <ul className="g-pinned-picker" aria-labelledby="me-pinned-picker-title">
          {rest.map((photo) => (
            <li key={photo.id} className="g-pinned-row">
              <span className="g-pinned-row-title">{photo.title}</span>
              <span className="g-pinned-row-actions">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => add(photo.id)}
                  aria-label={`把「${photo.title}」设为代表作`}
                >
                  <Pin aria-hidden="true" />
                  设为代表作
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
