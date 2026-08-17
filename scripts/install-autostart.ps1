# Always-on RH feed on this Windows box (no Docker / no GitHub Pages).
# Prefer: run elevated once for a crash-restarting scheduled task.
# Fallback: current-user Startup shortcut (no admin).
#
#   powershell -File scripts\install-autostart.ps1
#   powershell -File scripts\install-autostart.ps1 -Uninstall

param(
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$taskName = "RH-Feed"
$repo = Split-Path -Parent $PSScriptRoot
$startScript = Join-Path $PSScriptRoot "run-feed.ps1"
$startupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$startupCmd = Join-Path $startupDir "RH-Feed.cmd"

if (-not (Test-Path (Join-Path $repo ".env"))) {
  throw "Missing $repo\.env with OPENSEA_API_KEY"
}

function Remove-StartupShortcut {
  if (Test-Path $startupCmd) {
    Remove-Item $startupCmd -Force
    Write-Host "Removed Startup launcher $startupCmd"
  }
}

function Install-StartupShortcut {
  New-Item -ItemType Directory -Force -Path $startupDir | Out-Null
  $content = @"
@echo off
cd /d "$repo"
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$startScript"
"@
  Set-Content -Path $startupCmd -Value $content -Encoding ASCII
  Write-Host "Installed Startup launcher: $startupCmd"
}

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-StartupShortcut
  Write-Host "Autostart removed."
  exit 0
}

$taskOk = $false
try {
  $action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`"" `
    -WorkingDirectory $repo
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Force | Out-Null
  $taskOk = $true
  Write-Host "Registered scheduled task $taskName (logon + auto-restart)."
  Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
} catch {
  Write-Host "Scheduled task needs admin. Falling back to Startup folder."
  Install-StartupShortcut
}

if ($taskOk) {
  Remove-StartupShortcut
}

# Kick a run now either way.
Write-Host "Starting feed now..."
Start-Process -FilePath "powershell.exe" `
  -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`"" `
  -WorkingDirectory $repo
Start-Sleep -Seconds 3
Write-Host "HUD: http://localhost:8788"
Write-Host "LAN: http://10.0.0.2:8788  (run scripts\open-lan.ps1 as admin once for firewall)"
if (-not $taskOk) {
  Write-Host "Tip: re-run this script in an elevated PowerShell for crash auto-restart."
}
