import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from '../server/node_modules/pg/lib/index.js'

const { Client } = pg
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const FRONTEND_PORT = 4190
const API_PORT = 4191
const DATABASE = `gongke_e2e_${process.pid}_${Date.now()}`
const REQUIRED = ['PGADMIN_PASSWORD', 'PGPASSWORD']
const missing = REQUIRED.filter((name) => !process.env[name]?.trim())
if (missing.length > 0) {
  console.error(`API E2E 未启动：缺少 ${missing.join(', ')}。请提供隔离 PostgreSQL 的管理员与 app_user 凭据。`)
  process.exit(2)
}

const adminUser = process.env.PGADMIN_USER?.trim() || 'postgres'
const appUser = process.env.PGUSER?.trim() || 'app_user'
const host = process.env.PGHOST?.trim() || '127.0.0.1'
const port = process.env.PGPORT?.trim() || '5432'
const adminConfig = {
  host,
  port: Number(port),
  database: process.env.PGADMIN_DATABASE?.trim() || 'postgres',
  user: adminUser,
  password: process.env.PGADMIN_PASSWORD,
}
const dbEnv = {
  ...process.env,
  PGHOST: host,
  PGPORT: port,
  PGDATABASE: DATABASE,
  PGUSER: appUser,
  PGPASSWORD: process.env.PGPASSWORD,
  PGADMIN_USER: adminUser,
  PGADMIN_PASSWORD: process.env.PGADMIN_PASSWORD,
}
const children = new Set()
let stopping = false

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT,
      env: options.env ?? process.env,
      stdio: options.stdio ?? 'inherit',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} ${args.join(' ')} 失败（code=${String(code)}, signal=${String(signal)}）`))
    })
  })
}

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    stdio: 'inherit',
    windowsHide: true,
  })
  children.add(child)
  child.once('exit', (code) => {
    children.delete(child)
    if (!stopping && code !== 0) {
      console.error(`${command} 意外退出（${String(code)}）`)
      void shutdown(1)
    }
  })
  return child
}

async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // 服务尚未监听，继续等待。
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
  }
  throw new Error(`等待服务超时：${url}`)
}

async function dropDatabase() {
  const admin = new Client(adminConfig)
  await admin.connect()
  try {
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()`,
      [DATABASE],
    )
    await admin.query(`drop database if exists ${DATABASE}`)
  } finally {
    await admin.end()
  }
}

async function shutdown(exitCode) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill('SIGTERM')
  children.clear()
  try {
    await dropDatabase()
  } catch (error) {
    console.error('删除 API E2E 临时库失败：', error)
    exitCode = 1
  }
  await rm(resolve(ROOT, '.tmp/api-e2e-images'), { recursive: true, force: true })
  process.exit(exitCode)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => void shutdown(0))
}

try {
  const admin = new Client(adminConfig)
  await admin.connect()
  try {
    await admin.query(`create database ${DATABASE}`)
  } finally {
    await admin.end()
  }

  const migrationClient = new Client({ ...adminConfig, database: DATABASE })
  await migrationClient.connect()
  try {
    const migrationDir = resolve(ROOT, 'supabase/migrations')
    const migrations = (await readdir(migrationDir)).filter((name) => name.endsWith('.sql')).sort()
    for (const name of migrations) {
      const sql = await readFile(resolve(migrationDir, name), 'utf8')
      await migrationClient.query(sql)
    }
  } finally {
    await migrationClient.end()
  }

  await run(process.execPath, ['--import', 'tsx', 'src/api-e2e-seed.ts'], {
    cwd: resolve(ROOT, 'server'),
    env: dbEnv,
  })

  await run(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), 'build'], {
    env: {
      ...process.env,
      VITE_DATA_SOURCE: 'api',
      VITE_API_BASE: `http://127.0.0.1:${API_PORT}`,
    },
  })

  await mkdir(resolve(ROOT, '.tmp/api-e2e-images'), { recursive: true })
  start(process.execPath, ['dist/index.js'], {
    cwd: resolve(ROOT, 'server'),
    env: {
      ...dbEnv,
      PORT: String(API_PORT),
      HOST: '127.0.0.1',
      TRUSTED_ORIGINS: `http://127.0.0.1:${FRONTEND_PORT}`,
      TURNSTILE_PROVIDER: 'off',
      STORAGE_CLEANUP_ENABLED: 'false',
      IMAGE_ROOT: resolve(ROOT, '.tmp/api-e2e-images'),
      IP_HASH_SECRET: 'api-e2e-only-secret-000000000000000000000000',
    },
  })
  await waitFor(`http://127.0.0.1:${API_PORT}/api/health`, 30_000)
  start(process.execPath, ['scripts/serve-dist.mjs', String(FRONTEND_PORT)])
  await waitFor(`http://127.0.0.1:${FRONTEND_PORT}/`, 30_000)
  console.log(`API E2E ready: http://127.0.0.1:${FRONTEND_PORT}`)
} catch (error) {
  console.error(error)
  await shutdown(1)
}
