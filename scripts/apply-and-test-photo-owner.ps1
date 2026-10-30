param(
  [string]$Psql = 'D:\PostgreSQL\17\bin\psql.exe',
  [string]$HostName = '127.0.0.1',
  [int]$Port = 5432,
  [string]$Database = 'gongke',
  [string]$AdminUser = 'postgres',
  [string]$AdminPassword = $env:PGPASSWORD,
  [string]$AppUser = 'app_user',
  [string]$AppPassword = $env:APP_PGPASSWORD,
  # app_user 是集群级共享角色。本脚本为跑集成测试轮换它的口令，收尾必须还原，
  # 否则同机上正在运行的服务会在连接池重连时抛 28P01（表现为“登录没反应”）。
  [string]$RestoreAppPassword = $env:APP_PGPASSWORD_RESTORE,
  [string]$Node = 'C:\Users\maodan\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe',
  [string]$Pnpm = 'C:\Users\maodan\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($AdminPassword)) {
  throw 'Set PGPASSWORD or pass -AdminPassword before running this script.'
}
$env:PGPASSWORD = $AdminPassword

if (-not (Test-Path $Psql)) { throw "psql 不存在：$Psql" }
if (-not (Test-Path $Node)) { throw "node 不存在：$Node" }
if (-not (Test-Path $Pnpm)) { throw "pnpm 不存在：$Pnpm" }

# 每次在全新数据库验证完整迁移链，避免旧库状态掩盖重放缺陷。
$suffix = Get-Date -Format 'yyyyMMddHHmmssfff'
$testDatabase = $Database + '_p0_' + $suffix
$maintenanceDatabase = 'postgres'
$rotatedAppUser = $false

try {
  Write-Host "[database] create $testDatabase"
  & $Psql -X -h $HostName -p $Port -U $AdminUser -d $maintenanceDatabase -v ON_ERROR_STOP=1 -c "create database $testDatabase"
  if ($LASTEXITCODE -ne 0) { throw "测试数据库创建失败：$testDatabase" }

  $migrations = Get-ChildItem (Join-Path $PSScriptRoot '..\supabase\migrations') -Filter '*.sql' | Sort-Object Name
  foreach ($migration in $migrations) {
    Write-Host "[migration] $($migration.Name)"
    & $Psql -X -h $HostName -p $Port -U $AdminUser -d $testDatabase -v ON_ERROR_STOP=1 --single-transaction -f $migration.FullName
    if ($LASTEXITCODE -ne 0) { throw "迁移失败：$($migration.Name)" }
  }

  $test = Join-Path $PSScriptRoot '..\supabase\tests/test-photo-owner-api.sql'
  Write-Host '[test] test-photo-owner-api.sql'
  & $Psql -X -h $HostName -p $Port -U $AdminUser -d $testDatabase -v ON_ERROR_STOP=1 -f $test
  if ($LASTEXITCODE -ne 0) { throw '作品 owner-only SQL 回归失败' }

  # 图片清理队列必须以 app_user 身份验证：0020 把队列表从应用角色完全收回，
  # 而 worker 用的正是 app_user，用管理员身份跑是测不出来的。
  $cleanupTest = Join-Path $PSScriptRoot '..\supabase\tests/test-photo-storage-cleanup-app-role.sql'
  Write-Host '[test] test-photo-storage-cleanup-app-role.sql'
  & $Psql -X -h $HostName -p $Port -U $AdminUser -d $testDatabase -v ON_ERROR_STOP=1 -f $cleanupTest
  if ($LASTEXITCODE -ne 0) { throw '图片清理队列 app_user 边界回归失败' }

  if ([string]::IsNullOrWhiteSpace($AppPassword)) {
    $AppPassword = 'p0test-' + $suffix + '-SafePassword'
  }
  & $Psql -X -h $HostName -p $Port -U $AdminUser -d $maintenanceDatabase -v ON_ERROR_STOP=1 -c "alter role $AppUser login password '$($AppPassword.Replace("'", "''"))'"
  if ($LASTEXITCODE -ne 0) { throw 'app_user test password setup failed' }
  $rotatedAppUser = $true

  Write-Host '[test] Fastify cookie/CSRF/RLS/PostgreSQL integration'
  $savedPassword = $env:PGPASSWORD
  $env:PGHOST = $HostName
  $env:PGPORT = [string]$Port
  $env:PGDATABASE = $testDatabase
  $env:PGUSER = $AppUser
  $env:PGPASSWORD = $AppPassword
  $env:PGOPTIONS = '-c row_security=on'
  $env:PGADMIN_USER = $AdminUser
  $env:PGADMIN_PASSWORD = $AdminPassword
  $env:IP_HASH_SECRET = 'photo-owner-integration-secret-at-least-32-bytes'
  $env:IMAGE_ROOT = $env:TEMP
  Push-Location (Join-Path $PSScriptRoot '..\server')
  $savedPath = $env:PATH
  try {
    $env:PATH = (Split-Path $Node) + ';' + $savedPath
    & $Node $Pnpm run test:integration
    if ($LASTEXITCODE -ne 0) { throw 'real HTTP API integration failed' }
  }
  finally {
    Pop-Location
    $env:PATH = $savedPath
    $env:PGPASSWORD = $savedPassword
  }

  Write-Host '[OK] migrations, owner SQL, and real HTTP API integration passed'
}
finally {
  Write-Host "[database] drop $testDatabase"
  & $Psql -X -h $HostName -p $Port -U $AdminUser -d $maintenanceDatabase -v ON_ERROR_STOP=1 -c "drop database if exists $testDatabase with (force)"

  # 无论成功还是失败都要还原 app_user 口令：它属于集群，不属于这个临时库。
  # 漏掉这一步会让同机其它进程（含正在运行的服务）在重连时抛 28P01。
  if ($rotatedAppUser) {
    $restore = $RestoreAppPassword
    if ([string]::IsNullOrWhiteSpace($restore)) { $restore = 'appdev1234' }
    & $Psql -X -h $HostName -p $Port -U $AdminUser -d $maintenanceDatabase -v ON_ERROR_STOP=1 -c "alter role $AppUser login password '$($restore.Replace("'", "''"))'"
    if ($LASTEXITCODE -eq 0) {
      Write-Host "[database] $AppUser 口令已还原为本机文档值"
    }
    else {
      Write-Warning "[database] $AppUser 口令还原失败，请手动执行 alter role $AppUser login password '<本机文档值>'"
    }
  }

  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
