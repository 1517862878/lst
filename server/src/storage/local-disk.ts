import { rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { isPhotoObjectKey } from './photo-keys.js'

export interface ObjectStorage {
  /** 删除不存在的对象也必须成功，以支持 at-least-once 重试。 */
  remove(objectKey: string): Promise<void>
}

export function resolveStorageObjectPath(root: string, objectKey: string): string {
  // 与上传白名单共用同一个键形状（含 8.4c 的 items/{0-8} 槽位）。
  // 注意这里刻意不校验归属：清理任务是系统身份在跑，键从队列取，
  // 形状合法即代表「由本系统的上传接口写过」，可以删。
  if (!isPhotoObjectKey(objectKey)) throw new Error('图片清理任务包含非法对象键')
  const rootPath = resolve(root)
  const target = resolve(rootPath, ...objectKey.split('/'))
  const rel = relative(rootPath, target)
  if (rel === '' || rel.startsWith('..')) throw new Error('图片清理路径越界')
  return target
}

export class LocalDiskStorage implements ObjectStorage {
  constructor(private readonly root: string) {}

  async remove(objectKey: string): Promise<void> {
    await rm(resolveStorageObjectPath(this.root, objectKey), { force: true })
  }
}
