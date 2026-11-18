# ============================================================================
#  clean.ps1 - Windows external device & wireless network trace cleaner
#  (USB storage / portable MTP devices / WiFi profiles / Bluetooth pairings /
#   known-network history / related event logs / setupapi logs / DNS cache)
#
#  Modes:
#    powershell -File clean.ps1                    -> read-only scan (default)
#    powershell -File clean.ps1 -Scan              -> read-only scan (explicit)
#    powershell -File clean.ps1 -All               -> wipe everything
#                                                     (incl. WiFi passwords and
#                                                      Bluetooth pairings)
#    powershell -File clean.ps1 -KeepWiFiPassword  -> wipe everything EXCEPT
#                                                     WiFi profiles/passwords
#    optional: -KeepBluetooth  -> skip Bluetooth unpair (a BT keyboard/mouse
#                                 would disconnect immediately if unpaired!)
#
#  Deleting needs admin. When run non-elevated with a delete switch, the
#  script relaunches ITSELF via UAC (Start-Process -Verb RunAs -Wait); the
#  elevated payload writes its results to %TEMP%\trace-clean\result-*.txt
#  which this non-elevated wrapper reads back after the UAC process exits
#  (stdout of an elevated process cannot be captured directly).
#
#  IMPORTANT: this file MUST stay PURE ASCII. Windows PowerShell 5.1 parses
#  BOM-less files as GBK/ANSI; Chinese comments in a BOM-less UTF-8 file
#  cause misleading syntax errors and the elevated process exits instantly
#  with no output at all.
# ============================================================================

param(
    [switch]$Scan,
    [switch]$All,
    [switch]$KeepWiFiPassword,
    [switch]$KeepBluetooth,
    [string]$ResultFile
)

$ErrorActionPreference = 'Continue'

$UsbStorRoot  = 'HKLM:\SYSTEM\CurrentControlSet\Enum\USBSTOR'
$BtRoot       = 'HKLM:\SYSTEM\CurrentControlSet\Services\BTHPORT\Parameters\Devices'
$PortableRoot = 'HKLM:\SOFTWARE\Microsoft\Windows Portable Devices\Devices'
$NetListRoot  = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\NetworkList'
$InfDir       = 'C:\Windows\INF'

# Event log channels that record device / wireless connection history
$EventChannels = @(
    'Microsoft-Windows-WLAN-AutoConfig/Operational',      # WiFi connect history (SSID + time)
    'Microsoft-Windows-NetworkProfile/Operational',
    'Microsoft-Windows-Kernel-PnP/Configuration',         # device connect/install history
    'Microsoft-Windows-Bluetooth-MtpEnum/Operational',
    'Microsoft-Windows-Bluetooth-BthLEEnum/Operational',
    'Microsoft-Windows-Bluetooth-Policy/Operational'
)

function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Log to console and (when set) to the result file the non-elevated wrapper reads back.
$script:LogFile = $null
function L([string]$msg) {
    Write-Host $msg
    if ($script:LogFile) { Add-Content -Path $script:LogFile -Value $msg -Encoding UTF8 }
}

# Locale-independent netsh wlan show profiles parsing: profile rows are
# indented (>=4 spaces) and contain " : <name>"; <None>/<placeholder> rows excluded.
function Get-WifiProfiles {
    $names = @()
    $raw = & netsh wlan show profiles 2>$null
    foreach ($line in $raw) {
        if ($line -match '^\s{4,}.*:\s*(.+?)\s*$') {
            $n = $Matches[1]
            if ($n -and ($n -notmatch '^<')) { $names += $n }
        }
    }
    return $names
}

function Decode-BtName([byte[]]$bytes) {
    if (-not $bytes -or $bytes.Length -eq 0) { return '' }
    try {
        $s = [Text.Encoding]::Unicode.GetString($bytes)   # Name value = UTF-16LE
        $i = $s.IndexOf([char]0)
        if ($i -ge 0) { $s = $s.Substring(0, $i) }
        return $s.Trim()
    } catch { return '' }
}

function Get-PresentUsbStorIds {
    $ids = @()
    try {
        $ids = @(Get-PnpDevice -PresentOnly -ErrorAction Stop |
                 Where-Object { $_.InstanceId -like 'USBSTOR\*' } |
                 ForEach-Object { $_.InstanceId })
    } catch {
        Write-Host ("  (note: Get-PnpDevice unavailable here: " + $_.Exception.Message + ")")
    }
    return $ids
}

