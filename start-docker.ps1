$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker was not found. Install Docker Desktop first, then run this script again."
}

$envFile = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envFile)) {
  $bytes = New-Object byte[] 12
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $token = -join ($bytes | ForEach-Object { $_.ToString("x2") })
  Set-Content -Path $envFile -Value "DOWNLOADER_TOKEN=$token" -Encoding ascii
} else {
  $token = ((Get-Content $envFile | Where-Object { $_ -match "^DOWNLOADER_TOKEN=" }) -replace "^DOWNLOADER_TOKEN=", "").Trim()
}

docker compose up --build -d

$addresses = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { -not $_.IPAddress.StartsWith("127.") -and $_.PrefixOrigin -ne "WellKnown" } |
  Select-Object -ExpandProperty IPAddress

Write-Host ""
Write-Host "Remote Downloader is starting on port 4173."
Write-Host "Open Docker Desktop if Windows asks for network/firewall permission."
Write-Host ""
Write-Host "Local URL:"
Write-Host "  http://localhost:4173/?token=$token"
Write-Host ""
Write-Host "Phone URL:"
if ($addresses) {
  foreach ($address in $addresses) {
    Write-Host "  http://${address}:4173/?token=$token"
  }
} else {
  Write-Host "  http://<this-laptop-ip>:4173/?token=$token"
}
Write-Host ""
Write-Host "Useful commands:"
Write-Host "  docker compose logs -f"
Write-Host "  docker compose down"
