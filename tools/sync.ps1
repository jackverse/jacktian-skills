# Link all skills into ZCode's skill directories:
#   Phase 1: skills/            (通用, cross-project)  -> user-level  ~/.zcode/skills
#   Phase 2: projects/<key>/<skill>/ (专用, per-project) -> <project>/.zcode/skills
#            each 专用 skill declares its project root in SKILL.md frontmatter:  project: <绝对路径>
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
    # Recursive: skills may live in category subdirs (skills/word/..., skills/frontend/vite/...);
    # junctions stay flat in ~/.zcode/skills, named by the skill directory name.
    foreach ($md in Get-ChildItem -Path $skillsSrc -Recurse -Filter "SKILL.md") {
        $skillDir = Split-Path -Parent $md.FullName
        $name = Split-Path -Leaf $skillDir
        $link = Join-Path $targetDir $name
        if (Test-Path $link) {
            $item = Get-Item $link
            if ($item.LinkType -eq "Junction") {
                $tgt = @($item.Target)[0]
                if ($tgt -eq $skillDir) {
                    Write-Host "[skip ] $name already linked"
                } elseif ($tgt -like "$skillsSrc*") {
                    Remove-Item $link -Force
                    New-Item -ItemType Junction -Path $link -Target $skillDir | Out-Null
                    Write-Host "[move ] $name retarget -> $skillDir"
                } else {
                    Write-Host "[warn ] $name junction points elsewhere, skipped: $link"
                }
            } else {
                Write-Host "[warn ] $name path exists and is not a junction, skipped: $link"
            }
            continue
        }
        New-Item -ItemType Junction -Path $link -Target $skillDir | Out-Null
        Write-Host "[link ] $name -> $link"
    }
}

# ---- Phase 2: project-scoped (专用) skills -> each project's .zcode/skills ----
$projectsSrc = Join-Path $repoRoot "projects"
if (Test-Path $projectsSrc) {
    foreach ($projDir in Get-ChildItem -Path $projectsSrc -Directory) {
        foreach ($skill in Get-ChildItem -Path $projDir.FullName -Directory) {
            $label = "$($projDir.Name)/$($skill.Name)"
            $skillMd = Join-Path $skill.FullName "SKILL.md"
            if (-not (Test-Path $skillMd)) { Write-Host "[warn ] ${label}: no SKILL.md, skipped"; continue }
            $head = (Get-Content $skillMd -TotalCount 20) -join "`n"
            $m = [regex]::Match($head, '(?m)^project:\s*(.+?)\s*$')
            if (-not $m.Success) { Write-Host "[warn ] ${label}: frontmatter missing 'project:', skipped"; continue }
            $projectRoot = [Environment]::ExpandEnvironmentVariables($m.Groups[1].Value.Trim())
            if (-not (Test-Path $projectRoot)) { Write-Host "[warn ] ${label}: project not found: $projectRoot, skipped"; continue }
            $targetDir = Join-Path $projectRoot ".zcode\skills"
            if (-not (Test-Path $targetDir)) {
                New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
                Write-Host "[mkdir] $targetDir"
            }
            $link = Join-Path $targetDir $skill.Name
            if (Test-Path $link) {
                $item = Get-Item $link
                if ($item.LinkType -eq "Junction" -and $item.Target -contains $skill.FullName) {
                    Write-Host "[skip ] ${label} already linked"
                } else {
                    Write-Host "[warn ] ${label}: path exists and is not a link to this repo, skipped: $link"
                }
                continue
            }
            New-Item -ItemType Junction -Path $link -Target $skill.FullName | Out-Null
            Write-Host "[link ] ${label} -> $link"
        }
    }
}

# Sync AGENTS.md: repo is the source of truth, copy to user-level (~/.zcode/AGENTS.md).
# (File symlinks on Windows require admin; junctions are directories-only, so copy.)
$agentsSrc = Join-Path $repoRoot "AGENTS.md"
$agentsDst = Join-Path $env:USERPROFILE ".zcode\AGENTS.md"
if (Test-Path $agentsSrc) {
    Copy-Item $agentsSrc $agentsDst -Force
    Write-Host "[copy ] AGENTS.md -> $agentsDst"
}
Write-Host "Done."
