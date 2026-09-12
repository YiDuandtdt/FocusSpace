param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
. (Join-Path $PSScriptRoot 'read-shared-log.ps1')
. (Join-Path $PSScriptRoot 'check-health.ps1')
$tunnel = $null
$server = $null
try {
    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    $npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source
    if (!(Test-Path .env)) { Copy-Item .env.example .env }
    $portText = & $nodePath -e "const fs=require('node:fs'),u=require('node:util');console.log(Number(u.parseEnv(fs.readFileSync('.env','utf8')).PORT||3001))"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read application port.' }
    $port = [int]$portText
    if ($port -lt 1 -or $port -gt 65535) { throw 'Invalid PORT in .env.' }
    $entry = Join-Path $PSScriptRoot 'start.mjs'
    $tunnelLog = Join-Path $projectRoot '.tmp/public-tunnel.log'
    $activeTunnel = Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($tunnelLog) }
    if ($activeTunnel) { throw 'Public sharing is already running. Use Stop-Public-FocusSpace.cmd before restarting. The last URL is in .tmp/public-url.txt.' }
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    foreach ($listener in $listeners) {
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
        if (!$owner -or !$owner.CommandLine -or !$owner.CommandLine.Contains($entry)) { throw "Port $port belongs to another service. Stop that service first." }
    }
    New-Item -ItemType Directory -Path '.tmp/tools' -Force | Out-Null
    $client = Join-Path $projectRoot '.tmp/tools/cloudflared.exe'
    $checksum = '83e726ed18ea78c5ad5213c4c3a3a27051393950d2bc8ed4de69bec12d14eaae'
    if (!(Test-Path $client) -or (Get-FileHash $client -Algorithm SHA256).Hash.ToLowerInvariant() -ne $checksum) {
        Write-Host 'Downloading the official free Cloudflare Tunnel client...'
        Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/cloudflare/cloudflared/releases/download/2026.8.3/cloudflared-windows-amd64.exe' -OutFile $client -TimeoutSec 120
        if ((Get-FileHash $client -Algorithm SHA256).Hash.ToLowerInvariant() -ne $checksum) { throw 'Client checksum mismatch.' }
    }
    if (!(Test-Path apps/server/dist/index.js) -or !(Test-Path apps/web/dist/index.html)) {
        if (!(Test-Path node_modules/.bin/prisma.cmd)) { & $npmPath ci; if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' } }
        & $npmPath run setup
        if ($LASTEXITCODE -ne 0) { throw 'Setup failed.' }
        & $npmPath run build
        if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    }
    [System.IO.File]::WriteAllText($tunnelLog, '')
    $tunnel = Start-Process $client -WindowStyle Hidden -ArgumentList "tunnel --protocol http2 --no-autoupdate --url http://127.0.0.1:$port --logfile `"$tunnelLog`"" -RedirectStandardOutput '.tmp/public-tunnel-out.log' -RedirectStandardError '.tmp/public-tunnel-error.log' -PassThru
    $publicUrl = $null
    Write-Host 'Connecting to the free tunnel service...'
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        $tunnel.Refresh()
        if ($tunnel.HasExited) { throw 'Tunnel failed to start. See .tmp/public-tunnel-error.log.' }
        $logs = (Read-SharedLog -Path $tunnelLog)
        $found = [regex]::Match($logs, 'https://[a-z0-9-]+\.trycloudflare\.com')
        if ($found.Success -and $logs.Contains('Registered tunnel connection')) { $publicUrl = $found.Value; break }
        Start-Sleep -Seconds 1
    }
    if (!$publicUrl) { throw 'The free tunnel service could not connect from this network. See .tmp/public-tunnel-error.log. LAN configuration has not changed.' }
    & $nodePath (Join-Path $PSScriptRoot 'configure-public.mjs') $publicUrl
    if ($LASTEXITCODE -ne 0) { throw 'Public configuration failed.' }
    & $npmPath run db:backup
    if ($LASTEXITCODE -ne 0) { throw 'Backup failed; existing app left running.' }
    # Only replace the verified FocusSpace service after the tunnel connects.
    foreach ($listener in $listeners) {
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
        if ($owner -and $owner.CommandLine -and $owner.CommandLine.Contains($entry)) { Stop-Process -Id $owner.ProcessId }
    }
    $publicEnv = Join-Path $projectRoot '.tmp/public.env'
    $server = Start-Process $nodePath -WindowStyle Hidden -ArgumentList "--env-file=`"$publicEnv`" `"$entry`"" -WorkingDirectory $projectRoot -RedirectStandardOutput '.tmp/public-server.log' -RedirectStandardError '.tmp/public-server-error.log' -PassThru
    # Check the local application independently of public DNS/TLS/network access.
    $localCheck = $null
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        $server.Refresh()
        if ($server.HasExited) {
            $serverError = Read-SharedLog -Path (Join-Path $projectRoot '.tmp/public-server-error.log')
            throw "The application exited (code $($server.ExitCode)). $serverError"
        }
        $localCheck = Get-FocusSpaceHealth -Uri "http://127.0.0.1:$port/api/health" -TimeoutSeconds 2
        if ($localCheck.Healthy) { break }
        Start-Sleep -Seconds 1
    }
    if (!$localCheck -or !$localCheck.Healthy) { throw "Local application health check failed: $($localCheck.Detail). See .tmp/public-server-error.log." }
    Write-Host 'Local application is ready. Checking the public address...'
    $publicCheck = $null
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        $tunnel.Refresh()
        if ($tunnel.HasExited) { throw 'The tunnel exited. See .tmp/public-tunnel-error.log.' }
        $publicCheck = Get-FocusSpaceHealth -Uri "$publicUrl/api/health" -TimeoutSeconds 5
        if ($publicCheck.Healthy) { break }
        Write-Host "Public check $($attempt + 1)/3: $($publicCheck.Detail)" -ForegroundColor Yellow
        if ($attempt -lt 2) { Start-Sleep -Seconds 1 }
    }
    [pscustomobject]@{
        url = $publicUrl
        checkedAt = [DateTime]::UtcNow.ToString('o')
        localHealthy = $localCheck.Healthy
        publicVerified = $publicCheck.Healthy
        publicStatusCode = $publicCheck.StatusCode
        publicDetail = $publicCheck.Detail
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot '.tmp/public-health.json') -Encoding utf8
    [System.IO.File]::WriteAllText((Join-Path $projectRoot '.tmp/public-url.txt'), $publicUrl)
    Write-Host ''
    if ($publicCheck.Healthy) {
        Write-Host "FREE PUBLIC URL: $publicUrl" -ForegroundColor Green
        Write-Host 'Share the URL and room code. Keep this computer and launcher running.'
    } else {
        # A check from this PC is not proof that the app or tunnel is down.
        Write-Host "PUBLIC URL (NOT VERIFIED): $publicUrl" -ForegroundColor Yellow
        Write-Host 'The local app is healthy, but public access could not be verified from this PC.'
        Write-Host 'The app and tunnel remain running. Try this URL in a browser or on mobile data.'
        Write-Host 'Exact check results: .tmp/public-health.json. Do not assume sharing works until the page opens.'
    }
    Write-Host 'Use Stop-Public-FocusSpace.cmd to close public access. Start-FocusSpace.cmd returns to LAN use.'
    if (!$NoBrowser) { Start-Process $publicUrl }
    while ($true) {
        Start-Sleep -Seconds 2
        $tunnel.Refresh()
        $server.Refresh()
        if ($tunnel.HasExited -or $server.HasExited) { break }
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
} finally {
    foreach ($process in @($tunnel, $server)) {
        if ($process) { $process.Refresh(); if (!$process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue } }
    }
}
