<#
  wu-scan.ps1 —— 扫描本机待安装的 Windows 更新（无需提权）
  用法: powershell -NoProfile -ExecutionPolicy Bypass -File wu-scan.ps1
  配套: 待安装清单 → scripts/wu-run-elevated.ps1 拉起提权安装（见同目录 SKILL.md）
#>
$ErrorActionPreference = 'Stop'
# 中文输出防乱码：控制台 / Git Bash 下强制 UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$session  = New-Object -ComObject Microsoft.Update.Session
$searcher = $session.CreateUpdateSearcher()
# 过滤条件：未安装 + 软件类（排除驱动）+ 排除被手动隐藏的更新
$result = $searcher.Search("IsInstalled=0 and Type='Software' and IsHidden=0")

Write-Host ("待安装更新: {0} 个" -f $result.Updates.Count)
$i = 0
foreach ($u in $result.Updates) {
    $i++
    Write-Host ("[{0}] {1}" -f $i, $u.Title)
    Write-Host ("    KB             : {0}" -f (($u.KBArticleIDs | ForEach-Object { "KB$_" }) -join ', '))
    Write-Host ("    MaxDownloadSize: {0:N0} MB （经常虚报；express 分发实际只下几百 MB~几 GB）" -f ($u.MaxDownloadSize / 1MB))
    # 注意：重启行为要从 InstallationBehavior.RebootBehavior 取（IUpdate.RebootBehavior 经 PS COM 适配器取出来是空）
    Write-Host ("    RebootBehavior : {0} （0=无需重启 1=可能要求重启 2=必须重启）" -f $u.InstallationBehavior.RebootBehavior)
    Write-Host ("    EulaAccepted   : {0}" -f $u.EulaAccepted)
}
Write-Host ""
Write-Host ("重启待定标志（装完未重启时为 True）:")
Write-Host ("  CBS RebootPending    : {0}" -f (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'))
Write-Host ("  WU   RebootRequired  : {0}" -f (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'))
Write-Host ("巡检平台口径（Get-HotFix = Win32_QuickFixEngineering）最近 5 条:")
Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 5 HotFixID, Description, InstalledOn | Format-Table -AutoSize
