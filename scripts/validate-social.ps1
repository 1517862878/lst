# Social graph (0022) validation script.
#
# Same shape as validate-account-center.ps1:
#   1) create a throwaway database and apply every migration in filename order;
#   2) replay 0022 twice to prove the migration is idempotent (append-only);
#   3) set the app_user test password, then run typecheck + integration tests.
#
# NOTES
#  * ASCII only on purpose: Windows PowerShell 5.1 reads .ps1 as ANSI unless the
#    file carries a UTF-8 BOM, and non-ASCII bytes break the parser.
#  * $ErrorActionPreference stays 'Continue': psql writes NOTICEs ("extension
#    already exists") to stderr and PowerShell would otherwise treat that as a
#    fatal NativeCommandError. Every call is checked via $LASTEXITCODE instead.
#
# Usage (bypassing the execution policy):
#   powershell -ExecutionPolicy Bypass -File scripts\validate-social.ps1
param(
  [string]$AdminPassword = 'pgdev1234',
  # app_user is a cluster-wide shared role. This script rotates its password to run
  # the integration tests, so it must restore it afterwards; otherwise a service
  # already running on this machine fails with 28P01 when its pool reconnects.
  [string]$RestoreAppPassword = $env:APP_PGPASSWORD_RESTORE,
  [string]$Psql = 'D:\PostgreSQL\17\bin\psql.exe'
)
$ErrorActionPreference = 'Continue'
$db = 'gongke_social_' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$env:PGPASSWORD = $AdminPassword
$root = Split-Path -Parent $PSScriptRoot
$rotatedAppUser = $false

# psql flags are passed as an array: '-h' etc. would otherwise bind as
# Invoke-Psql parameters.
function Invoke-Psql([string[]]$PsqlArgs) {
  $errFile = [System.IO.Path]::GetTempFileName()
  & $Psql @PsqlArgs 2>$errFile
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    Get-Content $errFile | Where-Object { $_ -notmatch 'NOTICE' } | ForEach-Object { Write-Host $_ }
  }
  Remove-Item $errFile -ErrorAction SilentlyContinue
  if ($code -ne 0) { throw "psql failed: $($PsqlArgs -join ' ')" }
}

function Psql-Args([string]$database) {
  return @('-h', '127.0.0.1', '-p', '5432', '-U', 'postgres', '-d', $database, '-v', 'ON_ERROR_STOP=1')
}

try {
  Invoke-Psql ((Psql-Args 'postgres') + @('-c', "create database $db"))

  $applied = 0
  Get-ChildItem (Join-Path $root 'supabase\migrations\*.sql') | Sort-Object Name | ForEach-Object {
    Invoke-Psql ((Psql-Args $db) + @('-q', '-f', $_.FullName))
    Write-Host "applied $($_.Name)"
    $applied++
  }
  if ($applied -lt 20) { throw "only $applied migrations found - wrong working tree?" }

  $migration = Join-Path $root 'supabase\migrations\20261028002200_social_graph.sql'
  foreach ($round in 1..2) {
    Invoke-Psql ((Psql-Args $db) + @('-q', '-f', $migration))
    Write-Host "social-graph replay #$round OK"
  }

  Invoke-Psql ((Psql-Args $db) + @('-c', "alter role app_user password 'app_user_test_password'"))
  Write-Host "app_user password configured"
  $rotatedAppUser = $true

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
    & $node $pnpm run typecheck 2>&1 | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) { throw 'typecheck failed' }
    Write-Host 'typecheck OK'
    & $node $pnpm run test:integration 2>&1 | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) { throw 'integration tests failed' }
    Write-Host 'integration tests OK'
  } finally { Pop-Location }
} finally {
  $env:PGPASSWORD = $AdminPassword
  try { Invoke-Psql ((Psql-Args 'postgres') + @('-c', "drop database if exists $db with (force)")) } catch { Write-Host $_ }

  # The role password lives on the cluster, not in the throwaway database,
  # so restore it whether or not the tests passed.
  if ($rotatedAppUser) {
    $restore = $RestoreAppPassword
    if ([string]::IsNullOrWhiteSpace($restore)) { $restore = 'appdev1234' }
    try {
      Invoke-Psql ((Psql-Args 'postgres') + @('-c', "alter role app_user login password '$($restore.Replace("'", "''"))'"))
      Write-Host 'app_user password restored to the local documented value'
    } catch { Write-Host "app_user password restore failed: $_" }
  }
}
