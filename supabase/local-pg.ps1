# ============================================================================
# 本地便携版 PostgreSQL 初始化（免管理员权限）
#
# 作用：把解压出来的 pg17 目录变成可用的单机数据库实例。
#   1) initdb 建数据目录（若不存在）
#   2) 调整 postgresql.conf 监听本地端口
#   3) 启动服务并验证连接
#
# 用法：
#   powershell -File supabase/local-pg.ps1 -Action init
#   powershell -File supabase/local-pg.ps1 -Action start
#   powershell -File supabase/local-pg.ps1 -Action stop
#   powershell -File supabase/local-pg.ps1 -Action status
# ============================================================================
param(
  [ValidateSet('init', 'start', 'stop', 'status', 'reset')]
  [string]$Action = 'status',
  [string]$PgRoot = 'D:\PostgreSQL\pg17',
  [string]$DataDir = 'D:\PostgreSQL\pgdata',
  [string]$Port = '5432',
  [string]$Password = 'pgdev1234'
)

$ErrorActionPreference = 'Stop'

$bin = Join-Path $PgRoot 'bin'
$initdb = Join-Path $bin 'initdb.exe'
$pgctl = Join-Path $bin 'pg_ctl.exe'
$psql = Join-Path $bin 'psql.exe'

function Assert-Pg {
  if (-not (Test-Path $initdb)) {
    Write-Host "[FAIL] 找不到 $initdb" -ForegroundColor Red
    Write-Host "       请先解压便携版到 $PgRoot" -ForegroundColor Yellow
    exit 1
  }
}

switch ($Action) {
  'init' {
    Assert-Pg
    if (Test-Path (Join-Path $DataDir 'PG_VERSION')) {
      Write-Host "数据目录已存在，跳过 initdb：$DataDir" -ForegroundColor Yellow
    } else {
      Write-Host "=== initdb：$DataDir ===" -ForegroundColor Cyan
      New-Item -ItemType Directory -Force -Path (Split-Path $DataDir -Parent) | Out-Null
      # --auth=scram-sha-256 现代默认；-E UTF8 保证中文正常
      & $initdb -D $DataDir -U postgres --pwfile = $null -E UTF8 --auth=scram-sha-256 2>&1 |
        Where-Object { $_ -notmatch '^\s*$' } | ForEach-Object { Write-Host "  $_" }
      if ($LASTEXITCODE -ne 0) { exit 1 }
    }

    # 设置超级用户密码（initdb 的 --pwfile 需要文件，这里改用 ALTER ROLE）
    Write-Host "`n=== 配置 postgresql.conf ===" -ForegroundColor Cyan
    $conf = Join-Path $DataDir 'postgresql.conf'
    $content = Get-Content $conf -Raw
    # 只监听本机，避免暴露到局域网
    $content = $content -replace "(?m)^#?\s*listen_addresses\s*=.*$", "listen_addresses = '127.0.0.1'"
    $content = $content -replace "(?m)^#?\s*port\s*=.*$", "port = $Port"
    # 时区固定上海，与前端一致
    $content = $content -replace "(?m)^#?\s*timezone\s*=.*$", "timezone = 'Asia/Shanghai'"
    Set-Content -Path $conf -Value $content -Encoding utf8
    Write-Host "  listen_addresses=127.0.0.1, port=$Port, timezone=Asia/Shanghai" -ForegroundColor Green

    Write-Host "`n=== 启动 ===" -ForegroundColor Cyan
    & $pgctl -D $DataDir -l (Join-Path $DataDir 'server.log') -o "-p $Port" start 2>&1 |
      ForEach-Object { Write-Host "  $_" }
    Start-Sleep -Seconds 2

    Write-Host "`n=== 设置 postgres 密码 ===" -ForegroundColor Cyan
    $env:PGPASSWORD = ''
    & $psql -h 127.0.0.1 -p $Port -U postgres -d postgres -v ON_ERROR_STOP=1 `
      -c "alter user postgres with password '$Password'" 2>&1 | ForEach-Object { Write-Host "  $_" }
    Write-Host "  密码已设置" -ForegroundColor Green
  }

  'start' {
    Assert-Pg
    & $pgctl -D $DataDir -l (Join-Path $DataDir 'server.log') -o "-p $Port" start 2>&1 |
      ForEach-Object { Write-Host "  $_" }
  }

  'stop' {
    Assert-Pg
    & $pgctl -D $DataDir stop -m fast 2>&1 | ForEach-Object { Write-Host "  $_" }
  }

  'status' {
    Assert-Pg
    & $pgctl -D $DataDir status 2>&1 | ForEach-Object { Write-Host "  $_" }
    $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($c) { Write-Host "端口 $Port 监听中 pid=$($c.OwningProcess -join ',')" -ForegroundColor Green }
    else { Write-Host "端口 $Port 未监听" -ForegroundColor Yellow }
  }

  'reset' {
    Assert-Pg
    Write-Host "=== 停止并删除数据目录 ===" -ForegroundColor Yellow
    & $pgctl -D $DataDir stop -m fast 2>&1 | Out-Null
    if (Test-Path $DataDir) { Remove-Item -Recurse -Force $DataDir }
    Write-Host "已删除 $DataDir，可重新 -Action init" -ForegroundColor Green
  }
}
