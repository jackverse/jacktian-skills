<#
  wu-run-elevated.ps1 —— 非提权入口：弹 UAC 启动提权安装 payload，并轮询日志/心跳直到结束
  用法: powershell -NoProfile -ExecutionPolicy Bypass -File wu-run-elevated.ps1
  说明: 提权进程 stdout 无法回传，进度全部来自轮询 %TEMP%\wu-install\ 下的日志文件
#>
param(
    [string]$PayloadPath = (Join-Path $PSScriptRoot 'wu-install-elevated.ps1'),
    [string]$LogDir      = (Join-Path $env:TEMP 'wu-install')
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 清掉上一轮痕迹，避免误读旧日志
Remove-Item $LogDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

$log  = Join-Path $LogDir 'install.log'
$hb   = Join-Path $LogDir 'heartbeat.txt'
$done = Join-Path $LogDir 'INSTALL_DONE'

# UAC：-Verb RunAs 弹提权确认；用户点"否"时 Start-Process 直接抛异常
try {
    $proc = Start-Process powershell -Verb RunAs -PassThru -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PayloadPath, '-LogDir', $LogDir
    )
} catch {
    Write-Host "[ABORT] UAC 被拒绝或提权失败: $_"
    exit 1
}

$lastShown = 0
while ($true) {
    Start-Sleep -Seconds 15

    # 增量回显主日志
    if (Test-Path $log) {
        $lines = @(Get-Content $log -Encoding UTF8)
        if ($lines.Count -gt $lastShown) {
            $lines[$lastShown..($lines.Count - 1)] | ForEach-Object { Write-Host $_ }
            $lastShown = $lines.Count
        }
    }

    if (Test-Path $done) { Write-Host '[DONE] 安装流程正常结束（详见上方日志与 wu-scan.ps1 复扫验证）'; break }

    if ($proc.HasExited) {
        # 坑 3：宿主 powershell 被杀 ≠ 安装失败！真装的是 TrustedInstaller/TiWorker 服务。
        # 不要立刻重跑，先按 SKILL.md「验证真相三条」：Get-HotFix / 注册表 RebootPending / 复扫
        Write-Host '[WARN] 提权进程退出且未见 INSTALL_DONE —— 不代表安装失败，先跑 wu-scan.ps1 做 Get-HotFix/注册表/复扫三条验证'
        break
    }

    if ((Test-Path $hb) -and (((Get-Date) - (Get-Item $hb).LastWriteTime).TotalMinutes -gt 3)) {
        Write-Host '[WARN] 心跳超过 3 分钟未更新（心跳每 60s 覆写一次）——宿主可能已被杀，按坑 3 处理'
    }
}
