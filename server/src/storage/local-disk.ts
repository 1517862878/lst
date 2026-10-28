import { rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const STORAGE_KEY_RE = /^photos\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/(display|thumb)\.webp$/i

export interface ObjectStorage {
  /** 删除不存在的对象也必须成功，以支持 at-least-once 重试。 */
  remove(objectKey: string): Promise<void>
}

export function resolveStorageObjectPath(root: string, objectKey: string): string {
  if (!STORAGE_KEY_RE.test(objectKey)) throw new Error('图片清理任务包含非法对象键')
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
