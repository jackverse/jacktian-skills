# usb-disk-not-detected: read-only diagnostic template.
# Pure ASCII on purpose: PS 5.1 decodes BOM-less UTF-8 as ANSI (GBK) and
# mangles non-ASCII -> parse errors. Run with -File, never inline -Command
# from bash ($_ gets expanded by the shell).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File diagnose.ps1
#   powershell -ExecutionPolicy Bypass -File diagnose.ps1 -InstanceId 'USB\VID_xxxx&PID_yyyy\serial'
#   powershell -ExecutionPolicy Bypass -File diagnose.ps1 -Since '2026-11-12 09:00'
#   powershell -ExecutionPolicy Bypass -File diagnose.ps1 -ReportFile '%TEMP%\usb-diag-report.txt'
#     (on Chinese Windows, event messages piped through bash garble; the
#      UTF-8 report file written by PS itself stays correct -- read it
#      with a file reader, not the console)

[CmdletBinding()]
param(
    [string]$InstanceId,
    [DateTime]$Since,
    [string]$ReportFile
)

$ErrorActionPreference = 'Continue'

# Safe inside a pure-ASCII script: affects data/messages only, not code.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

# All output goes through W()/WTable() so a -ReportFile copy (UTF-8) is
# written alongside the console output.
function W([string]$text) {
    Write-Host $text
    if ($ReportFile) { Add-Content -LiteralPath $ReportFile -Value $text -Encoding UTF8 }
}
function Section($title) {
    W ""
    W ("===== " + $title + " =====")
}
function WTable($fmtObj) {
    if ($null -ne $fmtObj) { W (($fmtObj | Out-String).TrimEnd()) }
}

# --- Step 1: disks and volumes ---------------------------------------------
Section "1. Get-Disk / Get-Volume"
WTable (Get-Disk | Format-Table Number, FriendlyName, OperationalStatus, HealthStatus, Size -AutoSize)
WTable (Get-Volume | Format-Table DriveLetter, FileSystemLabel, SizeRemaining, Size -AutoSize)

# --- Step 2: problem PnP devices -------------------------------------------
Section "2. Problem PnP devices (Status not OK/Unknown)"
$problems = Get-PnpDevice -PresentOnly |
    Where-Object { $_.Status -notin @('OK', 'Unknown') }
if ($problems) {
    WTable ($problems | Format-Table Status, Class, FriendlyName, InstanceId -AutoSize)
} else {
    W "(none)"
}

