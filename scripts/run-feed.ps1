# Keeps one rh-feed Node process alive. Used by the RH-Feed scheduled task.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$logDir = Join-Path $repo "data"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "feed.log"

function Write-Log([string]$msg) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path $log -Value $line
}

function Stop-OldFeed {
  Get-NetTCPConnection -LocalPort 8788 -ErrorAction SilentlyContinue |
    ForEach-Object {
      try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
    }
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'rh-feed\\src\\server\.js|rh-feed.*src/server\.js' } |
    ForEach-Object {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
}

Stop-OldFeed
Start-Sleep -Seconds 1
Write-Log "starting rh-feed"

$node = (Get-Command node).Source
$proc = Start-Process -FilePath $node `
  -ArgumentList "src/server.js" `
  -WorkingDirectory $repo `
  -RedirectStandardOutput (Join-Path $logDir "feed-out.log") `
  -RedirectStandardError (Join-Path $logDir "feed-err.log") `
  -WindowStyle Hidden `
  -PassThru

Write-Log ("pid={0}" -f $proc.Id)

# Stay attached so Task Scheduler can restart us if we exit.
Wait-Process -Id $proc.Id
Write-Log ("exited pid={0} code={1}" -f $proc.Id, $proc.ExitCode)
exit $proc.ExitCode
