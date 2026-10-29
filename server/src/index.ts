/**
 * 工科影展 API 服务（Fastify）。
 *
 * 设计原则：
 *   1) 所有数据访问经 withRls —— RLS 上下文永不丢失
 *   2) 错误统一成 { code, message }，与前端 AppError 对齐
 *   3) 图片走静态目录，不经过数据库
 */
import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { resolve } from 'node:path'
import { healthCheck } from './lib/db.js'
import { ApiError, forbidden, translateDbError } from './lib/errors.js'
import { TRUSTED_ORIGINS, TRUST_PROXY } from './lib/config.js'
import { registerRequestSecurity } from './lib/request-security.js'
import { registerRestrictionGuard } from './lib/restrictions.js'
import { registerRoutes } from './routes/index.js'
import { registerStorageRoutes } from './routes/storage.js'
import { StorageCleanupWorker } from './storage/cleanup-worker.js'
import { LocalDiskStorage } from './storage/local-disk.js'

const PORT = Number(process.env.PORT ?? 3001)
const HOST = process.env.HOST ?? '127.0.0.1'

/** 图片根目录：按需求放在 E:\lst-测试图片 */
const IMAGE_ROOT = process.env.IMAGE_ROOT ?? 'E:\\lst-测试图片'

export async function buildApp() {
  const imageRoot = resolve(IMAGE_ROOT)
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport:
        process.env.NODE_ENV === 'production'
          ? undefined
          : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
    },
    // 请求体上限：图片走独立上传接口，这里只处理 JSON
    bodyLimit: 1 * 1024 * 1024,
    trustProxy: TRUST_PROXY,
  })

  await app.register(cookie)
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, context) => ({
      code: 'RATE_LIMIT',
      message: '操作过于频繁，请稍后重试',
      details: { retryAfterSeconds: Math.ceil(context.ttl / 1000) },
    }),
  })
  await app.register(cors, {
    origin(origin, cb) {
      if (!origin || TRUSTED_ORIGINS.has(origin)) return cb(null, true)
      return cb(forbidden('请求来源不受信任'), false)
    },
    credentials: true,
  })
  registerRequestSecurity(app)
  // 处罚分级守卫（0026）：0015 的 api_create_session 曾对 suspension/ban 直接拒绝登录，
  // 导致受限用户无法进入申诉；现在改为"登录放行、按分级只拦写操作"。
  // 必须放在 registerRequestSecurity 之后：Origin/CSRF 是纯 header 校验，先做零成本的，
  // 再做需要查库的分级判定。
  registerRestrictionGuard(app)

  // ---- 统一错误处理 ----
  app.setErrorHandler((err, req, reply) => {
    // 业务错误
    if (err instanceof ApiError) {
      req.log.warn({ code: err.code, url: req.url }, err.message)
      return reply.status(err.status).send({
        code: err.code,
        message: err.message,
        details: err.details,
      })
    }

    // 数据库错误翻译（RLS 拒绝、唯一冲突等）
    const dbErr = translateDbError(err)
    if (dbErr) {
      req.log.warn({ code: dbErr.code, url: req.url }, dbErr.message)
      return reply.status(dbErr.status).send({
        code: dbErr.code,
        message: dbErr.message,
        details: dbErr.details,
      })
    }

    // 参数校验错误（Fastify schema）
    if ((err as { validation?: unknown }).validation) {
      return reply.status(400).send({
        code: 'VALIDATION',
        message: '请求参数不合法',
        details: (err as { validation?: unknown }).validation,
      })
    }

    // 未知错误：记录完整栈，但不外泄细节
    req.log.error({ err, url: req.url }, '未处理的服务端错误')
    return reply.status(500).send({
      code: 'INTERNAL',
      message: '服务器内部错误',
      // 开发环境附上原因，便于排查；生产环境不外泄
      details:
        process.env.NODE_ENV === 'production'
          ? undefined
          : err instanceof Error
            ? err.message
            : String(err),
    })
  })

  // 404
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      code: 'NOT_FOUND',
      message: `接口不存在：${req.method} ${req.url}`,
    })
  })

  // ---- 健康检查 ----
  app.get('/api/health', async () => {
    const db = await healthCheck()
    return {
      ok: db.ok,
      db,
      uptime: process.uptime(),
      now: new Date().toISOString(),
    }
  })

  // ---- 图片静态服务 ----
  // 访问 /images/photos/xxx/display.webp → E:\lst-测试图片\photos\xxx\display.webp
  await app.register(fastifyStatic, {
    root: IMAGE_ROOT,
    prefix: '/images/',
    // 图片内容不变，可长期缓存；改名即换 key，天然防缓存穿透
    cacheControl: true,
    maxAge: '30d',
    // 不允许目录列表
    list: false,
    index: false,
  })

  // ---- 业务路由 ----
  await registerStorageRoutes(app, imageRoot)
  await registerRoutes(app)

  // 数据库事务只负责软撤回和可靠入队；对象存储删除在提交后由 worker 异步执行。
  const cleanupWorker = new StorageCleanupWorker(new LocalDiskStorage(imageRoot), app.log)
  if (process.env.STORAGE_CLEANUP_ENABLED !== 'false') {
    cleanupWorker.start()
    app.addHook('onClose', async () => cleanupWorker.stop())
  }

  return app
}

/** 直接运行时启动服务 */
const isMain = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')
if (isMain) {
  buildApp()
    .then(async (app) => {
      await app.listen({ port: PORT, host: HOST })
      app.log.info(`图片目录: ${IMAGE_ROOT}`)
      app.log.info(`健康检查: http://${HOST}:${PORT}/api/health`)
    })
    .catch((err) => {
      console.error('启动失败:', err)
      process.exit(1)
    })
}

// 优雅退出：关闭连接池，避免残留连接
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    const { pool } = await import('./lib/db.js')
    await pool.end()
    process.exit(0)
  })
}

export { PORT, HOST }
