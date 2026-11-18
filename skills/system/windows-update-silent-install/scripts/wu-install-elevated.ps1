<#
  wu-install-elevated.ps1 —— 提权 payload：逐个下载并安装待安装的 Windows 更新
  由 wu-run-elevated.ps1 以 -Verb RunAs 启动，自己独立运行时需已在管理员会话中。
  提权进程 stdout 无法回传 → 全程 Add-Content 写日志文件，主会话轮询。

  日志约定（默认 %TEMP%\wu-install\，可 -LogDir 覆盖）:
    install.log    主日志（payload 增量写）
    heartbeat.txt  心跳：进程内 runspace 每 60s 覆写一次，证明宿主进程还活着
    INSTALL_DONE   完成标记（含汇总；宿主进程被杀时不会出现 → 见 SKILL.md 坑 3）
#>
param([string]$LogDir = (Join-Path $env:TEMP 'wu-install'))

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$log   = Join-Path $LogDir 'install.log'
$hb    = Join-Path $LogDir 'heartbeat.txt'
$done  = Join-Path $LogDir 'INSTALL_DONE'

function Log([string]$msg) {
    Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg) -Encoding UTF8
}

# ---- 心跳线程：进程内独立 runspace，不被主线程的阻塞 COM 调用拖住 ----
# 宿主进程一死心跳必然停止 —— 这正是主会话判定"宿主死亡"的依据
$hbPs = [powershell]::Create().AddScript({
    param($p)
    while ($true) {
        Set-Content -Path $p -Value (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') -Encoding UTF8
        Start-Sleep -Seconds 60
    }
}).AddArgument($hb)
[void]$hbPs.BeginInvoke()

Log ("PID={0} 扫描开始" -f $PID)
$session  = New-Object -ComObject Microsoft.Update.Session
$searcher = $session.CreateUpdateSearcher()
$result = $searcher.Search("IsInstalled=0 and Type='Software' and IsHidden=0")
Log ("待安装 {0} 个" -f $result.Updates.Count)

foreach ($u in $result.Updates) {
    if (-not $u.EulaAccepted) { $u.AcceptEula(); Log ("AcceptEula: " + $u.Title) }

    # 按 update 逐个下载安装：单个失败不拖垮整批，日志能定位到具体更新
    $one = New-Object -ComObject Microsoft.Update.UpdateColl
    [void]$one.Add($u)

    $downloader = $session.CreateUpdateDownloader()
    $downloader.Updates = $one
    Log ("下载开始: " + $u.Title)
    $dres = $downloader.Download()          # 阻塞调用
    Log ("下载结束 ResultCode={0} （2=成功 3=成功有错误 4=失败）" -f $dres.ResultCode)

    if ($dres.ResultCode -eq 4) { Log ("下载失败，跳过安装该更新: " + $u.Title); continue }

    $installer = $session.CreateUpdateInstaller()
    $installer.Updates = $one
    Log ("安装开始: " + $u.Title)
    $ires = $installer.Install()            # 阻塞调用；大体积 LCU 上宿主进程可能在此直接消失（SKILL.md 坑 3，不代表失败）
    Log ("安装结束 ResultCode={0} RebootRequired={1}" -f $ires.ResultCode, $ires.RebootRequired)
}

# COM 安装天然不触发重启：只置 RebootRequired 标志，重启由用户自行挑时间
$rebootPending = (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending') -or `
                 (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired')
Log ("全部处理完成; 重启待定标志: {0}" -f $rebootPending)
Set-Content -Path $done -Value ("finished at " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) -Encoding UTF8
