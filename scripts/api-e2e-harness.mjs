import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from '../server/node_modules/pg/lib/index.js'

const { Client } = pg
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
// 注意：4190 属于 WHATWG / undici 的“禁止端口”（bad port）。
// fetch、Playwright 与浏览器都会直接拒绝它，而该 TCP 端口本身是通的，
// 于是表现为等待 30 秒后一句“等待服务超时”，极难定位 —— 端口必须避开下面这份名单。
const FRONTEND_PORT = 4192
const API_PORT = 4191

const BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6679, 6697, 10080,
])
for (const [name, value] of [
  ['FRONTEND_PORT', FRONTEND_PORT],
  ['API_PORT', API_PORT],
]) {
  if (BLOCKED_PORTS.has(value)) {
    console.error(`${name}=${value} 属于 fetch 与浏览器禁止的端口（WHATWG bad port），请改用其它端口。`)
    process.exit(2)
  }
}
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

/**
 * 清理上次中断留下的临时库。
 *
 * Playwright 停掉 webServer 时是硬杀进程树，SIGTERM 处理函数可能根本没机会跑，
 * 于是每次中断都会在集群里留下一个 gongke_e2e_<pid>_<ts>。只回收明显过期的
 * （默认 1 小时），避免误删正在并行运行的那一个。
 */
async function dropStaleDatabases(admin) {
  const { rows } = await admin.query(`select datname from pg_database where datname like 'gongke\\_e2e\\_%'`)
  const cutoff = Date.now() - 60 * 60 * 1000
  for (const { datname } of rows) {
    if (datname === DATABASE) continue
    const match = /^gongke_e2e_\d+_(\d+)$/.exec(datname)
    if (!match || Number(match[1]) > cutoff) continue
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()`,
      [datname],
    )
    await admin.query(`drop database if exists ${datname}`)
    console.log(`[database] 已回收上次中断留下的 ${datname}`)
  }
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

/**
 * 预检 app_user 凭据是否可用。
 *
 * 本仓库的 .ps1 脚本会轮换集群级角色 app_user 的密码，而它是共享的：另一个进程
 * （甚至另一个正在运行的服务）可能刚把它改掉。不预检的话，服务照样能启动、健康检查
 * 也照样通过（复用了启动时建立的连接），直到某个请求触发连接池重连，才在业务里抛
 * 28P01 并返 500 —— 表现为“登录没反应”，极难定位。
 */
async function verifyAppUserCredentials() {
  const client = new Client({
    host,
    port: Number(port),
    database: adminConfig.database,
    user: appUser,
    password: process.env.PGPASSWORD,
  })
  await client.connect()
  try {
    await client.query('select 1')
  } finally {
    await client.end()
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

/**
 * 迁移文件是写给 psql 的，而这里通过 pg 客户端执行，psql 元命令不是 SQL。
 * 目前实际存在的只有首行的 `\encoding UTF8`（4 个文件），直接执行会得到
 * `语法错误 在 "\" 或附近的`。
 *
 * 这里只丢掉元命令行，并保留空行以维持报错行号；
 * 一旦出现 `\i` / `\ir` 这类会包含其它脚本的命令就直接失败 ——
 * 宁可中止，也不能悄悄漏跑一段迁移。
 */
function stripPsqlMetaCommands(sql, name) {
  const lines = sql.split(/\r?\n/)
  const kept = lines.map((line) => {
    if (!/^\s*\\/.test(line)) return line
    const command = line.trim().split(/\s+/)[0].toLowerCase()
    if (['\\i', '\\ir', '\\include', '\\include_relative'].includes(command)) {
      throw new Error(`${name} 含有 ${command}，harness 不依赖 psql 时无法执行，请改用 psql 跑迁移`)
    }
    return ''
  })
  return kept.join('\n')
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => void shutdown(0))
}

try {
  try {
    await verifyAppUserCredentials()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `app_user 凭据预检失败：PGUSER=${appUser} 的 PGPASSWORD 当前无法登录 ${host}:${port}。` +
        `该角色密码是集群级的、会被本仓库的 .ps1 脚本轮换，请先把它恢复成预期值。（原始错误：${detail}）`,
    )
  }

  const admin = new Client(adminConfig)
  await admin.connect()
  try {
    await dropStaleDatabases(admin)
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
      await migrationClient.query(stripPsqlMetaCommands(sql, name))
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
