/** 本地磁盘图片上传。文件名与目录均由服务端根据登录用户生成，禁止客户端提供路径。 */
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, relative, resolve } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { requireUser } from '../lib/auth.js'
import { ApiError, forbidden, validation } from '../lib/errors.js'
import { parsePhotoImageKey } from '../storage/photo-keys.js'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

function bytesOf(body: unknown): Buffer {
  if (Buffer.isBuffer(body)) return body
  if (body instanceof Uint8Array) return Buffer.from(body)
  throw validation('请求体必须是 WebP 图片')
}

function isWebp(bytes: Buffer): boolean {
  return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
}

export async function registerStorageRoutes(app: FastifyInstance, imageRoot: string) {
  app.addContentTypeParser('image/webp', { parseAs: 'buffer', bodyLimit: MAX_IMAGE_BYTES }, (_req, body, done) => {
    done(null, body)
  })

  app.put<{ Params: { '*': string } }>(
    '/api/storage/*',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (req) => {
    const user = await requireUser(req)
    if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'image/webp') {
      throw validation('Content-Type 必须是 image/webp')
    }
    const key = req.params['*']
    // 白名单：旧单图路径与 8.4c 的组照槽位路径都放行，形状之外的键一律 400。
    const parsed = parsePhotoImageKey(key)
    if (!parsed) throw validation('图片键格式不正确')
    if (parsed.userId !== user.userId.toLowerCase()) {
      throw forbidden('不能上传到其他用户的目录')
    }

    const bytes = bytesOf(req.body)
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw validation('图片大小必须在 1B–10MB 之间')
    if (!isWebp(bytes)) throw validation('只接受有效的 WebP 图片')

    const target = resolve(imageRoot, ...key.split('/'))
    const rel = relative(imageRoot, target)
    if (rel.startsWith('..') || rel === '') throw forbidden('图片路径越界')

    await mkdir(dirname(target), { recursive: true })
    const temp = `${target}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, bytes, { flag: 'wx', mode: 0o640 })
      await copyFile(temp, target, fsConstants.COPYFILE_EXCL)
      await rm(temp, { force: true })
    } catch (err) {
      await rm(temp, { force: true }).catch(() => undefined)
      throw new ApiError('STORAGE', '图片写入磁盘失败', err instanceof Error ? err.message : String(err))
    }

    return { key, size: bytes.length }
    },
  )
}
