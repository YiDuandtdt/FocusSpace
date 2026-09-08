$ErrorActionPreference = 'Stop'
$entry = Join-Path $PSScriptRoot 'start.mjs'
$servers = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($entry) })
foreach ($server in $servers) { Stop-Process -Id $server.ProcessId }
Write-Host "Stopped $($servers.Count) FocusSpace LAN server(s). Saved data is retained."
