# 将仓库 skills/ 下的所有 skill 链接到 ZCode 用户级 skill 目录
# 用法: powershell -ExecutionPolicy Bypass -File tools/sync.ps1
# 幂等: 已存在的链接会跳过; 新机器 clone 后跑一次即可

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$skillsSrc = Join-Path $repoRoot "skills"
$targets = @(
    (Join-Path $env:USERPROFILE ".zcode\skills")
    # 如需跨工具(Claude Code 等)共用, 取消下一行注释:
    # (Join-Path $env:USERPROFILE ".agents\skills")
)

foreach ($targetDir in $targets) {
    if (-not (Test-Path $targetDir)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
        Write-Host "[mkdir] $targetDir"
    }
    foreach ($skill in Get-ChildItem -Path $skillsSrc -Directory) {
        $link = Join-Path $targetDir $skill.Name
        if (Test-Path $link) {
            $item = Get-Item $link
            if ($item.LinkType -eq "Junction" -and $item.Target -contains $skill.FullName) {
                Write-Host "[skip ] $($skill.Name) 已链接"
            } else {
                Write-Host "[warn ] $($skill.Name) 目标已存在且不是本仓库的链接, 跳过: $link"
            }
            continue
        }
        New-Item -ItemType Junction -Path $link -Target $skill.FullName | Out-Null
        Write-Host "[link ] $($skill.Name) -> $link"
    }
}
Write-Host "完成。"