# List subkeys of a registry key. Returns:
#   array of subkeys  -> readable
#   empty array       -> key exists but has no children
#   $null             -> exists but NOT readable in this session (ACL;
#                        some keys deny read to normal users, e.g.
#                        NetworkList\Profiles; Test-Path still returns True!)
function Get-SubKeys([string]$Path) {
    if (-not (Test-Path $Path)) { return ,@() }
    # @( ) INSIDE the comma-preserve: an empty key yields $null from the bare
    # pipeline, and ,($null) unwraps back to $null -> would fake "not readable"
    try { return ,@(Get-ChildItem -Path $Path -ErrorAction Stop) }
    catch { return $null }
}

function Show-SubKeys([string]$Path, [string]$Indent = '    ') {
    $keys = Get-SubKeys $Path
    if ($null -eq $keys) { Write-Host ($Indent + "(key exists but not readable without admin rights)") }
    elseif ($keys.Count -eq 0) { Write-Host ($Indent + "(none)") }
    return $keys
}

# ---------------------------------------------------------------- scan (read-only)
function Invoke-Scan {
    Write-Host "================ READ-ONLY SCAN ================"
    Write-Host ("Machine: " + $env:COMPUTERNAME + "    Admin session: " + (Test-IsAdmin))

    Write-Host ""
    Write-Host "[1] WiFi profiles (each one contains the saved password)"
    $wp = @(Get-WifiProfiles)
    if ($wp.Count -eq 0) { Write-Host "    (none)" }
    foreach ($n in $wp) { Write-Host ("    - " + $n) }

    Write-Host ""
    Write-Host "[2] Bluetooth pairings (BTHPORT Parameters\Devices)"
    $keys = Show-SubKeys $BtRoot
    if ($null -ne $keys) {
        foreach ($k in $keys) {
            $nm = ''
            try { $nm = Decode-BtName ([byte[]](Get-ItemProperty -Path $k.PSPath -Name Name -ErrorAction Stop).Name) } catch { $nm = '' }
            Write-Host ("    - " + $k.PSChildName + "   " + $nm)
        }
    }

    Write-Host ""
    Write-Host "[3] USB storage history (Enum\USBSTOR)"
    $present = Get-PresentUsbStorIds
    $devs = Show-SubKeys $UsbStorRoot
    if ($null -ne $devs) {
        foreach ($d in $devs) {
            $inst = @(Get-ChildItem $d.PSPath -ErrorAction SilentlyContinue)
            $online = @($present | Where-Object { $_ -like ($d.PSChildName + '\*') })
            $mark = ''
            if ($online.Count -gt 0) { $mark = "   [ONLINE NOW - will be re-created, not history]" }
            Write-Host ("    - " + $d.PSChildName + "  (instances: " + $inst.Count + ")" + $mark)
        }
    }

    Write-Host ""
    Write-Host "[4] Portable devices / phones, MTP (Windows Portable Devices\Devices)"
    $pds = Show-SubKeys $PortableRoot
    if ($null -ne $pds) {
        foreach ($p in $pds) {
            $fn = $p.PSChildName
            try {
                $v = (Get-ItemProperty -Path $p.PSPath -Name FriendlyName -ErrorAction Stop).FriendlyName
                if ($v) { $fn = $v }
            } catch { }
            Write-Host ("    - " + $fn + "   [" + $p.PSChildName + "]")
        }
    }

    Write-Host ""
    Write-Host "[5] Known networks (NetworkList\Profiles + Signatures\Unmanaged)"
    $nlP = Join-Path $NetListRoot 'Profiles'
    $nlS = Join-Path $NetListRoot 'Signatures\Unmanaged'
    $nets = Show-SubKeys $nlP
    if ($null -ne $nets) {
        foreach ($n in $nets) {
            $pn = $n.PSChildName
            try {
                $v = (Get-ItemProperty -Path $n.PSPath -Name ProfileName -ErrorAction Stop).ProfileName
                if ($v) { $pn = $v }
            } catch { }
            Write-Host ("    - " + $pn)
        }
    }
    $sig = Get-SubKeys $nlS
    if ($null -eq $sig) { Write-Host "    + unmanaged signatures: key exists but not readable without admin rights" }
    else { Write-Host ("    + " + $sig.Count + " unmanaged network signature subkeys") }

    Write-Host ""
    Write-Host "[6] Related event logs (record counts; some may need admin to read)"
    foreach ($ch in $EventChannels) {
        try {
            $log = Get-WinEvent -ListLog $ch -ErrorAction Stop
            $rc = $log.RecordCount
            if ($null -eq $rc) { $rc = '?' }   # some channels report null metadata
            Write-Host ("    - " + $ch + " : " + $rc + " records")
        } catch {
            Write-Host ("    - " + $ch + " : n/a (" + $_.Exception.Message.Trim() + ")")
        }
    }

    Write-Host ""
    Write-Host "[7] Device install logs (C:\Windows\INF\setupapi*.log)"
    $logs = @(Get-ChildItem -Path (Join-Path $InfDir 'setupapi*.log') -ErrorAction SilentlyContinue)
    if ($logs.Count -eq 0) { Write-Host "    (none)" }
    foreach ($f in $logs) {
        Write-Host ("    - " + $f.Name + "  " + [math]::Round($f.Length / 1KB, 1) + " KB")
    }

    Write-Host ""
    Write-Host "================================================"
    Write-Host "Scan finished. Nothing was modified."
}

