# ============================================================================
# 按文件名顺序执行全部迁移（用于本地自托管 Postgres 验证）
#
# 用法（在项目根目录）：
#   $env:PGPASSWORD='你的密码'
#   powershell -File supabase/run-migrations.ps1 -Psql "D:\PostgreSQL\17\bin\psql.exe"
#
# 说明：
#   - 每个文件在【单独事务】里执行；任一失败即停止并报告是哪个文件
#   - 顺序由文件名前缀决定（00000000000000_ 兼容层永远最先跑）
#   - 幂等：迁移本身都用了 if not exists / or replace，可重复执行
# ============================================================================
param(
  [string]$Psql = 'D:\PostgreSQL\17\bin\psql.exe',
  [string]$DbName = 'gongke',
  [string]$HostName = '127.0.0.1',
  [string]$Port = '5432',
  [string]$User = 'postgres',
  [switch]$CreateDb
)

$ErrorActionPreference = 'Stop'
$migDir = Join-Path $PSScriptRoot 'migrations'

if (-not (Test-Path $Psql)) {
  Write-Host "[FAIL] 找不到 psql: $Psql" -ForegroundColor Red
  Write-Host "       请确认 PostgreSQL 安装路径，或用 -Psql 指定" -ForegroundColor Yellow
  exit 1
}

Write-Host "=== psql: $Psql ===" -ForegroundColor Cyan
& $Psql --version

# 建库（可选）
if ($CreateDb) {
  Write-Host "`n=== 创建数据库 $DbName ===" -ForegroundColor Cyan
  & $Psql -h $HostName -p $Port -U $User -d postgres -v ON_ERROR_STOP=1 `
    -c "select 1 from pg_database where datname='$DbName'" -t -A | ForEach-Object {
    if ($_ -ne '1') {
      & $Psql -h $HostName -p $Port -U $User -d postgres -v ON_ERROR_STOP=1 `
        -c "create database $DbName encoding 'UTF8'"
      Write-Host "  已创建 $DbName" -ForegroundColor Green
    } else {
      Write-Host "  已存在 $DbName，跳过" -ForegroundColor Yellow
    }
  }
}

# 按序执行
$files = Get-ChildItem -Path $migDir -Filter '*.sql' | Sort-Object Name
Write-Host "`n=== 发现 $($files.Count) 个迁移文件 ===" -ForegroundColor Cyan
$files | ForEach-Object { Write-Host "  $($_.Name)" }

$failed = @()
foreach ($f in $files) {
  Write-Host "`n--- 执行 $($f.Name) ---" -ForegroundColor Cyan
  $out = & $Psql -h $HostName -p $Port -U $User -d $DbName `
    -v ON_ERROR_STOP=1 --single-transaction -f $f.FullName 2>&1
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    Write-Host "[FAIL] $($f.Name) 退出码 $code" -ForegroundColor Red
    $out | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    $failed += $f.Name
    break
  } else {
    $out | Where-Object { $_ -match 'ERROR|WARNING' } | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
    Write-Host "  [OK]" -ForegroundColor Green
  }
}

Write-Host "`n=== 结果 ===" -ForegroundColor Cyan
if ($failed.Count -eq 0) {
  Write-Host "全部 $($files.Count) 个迁移执行成功" -ForegroundColor Green
} else {
  Write-Host "失败文件: $($failed -join ', ')" -ForegroundColor Red
  exit 1
}
