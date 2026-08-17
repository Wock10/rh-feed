$ErrorActionPreference = "Stop"
$Port = 8788
$Name = "RH feed LAN"

$existing = Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Firewall rule already exists: $Name"
} else {
  New-NetFirewallRule -DisplayName $Name `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort $Port `
    -Action Allow `
    -Profile Private,Domain | Out-Null
  Write-Host "Opened inbound TCP $Port for other PCs on this network."
}

$ips = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.PrefixOrigin -ne "WellKnown" } |
  Select-Object -ExpandProperty IPAddress

Write-Host "On this PC:  http://localhost:$Port"
foreach ($ip in $ips) {
  Write-Host "On the LAN:  http://${ip}:$Port"
}
Write-Host "Open that LAN URL on the other PC. Do not use GitHub Pages for the always-open tab."
