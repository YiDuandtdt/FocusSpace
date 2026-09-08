param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
try {
    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    $npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source
    & $nodePath -e "const [a,b]=process.versions.node.split('.').map(Number);if(a<22||(a===22&&b<12))process.exit(1)"
    if ($LASTEXITCODE -ne 0) { throw 'Install Node.js 22.12 or newer first.' }
    $configText = & $nodePath (Join-Path $PSScriptRoot 'configure-lan.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'LAN configuration failed.' }
    $lan = $configText | ConvertFrom-Json
    $port = [int]$lan.port
    $rule = Get-NetFirewallRule -Name "FocusSpace-LAN-$port" -ErrorAction SilentlyContinue
    $ruleReady = $false
    if ($rule -and $rule.Enabled -eq 'True' -and $rule.Action -eq 'Allow' -and $rule.Direction -eq 'Inbound') {
        $appFilter = $rule | Get-NetFirewallApplicationFilter
        $ruleReady = $appFilter.Program -eq $nodePath
    }
    if (!$ruleReady) {
        Write-Host 'Allow the Windows administrator prompt to enable LAN access for this app.'
        $firewallPath = Join-Path $PSScriptRoot 'lan-firewall.ps1'
        $admin = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$firewallPath`" -Port $port -NodePath `"$nodePath`"" -PassThru -Wait
        if ($admin.ExitCode -ne 0) { throw 'Windows firewall setup failed. Run this launcher again and allow the administrator prompt.' }
    }
    Write-Host ''
    Write-Host 'Share one of these addresses with people on the same LAN:' -ForegroundColor Green
    foreach ($url in $lan.urls) { Write-Host "  $url" -ForegroundColor Cyan }
    Write-Host 'Sign in with separate accounts, then share the room code.'
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) {
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listeners[0].OwningProcess)"
        $entry = Join-Path $PSScriptRoot 'start.mjs'
        if (!$owner -or !$owner.CommandLine.Contains($entry) -or !($listeners | Where-Object { $_.LocalAddress -eq '0.0.0.0' })) {
            throw "Port $port is occupied. Stop the existing server (Ctrl+C), then launch again."
        }
        $health = Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 10
        if ($health.status -ne 'ok') { throw 'The existing server failed its health check.' }
        # Verify that its running configuration accepts the current LAN address.
        & $nodePath -e "const r=await fetch(process.argv[1]+'/api/auth/login',{method:'POST',headers:{Origin:process.argv[1],'Content-Type':'application/json'},body:'{}'});await r.text();process.exitCode=r.status===400?0:1" $lan.urls[0]
        if ($LASTEXITCODE -ne 0) { throw 'The running server needs a restart for the new network address. Double-click Stop-FocusSpace.cmd, then start again.' }
        Write-Host 'FocusSpace is already running.'
        if (!$NoBrowser) { Start-Process $lan.urls[0] }
        exit 0
    }
    if (!(Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules/.bin/prisma.cmd'))) {
        & $npmPath ci
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    & $npmPath run setup
    if ($LASTEXITCODE -ne 0) { throw 'Setup failed.' }
    & $npmPath run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    $server = Start-Process -FilePath $nodePath -ArgumentList "--env-file=.env `"$(Join-Path $PSScriptRoot 'start.mjs')`"" -WorkingDirectory $projectRoot -NoNewWindow -PassThru
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $server.Refresh()
        if ($server.HasExited) { throw 'Server exited during startup.' }
        try {
            $health = Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 2
            if ($health.status -eq 'ok') { $ready = $true; break }
        } catch { }
        Start-Sleep -Seconds 1
    }
    if (!$ready) { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue; throw 'Server did not become ready.' }
    Write-Host 'Ready. Keep this window and this computer running. Use Stop-FocusSpace.cmd to stop.' -ForegroundColor Green
    if (!$NoBrowser) { Start-Process $lan.urls[0] }
    $server.WaitForExit()
    exit $server.ExitCode
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
