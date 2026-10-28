param(
  [string]$AdminPassword = 'pgdev1234',
  [string]$Psql = 'D:\PostgreSQL\17\bin\psql.exe'
)
$ErrorActionPreference = 'Stop'
$db = 'gongke_account_' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$env:PGPASSWORD = $AdminPassword
$root = Split-Path -Parent $PSScriptRoot
try {
  & $Psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "create database $db"
  if ($LASTEXITCODE -ne 0) { throw 'create database failed' }
  Get-ChildItem (Join-Path $root 'supabase\migrations\*.sql') | Sort-Object Name | ForEach-Object {
    & $Psql -h 127.0.0.1 -p 5432 -U postgres -d $db -v ON_ERROR_STOP=1 -f $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "migration failed: $($_.Name)" }
  }
  $migration = Join-Path $root 'supabase\migrations\20261028001800_account_center.sql'
  & $Psql -h 127.0.0.1 -p 5432 -U postgres -d $db -v ON_ERROR_STOP=1 -f $migration
  if ($LASTEXITCODE -ne 0) { throw 'account-center idempotent replay failed' }
  & $Psql -h 127.0.0.1 -p 5432 -U postgres -d $db -v ON_ERROR_STOP=1 -c "alter role app_user password 'app_user_test_password'"
  if ($LASTEXITCODE -ne 0) { throw 'configure app role failed' }
  $node = 'C:\Users\maodan\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
  $pnpm = 'C:\Users\maodan\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
  $env:PATH = (Split-Path $node) + ';' + $env:PATH
  $env:PGHOST = '127.0.0.1'; $env:PGPORT = '5432'; $env:PGDATABASE = $db
  $env:PGUSER = 'app_user'; $env:PGPASSWORD = 'app_user_test_password'
  $env:PGADMIN_USER = 'postgres'; $env:PGADMIN_PASSWORD = $AdminPassword
  $env:TRUSTED_ORIGINS = 'http://127.0.0.1:5173'
  $env:STORAGE_CLEANUP_ENABLED = 'false'
  Push-Location (Join-Path $root 'server')
  try {
    & $node $pnpm run test:integration
    if ($LASTEXITCODE -ne 0) { throw 'integration tests failed' }
  } finally { Pop-Location }
} finally {
  $env:PGPASSWORD = $AdminPassword
  & $Psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists $db with (force)"
}
