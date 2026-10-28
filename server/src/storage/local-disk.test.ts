import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { LocalDiskStorage, resolveStorageObjectPath } from './local-disk.js'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const PHOTO_ID = '22222222-2222-4222-8222-222222222222'
const KEY = `photos/${USER_ID}/${PHOTO_ID}/display.webp`

test('LocalDiskStorage.remove 对重复删除保持幂等', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gongke-storage-'))
  try {
    const target = resolveStorageObjectPath(root, KEY)
    await mkdir(join(root, 'photos', USER_ID, PHOTO_ID), { recursive: true })
    await writeFile(target, 'image')

    const storage = new LocalDiskStorage(root)
    await storage.remove(KEY)
    await storage.remove(KEY)
    await assert.rejects(readFile(target), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('resolveStorageObjectPath 拒绝越界及非图片键', () => {
  assert.throws(() => resolveStorageObjectPath('images', '../secret'), /非法对象键/)
  assert.throws(() => resolveStorageObjectPath('images', `photos/${USER_ID}/${PHOTO_ID}/original.jpg`), /非法对象键/)
})
