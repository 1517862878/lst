#!/usr/bin/env node
/**
 * 跨平台迁移执行器（Linux 云主机上用这个，不用 supabase/run-migrations.ps1）。
 *
 * 为什么要单独写一个：
 *   - run-migrations.ps1 依赖 Windows 上的 psql.exe 与 PowerShell，云主机上没有；
 *   - 迁移文件里有 psql 的元命令（`\encoding UTF8`），Node 的 pg 不认，必须剔除；
 *   - 每个文件要落在**独立事务**里：任一失败即回滚该文件并停止，绝不半途留脏。
 *
 * 幂等性来自迁移文件本身（全部写成 if not exists / create or replace / drop ... if exists），
 * 所以这里不做版本登记表 —— 重复执行是安全的，也就不需要额外维护一张
 * schema_migrations 表（它会连带影响 supabase/verify-schema.sh 的期望值）。
 *
 * 用法（在仓库根目录）：
 *   PGPASSWORD='...' node scripts/apply-migrations.mjs
 *   PGPASSWORD='...' node scripts/apply-migrations.mjs --dry-run
 *   PGPASSWORD='...' node scripts/apply-migrations.mjs --from 20261029002500
 *   PGPASSWORD='...' node scripts/apply-migrations.mjs --create-db
 *
 * 连接参数走与 psql 相同的 PG* 环境变量（PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE），
 * 也可用同名长参数覆盖。
 */
import { createRequire } from 'node:module'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// pg 只装在 server/ 下（前端不需要数据库驱动），所以从 server 的依赖里解析。
const require = createRequire(new URL('../server/package.json', import.meta.url))
const { Client } = require('pg')

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')

function parseArgs(argv) {
  const opts = {
    host: process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? '',
    database: process.env.PGDATABASE ?? 'gongke',
    from: null,
    only: null,
    dryRun: false,
    createDb: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      i += 1
      if (i >= argv.length) throw new Error(`${arg} 后面缺少值`)
      return argv[i]
    }
    if (arg === '--host') opts.host = next()
    else if (arg === '--port') opts.port = Number(next())
    else if (arg === '--user') opts.user = next()
    else if (arg === '--password') opts.password = next()
    else if (arg === '--database') opts.database = next()
    else if (arg === '--from') opts.from = next()
    else if (arg === '--only') opts.only = next()
    else if (arg === '--dry-run') opts.dryRun = true
    else if (arg === '--create-db') opts.createDb = true
    else if (arg === '-h' || arg === '--help') opts.help = true
    else throw new Error(`未知参数：${arg}`)
  }
  return opts
}

function usage() {
  console.log(`用法：PGPASSWORD=... node scripts/apply-migrations.mjs [选项]

选项：
  --host <host>        默认 $PGHOST 或 127.0.0.1
  --port <port>        默认 $PGPORT 或 5432
  --user <role>        默认 $PGUSER 或 postgres（必须是能建表建函数的角色）
  --password <pwd>     默认 $PGPASSWORD
  --database <name>    默认 $PGDATABASE 或 gongke
  --from <前缀>        只跑文件名 >= 该前缀的迁移
  --only <前缀>        只跑文件名以该前缀开头的迁移
  --create-db          库不存在时先建库（连到 postgres 库执行）
  --dry-run            只列出将要执行的迁移，不连库
  -h, --help           显示本帮助`)
}

/** 迁移文件里的 psql 元命令（如 \encoding UTF8）Node 不认，剔除掉；同时去掉 BOM。 */
function sanitize(sql) {
  const withoutBom = sql.replace(/^\uFEFF/, '')
  return withoutBom
    .split('\n')
    .filter((line) => !/^\s*\\/.test(line))
    .join('\n')
}

function listMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    usage()
    return
  }

  let files = listMigrations()
  if (opts.from) files = files.filter((name) => name >= opts.from)
  if (opts.only) files = files.filter((name) => name.startsWith(opts.only))

  console.log(`迁移目录：${MIGRATIONS_DIR}`)
  console.log(`共 ${files.length} 个待执行文件`)
  for (const name of files) console.log(`  ${name}`)

  if (opts.dryRun) {
    console.log('\n--dry-run：未连接数据库，未执行任何语句')
    return
  }
  if (files.length === 0) {
    console.log('\n没有匹配的迁移文件，什么都没做')
    return
  }

  const base = {
    host: opts.host,
    port: opts.port,
    user: opts.user,
    password: opts.password,
  }

  if (opts.createDb) {
    const admin = new Client({ ...base, database: 'postgres' })
    await admin.connect()
    try {
      const found = await admin.query('select 1 from pg_database where datname = $1', [opts.database])
      if (found.rowCount === 0) {
        // 库名不能参数化，这里用标识符转义（双引号）而不是字符串拼接。
        const ident = `"${opts.database.replace(/"/g, '""')}"`
        await admin.query(`create database ${ident} encoding 'UTF8'`)
        console.log(`已创建数据库 ${opts.database}`)
      } else {
        console.log(`数据库 ${opts.database} 已存在，跳过创建`)
      }
    } finally {
      await admin.end()
    }
  }

  const client = new Client({ ...base, database: opts.database })
  await client.connect()
  const serverVersion = await client.query('show server_version')
  console.log(`\n已连接 ${opts.user}@${opts.host}:${opts.port}/${opts.database}（PostgreSQL ${serverVersion.rows[0].server_version}）`)

  let done = 0
  try {
    for (const name of files) {
      const sql = sanitize(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'))
      process.stdout.write(`--- ${name} ... `)
      try {
        await client.query('begin')
        await client.query(sql)
        await client.query('commit')
        done += 1
        console.log('OK')
      } catch (error) {
        await client.query('rollback').catch(() => {})
        console.log('失败')
        console.error(`\n[FAIL] ${name}`)
        console.error(`  ${error.message}`)
        if (error.position) console.error(`  位置：字符 ${error.position}`)
        if (error.hint) console.error(`  提示：${error.hint}`)
        console.error(`\n已在事务内回滚该文件；前面的 ${done} 个文件已提交，数据库处于可重跑状态。`)
        process.exitCode = 1
        return
      }
    }
  } finally {
    await client.end()
  }

  console.log(`\n全部 ${done} 个迁移执行成功。`)
}

main().catch((error) => {
  console.error(`[FAIL] ${error.message}`)
  process.exitCode = 1
})
