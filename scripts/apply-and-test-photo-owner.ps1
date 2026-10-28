param(
  [string]$Psql = 'D:\PostgreSQL\17\bin\psql.exe',
  [string]$HostName = '127.0.0.1',
  [int]$Port = 5432,
  [string]$Database = 'gongke',
  [string]$AdminUser = 'postgres',
  [string]$AdminPassword = $env:PGPASSWORD,
  [string]$AppUser = 'app_user',
  [string]$AppPassword = $env:APP_PGPASSWORD,
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

  $test = Join-Path $PSScriptRoot '..\supabase\test-photo-owner-api.sql'
  Write-Host '[test] test-photo-owner-api.sql'
  & $Psql -X -h $HostName -p $Port -U $AdminUser -d $testDatabase -v ON_ERROR_STOP=1 -f $test
  if ($LASTEXITCODE -ne 0) { throw '作品 owner-only SQL 回归失败' }

  if ([string]::IsNullOrWhiteSpace($AppPassword)) {
    $AppPassword = 'p0test-' + $suffix + '-SafePassword'
  }
  & $Psql -X -h $HostName -p $Port -U $AdminUser -d $maintenanceDatabase -v ON_ERROR_STOP=1 -c "alter role $AppUser login password '$($AppPassword.Replace("'", "''"))'"
  if ($LASTEXITCODE -ne 0) { throw 'app_user test password setup failed' }

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
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
