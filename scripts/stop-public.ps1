$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$marker = Join-Path $projectRoot '.tmp/public-tunnel.log'
$publicEnv = Join-Path $projectRoot '.tmp/public.env'
$entry = Join-Path $PSScriptRoot 'start.mjs'
$processes = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and (
        ($_.Name -eq 'cloudflared.exe' -and $_.CommandLine.Contains($marker)) -or
        ($_.Name -eq 'node.exe' -and $_.CommandLine.Contains($entry) -and $_.CommandLine.Contains($publicEnv))
    )
}
foreach ($process in $processes) { Stop-Process -Id $process.ProcessId -ErrorAction SilentlyContinue }
Write-Host 'Public sharing stopped. Saved data retained. Use Start-FocusSpace.cmd for LAN access.'
