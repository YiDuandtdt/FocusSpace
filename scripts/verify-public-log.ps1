$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'read-shared-log.ps1')
$projectRoot = Split-Path -Parent $PSScriptRoot
$directory = Join-Path $projectRoot ('.tmp/shared-log-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$path = Join-Path $directory 'tunnel.log'
$writer = $null
try {
    # Reproduce cloudflared holding the log open for writing while sharing reads.
    $writer = [System.IO.File]::Open($path, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
    $content = "https://example-test.trycloudflare.com`nRegistered tunnel connection`n"
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($content)
    $writer.Write($bytes, 0, $bytes.Length)
    $writer.Flush()
    $oldReaderFailed = $false
    try { [System.IO.File]::ReadAllText($path) | Out-Null } catch [System.IO.IOException] { $oldReaderFailed = $true }
    if (!$oldReaderFailed) { throw 'The regression fixture did not reproduce the old read conflict.' }
    $actual = Read-SharedLog -Path $path
    if ($actual -ne $content) { throw 'Shared read failed while the writer was open.' }
    if (!([regex]::Match($actual, 'https://[a-z0-9-]+\.trycloudflare\.com').Success -and $actual.Contains('Registered tunnel connection'))) { throw 'Tunnel connection was not recognized.' }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes('next log line')
    $writer.Write($bytes, 0, $bytes.Length)
    $writer.Flush()
    if (!(Read-SharedLog -Path $path).EndsWith('next log line')) { throw 'Appended log data was not read.' }
    $writer.Dispose()
    $writer = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    if ((Read-SharedLog -Path $path) -ne '') { throw 'An exclusive lock should defer the read.' }
    $writer.Dispose()
    $writer = $null
    if (!(Read-SharedLog -Path $path).Contains('Registered tunnel connection')) { throw 'Read did not recover after lock release.' }
    if ((Read-SharedLog -Path (Join-Path $directory 'not-created.log')) -ne '') { throw 'An uncreated log should defer the read.' }
    Write-Host 'PASS: old conflict reproduced; live writer read, URL detection, append, exclusive-lock retry and recovery verified.'
} finally {
    if ($writer) { $writer.Dispose() }
}