# ---------------------------------------------------------------- delete (elevated)
function Invoke-Clean {
    param([bool]$DeleteWifiProfiles, [bool]$DeleteBluetooth)

    L "=========== ELEVATED TRACE CLEAN ==========="
    L ("Started: " + (Get-Date))

    # --- 1) WiFi profiles ---
    if ($DeleteWifiProfiles) {
        $before = @(Get-WifiProfiles).Count
        $null = & netsh wlan delete profile name="*" i="*" 2>&1
        $code = $LASTEXITCODE
        Start-Sleep -Milliseconds 500
        $after = @(Get-WifiProfiles).Count
        # netsh prints localized GBK text that may look garbled; judge by the profile list
        L ("[WiFi] deleted profiles: exit=" + $code + ", before/after=" + $before + "/" + $after + " (garbled netsh output is normal)")
    } else {
        L "[WiFi] skipped (WiFi profiles / passwords kept)"
    }

    # --- 2) Bluetooth pairings ---
    if ($DeleteBluetooth) {
        $ok = 0; $fail = 0
        if (Test-Path $BtRoot) {
            foreach ($k in @(Get-ChildItem $BtRoot -ErrorAction SilentlyContinue)) {
                try {
                    Remove-Item -Path $k.PSPath -Recurse -Force -ErrorAction Stop
                    $ok++
                } catch {
                    $fail++
                    # IMPORTANT: in catch $_ is an ErrorRecord, not a pipeline item;
                    # $k.PSChildName still works here, error text is $_.Exception.Message
                    L ("  [BT-FAIL] " + $k.PSChildName + " : " + $_.Exception.Message)
                }
            }
        }
        L ("[Bluetooth] removed " + $ok + " pairing keys, failed " + $fail)
    } else {
        L "[Bluetooth] skipped (-KeepBluetooth; paired devices stay connected)"
    }

    # --- 3) USB storage history ---
    # Enum\USBSTOR is read-only even for Administrators. PS Remove-Item fails with a
    # MISLEADING "key does not exist"; reg.exe shows the real error (access denied).
    # Taking ownership + granting FullControl still does not allow deletion.
    # Working solution: run reg delete as SYSTEM via a scheduled task.
    $taskName = 'TraceCleanUsbStor'
    if (Test-Path $UsbStorRoot) {
        $null = & schtasks /create /tn $taskName /ru SYSTEM /sc once /st 23:59 /f /tr 'cmd /c reg delete HKLM\SYSTEM\CurrentControlSet\Enum\USBSTOR /f' 2>&1
        if ($LASTEXITCODE -ne 0) {
            L ("[USBSTOR] FAILED to create SYSTEM scheduled task (exit " + $LASTEXITCODE + ")")
        } else {
            $null = & schtasks /run /tn $taskName 2>&1
            $deadline = (Get-Date).AddSeconds(30)     # /run is async, poll for the key to vanish
            while ((Test-Path $UsbStorRoot) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 300 }
            $null = & schtasks /delete /tn $taskName /f 2>&1
            if (-not (Test-Path $UsbStorRoot)) {
                # recreate an empty USBSTOR parent key so PnP finds its expected node
                $null = & reg add 'HKLM\SYSTEM\CurrentControlSet\Enum\USBSTOR' /f 2>&1
                L "[USBSTOR] parent key deleted via SYSTEM scheduled task: OK, empty parent key recreated"
            } else {
                L "[USBSTOR] still present after SYSTEM task - see SKILL.md pitfalls section"
            }
        }
    } else {
        L "[USBSTOR] key not found (nothing to clean)"
    }

    # --- 4) Portable devices / phones (MTP) ---
    $ok = 0; $fail = 0
    if (Test-Path $PortableRoot) {
        foreach ($k in @(Get-ChildItem $PortableRoot -ErrorAction SilentlyContinue)) {
            try { Remove-Item -Path $k.PSPath -Recurse -Force -ErrorAction Stop; $ok++ }
            catch { $fail++; L ("  [PD-FAIL] " + $k.PSChildName + " : " + $_.Exception.Message) }
        }
    }
    L ("[PortableDevices] removed " + $ok + " keys, failed " + $fail)

    # --- 5) Known networks ---
    # Deleting with normal user rights is SILENTLY rejected (0 keys removed);
    # elevated admin works. Profiles AND Signatures\Unmanaged must both go.
    $okP = 0; $okS = 0; $fail = 0
    $nlP = Join-Path $NetListRoot 'Profiles'
    $nlS = Join-Path $NetListRoot 'Signatures\Unmanaged'
    foreach ($k in @(Get-ChildItem $nlP -ErrorAction SilentlyContinue)) {
        try { Remove-Item -Path $k.PSPath -Recurse -Force -ErrorAction Stop; $okP++ }
        catch { $fail++; L ("  [NL-FAIL] " + $k.PSChildName + " : " + $_.Exception.Message) }
    }
    foreach ($k in @(Get-ChildItem $nlS -ErrorAction SilentlyContinue)) {
        try { Remove-Item -Path $k.PSPath -Recurse -Force -ErrorAction Stop; $okS++ }
        catch { $fail++; L ("  [NL-SIG-FAIL] " + $k.PSChildName + " : " + $_.Exception.Message) }
    }
    L ("[NetworkList] removed " + $okP + " profiles + " + $okS + " signatures, failed " + $fail)

    # --- 6) Event logs ---
    foreach ($ch in $EventChannels) {
        $null = & wevtutil cl $ch 2>&1
        if ($LASTEXITCODE -eq 0) { L ("[EventLog] cleared " + $ch) }
        else { L ("[EventLog] FAILED " + $ch + " (exit " + $LASTEXITCODE + "; channel may not exist on this system - tolerated)") }
    }

    # --- 7) setupapi device install logs ---
    $del = 0; $fail = 0
    foreach ($f in @(Get-ChildItem -Path (Join-Path $InfDir 'setupapi*.log') -ErrorAction SilentlyContinue)) {
        try { Remove-Item -Path $f.FullName -Force -ErrorAction Stop; $del++ }
        catch { $fail++; L ("  [INF-FAIL] " + $f.Name + " : " + $_.Exception.Message) }
    }
    L ("[SetupApi] deleted " + $del + " log files, failed " + $fail + " (setupapi.setup.log is TrustedInstaller-protected if it failed)")

    # --- 8) DNS cache ---
    $null = & ipconfig /flushdns 2>&1
    L "[DNS] cache flushed"

    L ("Finished: " + (Get-Date))
    L "=========== DONE ==========="
}

