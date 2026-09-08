param([Parameter(Mandatory=$true)][int]$Port, [Parameter(Mandatory=$true)][string]$NodePath)
$ErrorActionPreference = 'Stop'
try {
    if ($Port -lt 1 -or $Port -gt 65535 -or !(Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'Invalid port or Node path.' }
    $ruleName = "FocusSpace-LAN-$Port"
    $existing = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
    if ($existing) { Remove-NetFirewallRule -Name $ruleName }
    New-NetFirewallRule -Name $ruleName -DisplayName "FocusSpace LAN TCP $Port" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Program $NodePath -RemoteAddress LocalSubnet -Profile Any | Out-Null
    exit 0
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
}
