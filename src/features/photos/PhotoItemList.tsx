/**
 * 组照条目编辑器（8.4c）：发布页与编辑页共用。
 *
 * 一条一行：缩略图 + 「第 N 张」+ 可选说明（≤200 字）+ 上移/下移/删除。
 * 第 1 张是封面，行内明确标注，因为「顺序即封面」是这套数据模型的核心约定
 * （photos.image_key 永远同步成 position = 0 那张）。
 *
 * 为什么不用拖拽库：硬约束是不新增依赖，原生 button 也能用键盘完成同样的操作，
 * 而且方向键要留给详情页的画册，两个交互抢同一组键只会更难用。
 */
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { MAX_ITEM_CAPTION } from '@/domain/photoItems'
import { PhotoItemThumb } from './PhotoItemThumb'

export interface EditablePhotoItem {
  /** 本地稳定 id（不是后端 id）：重排/删除时 React 才不会把状态串到别的行 */
  id: string
  caption: string
  /** 本地文件预览地址（object URL），没有就按 thumbKey 读存储 */
  previewUrl?: string | null
  imageKey?: string | null
  thumbKey?: string | null
  width: number
  height: number
  /** 行内状态文案，如「待上传」「上传中…」 */
  status?: string
}

export interface PhotoItemListProps {
  items: EditablePhotoItem[]
  idPrefix: string
  onChangeCaption: (id: string, caption: string) => void
  onRemove: (id: string) => void
  /** direction: -1 上移，1 下移 */
  onMove: (id: string, direction: -1 | 1) => void
  /** 只剩 1 张时不允许删（封面必须有图） */
  canRemove?: boolean
  disabled?: boolean
}

export function PhotoItemList({
  items,
  idPrefix,
  onChangeCaption,
  onRemove,
  onMove,
  canRemove = true,
  disabled = false,
}: PhotoItemListProps) {
  return (
    <ul className="g-item-list" aria-label="组照条目">
      {items.map((item, index) => {
        const position = index + 1
        const last = index === items.length - 1
        const first = index === 0
        return (
          <li key={item.id} className="g-item-row">
            <div className="g-item-media">
              <PhotoItemThumb
                previewUrl={item.previewUrl ?? null}
                thumbKey={item.thumbKey ?? null}
                alt={`第 ${position} 张预览`}
                width={item.width}
                height={item.height}
              />
              {first && <span className="g-item-cover">封面</span>}
            </div>
            <div className="g-item-body">
              <p className="g-item-title">
                第 {position} 张
                {item.status && <small className="g-item-status">{item.status}</small>}
              </p>
              <Textarea
                id={`${idPrefix}-caption-${item.id}`}
                label={`第 ${position} 张说明（可选）`}
                value={item.caption}
                onChange={(event) => onChangeCaption(item.id, event.target.value)}
                maxLength={MAX_ITEM_CAPTION}
                showCount
                placeholder="这一张想说的话，可不填"
                disabled={disabled}
              />
              <div className="g-item-actions">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onMove(item.id, -1)}
                  disabled={disabled || first}
                  aria-label={`上移第 ${position} 张`}
                >
                  ↑ 上移
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onMove(item.id, 1)}
                  disabled={disabled || last}
                  aria-label={`下移第 ${position} 张`}
                >
                  ↓ 下移
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => onRemove(item.id)}
                  disabled={disabled || !canRemove}
                  aria-label={`删除第 ${position} 张`}
                >
                  删除
                </Button>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
