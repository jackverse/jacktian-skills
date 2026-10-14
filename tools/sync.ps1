# Link all skills under skills/ into ZCode's user skill directory.
# Usage: powershell -ExecutionPolicy Bypass -File tools/sync.ps1
# Idempotent: existing links are skipped. Run once after cloning on a new machine.

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$skillsSrc = Join-Path $repoRoot "skills"
$targets = @(
    (Join-Path $env:USERPROFILE ".zcode\skills")
    # For cross-tool sharing (Claude Code etc.), uncomment:
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
                Write-Host "[skip ] $($skill.Name) already linked"
            } else {
                Write-Host "[warn ] $($skill.Name): path exists and is not a link to this repo, skipped: $link"
            }
            continue
        }
        New-Item -ItemType Junction -Path $link -Target $skill.FullName | Out-Null
        Write-Host "[link ] $($skill.Name) -> $link"
    }
}
Write-Host "Done."