# ---------------------------------------------------------------- main
if ($All -and $KeepWiFiPassword) {
    Write-Host "ERROR: -All and -KeepWiFiPassword are mutually exclusive."
    exit 1
}

$wantsDelete = ($All -or $KeepWiFiPassword)

if (-not $wantsDelete) {
    # default / -Scan : read-only scan, no elevation needed, repeatable
    Invoke-Scan
    exit 0
}

if (-not (Test-IsAdmin)) {
    # Relaunch self elevated. stdout of the elevated process cannot be captured,
    # so the payload writes to a result file this wrapper reads back afterwards.
    if (-not $ResultFile) {
        $dir = Join-Path $env:TEMP 'trace-clean'
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $ResultFile = Join-Path $dir ('result-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')
    }
    Write-Host "Deleting needs admin rights. A UAC prompt will appear..."
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $PSCommandPath))
    if ($All) { $argList += '-All' } else { $argList += '-KeepWiFiPassword' }
    if ($KeepBluetooth) { $argList += '-KeepBluetooth' }
    $argList += '-ResultFile'
    $argList += ('"{0}"' -f $ResultFile)
    try {
        # UAC cancel raises an exception here -> exit != 0, that is the normal path
        $p = Start-Process powershell -Verb RunAs -PassThru -Wait -ArgumentList $argList
        Write-Host ("Elevated process exit code: " + $p.ExitCode)
    } catch {
        Write-Host ("ERROR: UAC cancelled or elevation failed: " + $_.Exception.Message)
        exit 1
    }
    if (Test-Path $ResultFile) {
        Write-Host "---------------- result from elevated process ----------------"
        Get-Content -Path $ResultFile -Encoding UTF8
        Write-Host "----------------------------------------------------------------"
    } else {
        Write-Host "WARNING: no result file found (elevated payload crashed? see SKILL.md ASCII pitfall)"
    }
    # final read-only verification, still in this non-elevated session
    Write-Host ""
    Invoke-Scan
    exit 0
}

# already elevated: run inline, log to console + result file
if ($ResultFile) {
    $script:LogFile = $ResultFile
    if (-not (Test-Path $script:LogFile)) { New-Item -ItemType File -Path $script:LogFile -Force | Out-Null }
}
Invoke-Clean -DeleteWifiProfiles ([bool]$All) -DeleteBluetooth (-not $KeepBluetooth)
exit 0