# --- Step 3: ConfigManagerErrorCode per problem device ----------------------
# NOTE: Get-PnpDeviceProperty can fail with 0x80041008 on some Error-status
# devices; fall back to Win32_PnPEntity.ConfigManagerErrorCode (match in PS,
# never build a WQL filter from DeviceID -- backslash/quote escaping pain).
Section "3. ConfigManagerErrorCode"
$cimAll = Get-CimInstance Win32_PnPEntity
$rows = @()
foreach ($d in $problems) {
    $code = $null
    try {
        $code = (Get-PnpDeviceProperty -InstanceId $d.InstanceId `
            -KeyName 'DEVPKEY_Device_ConfigManagerErrorCode' -ErrorAction Stop).Data
    } catch {}
    if ($null -eq $code) {
        $m = $cimAll | Where-Object { $_.DeviceID -eq $d.InstanceId }
        if ($m) { $code = $m.ConfigManagerErrorCode }
    }
    $rows += [pscustomobject]@{
        Code  = $code
        Class = $d.Class
        Name  = $d.FriendlyName
        Id    = $d.InstanceId
    }
}
WTable ($rows | Format-Table -AutoSize)
W "Hint: Code 28 on an SES/enclosure child of a WD Elements & co. compound"
W "device is benign noise (SES carries no data, does not affect the disk"
W "LUN). The disk LUN itself starts with the in-box disk.inf (GenDisk) --"
W 'no vendor driver exists or is needed. ConfigFlags 0x40 ='
W "CONFIGFLAG_FAILEDINSTALL, NOT the DISABLED 0x1."
if (-not $problems) { W "(skipped, no problem devices)" }

# --- Step 4: registry policy layer ------------------------------------------
# NOTE: reg.exe needs '/v' and the value name as SEPARATE arguments; passing
# '/v Start' as one string is a syntax error. Run the FULL checklist before
# concluding "disabled by control software": installed security suites alone
# are not evidence -- every layer below must leave no trace.
Section "4. Registry policy layer (read-only)"
$regChecks = @(
    @{ Key = 'HKLM\SYSTEM\CurrentControlSet\Services\USBSTOR'; Args = @('/v', 'Start') },
    @{ Key = 'HKLM\SYSTEM\CurrentControlSet\Control\StorageDevicePolicies'; Args = @('/s') },
    @{ Key = 'HKLM\SOFTWARE\Policies\Microsoft\Windows\RemovableStorageDevices'; Args = @('/s') },
    @{ Key = 'HKLM\SOFTWARE\Policies\Microsoft\Windows\DeviceInstall\DenyDeviceIDs'; Args = @('/s') },
    @{ Key = 'HKLM\SOFTWARE\Policies\Microsoft\Windows\DeviceInstall\DenyDeviceClasses'; Args = @('/s') }
)
foreach ($rc in $regChecks) {
    W ("-- " + $rc.Key + " " + ($rc.Args -join ' '))
    $out = & reg.exe query $rc.Key @($rc.Args) 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $out) { W "   (absent or access denied)" }
    else { W (($out | Out-String).TrimEnd()) }
}

# --- Step 5: filter drivers on disk class / usb class -----------------------
Section "5. UpperFilters/LowerFilters on disk & usb classes"
$classKeys = @(
    'HKLM\SYSTEM\CurrentControlSet\Control\Class\{4D36E967-E325-11CE-BFC1-08002BE10318}',
    'HKLM\SYSTEM\CurrentControlSet\Control\Class\{36FC9E60-C465-11CF-8056-444553540000}'
)
foreach ($k in $classKeys) {
    W ("-- " + $k)
    foreach ($v in @('UpperFilters', 'LowerFilters')) {
        $out = & reg.exe query $k /v $v 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $out) { W ("   (no " + $v + ")") }
        else { W (($out | Out-String).TrimEnd()) }
    }
}

# --- Step 6: deep confirmation for a specific device -------------------------
if ($InstanceId) {
    Section "6. Deep check for $InstanceId"
    foreach ($key in @('DEVPKEY_Device_Service', 'DEVPKEY_Device_Driver', 'DEVPKEY_Device_Children')) {
        $v = (Get-PnpDeviceProperty -InstanceId $InstanceId -KeyName $key).Data
        W ("$key = " + $v)
    }
    $enumPath = 'HKLM\SYSTEM\CurrentControlSet\Enum\' + ($InstanceId -replace '\\', '\')
    W "-- Enum ConfigFlags"
    $out = & reg.exe query $enumPath /v ConfigFlags 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $out) { W "   (no ConfigFlags value)" }
    else { W (($out | Out-String).TrimEnd()) }
    W @"
Verdict hint: parent USB enumerated OK + USBSTOR\Disk child Status=OK /
IsPresent=True + disk.sys bound + NO partmgr child + Get-Disk has NO such
disk + platter not spinning = drive itself not ready (power/spin-up or
bridge/board hardware fault), NOT a software (disable/driver/policy) cause.
"PnP node OK" and "storage stack has a disk" are DIFFERENT things -- always
cross-check Get-Disk and DEVPKEY_Device_Children.
"@
} else {
    Section "6. Deep check (skipped: pass -InstanceId to inspect one device)"
}

# --- Step 7: Kernel-PnP/Configuration timeline -------------------------------
# Good substitute for setupapi.dev.log when it is wiped/disabled (managed
# machines). Ids: 400=configured, 410=started, 420=removed (includes user
# "remove device" from Settings), 430=needs further install, 442=settings
# not migrated. InstanceId text inside messages is ASCII, so regex matching
# works on localized (Chinese) Windows too.
if (-not $Since) { $Since = (Get-Date).AddDays(-3) }
Section ("7. Kernel-PnP/Configuration timeline since " + $Since.ToString('yyyy-MM-dd HH:mm'))
$pattern = 'USBSTOR|USB\\VID_'
if ($InstanceId) { $pattern = $pattern + '|' + [regex]::Escape($InstanceId) }
$ev = $null
try {
    $ev = Get-WinEvent -FilterHashtable @{
        LogName   = 'Microsoft-Windows-Kernel-PnP/Configuration'
        StartTime = $Since
    } -ErrorAction Stop
} catch {
    W "(no events in range or log unavailable)"
}
if ($ev) {
    $wanted = @($ev | Where-Object {
        $_.Id -in @(400, 410, 420, 430, 442) -and $_.Message -match $pattern
    } | Sort-Object TimeCreated)
    if ($wanted.Count -eq 0) {
        W "(no USB-storage related Kernel-PnP events in range)"
    } else {
        foreach ($e in ($wanted | Select-Object -First 300)) {
            $lines = $e.Message -split "`r?`n"
            $devLine = $lines | Where-Object { $_ -match $pattern } | Select-Object -First 1
            if (-not $devLine) { $devLine = $lines | Select-Object -First 1 }
            W ("{0}  Id={1}  {2}" -f $e.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss'), $e.Id, $devLine.Trim())
        }
        W ""
        W "Verdict hint: a 410 (disk.inf started) on a PREVIOUS day proves the"
        W "device worked before; today only a parent arrival with no USBSTOR"
        W "/disk 410 and no media arrival = drive not ready -> hardware."
        W "Stop chasing software causes. Id 420 = device removed (also shown"
        W "when someone clicks remove in Settings)."
    }
}
W ""
W "Noise note (System log): Schannel 36871 TLS errors (proxy software),"
W "service start-type flapping 7040 (e.g. Lenovo PCManager vs Defender),"
W "and Hyper-V/FilterManager boot events are background noise -- filter by"
W "'after insertion time' + storage-related provider."

Section "Done (all read-only, nothing was changed)"
