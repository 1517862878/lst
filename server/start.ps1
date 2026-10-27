# ============================================================================
# 启动后端 API 服务（含数据库检查）
#
# 用法：
#   powershell -File server/start.ps1
#   powershell -File server/start.ps1 -Port 3001
#
# 说明：本机 node 不在 PATH（DSH 捆绑运行时），脚本会自动探测常见位置。
# ============================================================================
param(
  [int]$Port = 3001,
  [string]$PgData = 'D:\PostgreSQL\pgdata',
  [string]$PgBin = 'D:\PostgreSQL\17\bin',
  [string]$DbUser = 'app_user',
  [string]$DbPassword = 'appdev1234',
  [string]$DbName = 'gongke',
  [string]$ImageRoot = 'E:\lst-测试图片'
)

$ErrorActionPreference = 'Continue'

# ---------------------------------------------------------------------------
# 定位 node 可执行文件
# ---------------------------------------------------------------------------
function FindNode {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $candidates = @(
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
    'C:\Program Files\nodejs\node.exe',
    'D:\nodejs\node.exe',
    'D:\Program Files\nodejs\node.exe',
    'C:\Users\maodan\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
  )
  foreach ($p in $candidates) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

$nodeExe = FindNode
if (-not $nodeExe) {
  Write-Host '[FAIL] 找不到 node，请安装 Node.js 或手动指定' -ForegroundColor Red
  exit 1
}
Write-Host "=== node: $nodeExe ===" -ForegroundColor DarkGray
& $nodeExe --version

# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '=== 1. 检查数据库 ===' -ForegroundColor Cyan
$listening = Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
  Write-Host '  数据库未运行，正在启动...' -ForegroundColor Yellow
  $pgctl = Join-Path $PgBin 'pg_ctl.exe'
  if (-not (Test-Path $pgctl)) {
    Write-Host "  [FAIL] 找不到 $pgctl" -ForegroundColor Red
    exit 1
  }
  & $pgctl -D $PgData -l (Join-Path $PgData 'server.log') -o '-p 5432' start 2>&1 |
    ForEach-Object { Write-Host "  $_" }
  Start-Sleep -Seconds 4
  $listening = Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue
  if (-not $listening) {
    Write-Host '  [FAIL] 数据库启动失败，日志：' -ForegroundColor Red
    Write-Host "         $(Join-Path $PgData 'server.log')"
    exit 1
  }
}
Write-Host '  数据库在线 ✓' -ForegroundColor Green

# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '=== 2. 检查图片目录 ===' -ForegroundColor Cyan
if (-not (Test-Path $ImageRoot)) {
  New-Item -ItemType Directory -Force -Path $ImageRoot | Out-Null
  Write-Host "  已创建 $ImageRoot" -ForegroundColor Green
} else {
  Write-Host "  $ImageRoot ✓" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
Write-Host ''
Write-Host "=== 3. 启动 API（端口 $Port）===" -ForegroundColor Cyan
Write-Host "  数据库角色: $DbUser（非超级用户，RLS 生效）"
Write-Host "  接口地址:   http://127.0.0.1:$Port/api"
Write-Host "  健康检查:   http://127.0.0.1:$Port/api/health"
Write-Host "  图片服务:   http://127.0.0.1:$Port/images/"
Write-Host ''

$env:PGUSER = $DbUser
$env:PGPASSWORD = $DbPassword
$env:PGDATABASE = $DbName
$env:PORT = "$Port"
$env:IMAGE_ROOT = $ImageRoot
$env:NODE_ENV = 'development'

Push-Location $PSScriptRoot
try {
  & $nodeExe node_modules/tsx/dist/cli.mjs src/index.ts
} finally {
  Pop-Location
}
