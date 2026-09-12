$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'check-health.ps1')
$projectRoot = Split-Path -Parent $PSScriptRoot
$directory = Join-Path $projectRoot ('.tmp/health-check-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$fixture = Join-Path $directory 'server.mjs'
@"
import {createServer} from 'node:http';
import {writeFileSync} from 'node:fs';
const server=createServer((req,res)=>{
  if(req.url==='/slow')return;
  if(req.url==='/unavailable'){res.writeHead(503);res.end('unavailable');return;}
  if(req.url==='/html'){res.end('<html>proxy error</html>');return;}
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({status:req.url==='/ok'?'ok':'starting'}));
});
server.listen(0,'127.0.0.1',()=>writeFileSync(new URL('./port.txt',import.meta.url),String(server.address().port)));
"@ | Set-Content -LiteralPath $fixture -Encoding utf8
$server = $null
try {
    $nodePath = (Get-Command node.exe).Source
    $server = Start-Process $nodePath -WindowStyle Hidden -ArgumentList "`"$fixture`"" -PassThru
    $portFile = Join-Path $directory 'port.txt'
    for ($i=0;$i -lt 30 -and !(Test-Path $portFile);$i++) { Start-Sleep -Milliseconds 100 }
    $port = [System.IO.File]::ReadAllText($portFile)
    $base = "http://127.0.0.1:$port"
    $ok = Get-FocusSpaceHealth -Uri "$base/ok"
    if (!$ok.Healthy -or $ok.StatusCode -ne 200) { throw 'Healthy app was not recognized.' }
    $bad = Get-FocusSpaceHealth -Uri "$base/waiting"
    if ($bad.Healthy -or !$bad.Detail) { throw 'An unready app was accepted.' }
    $unavailable = Get-FocusSpaceHealth -Uri "$base/unavailable"
    if ($unavailable.Healthy -or $unavailable.StatusCode -ne 503 -or !$unavailable.Detail) { throw 'HTTP failure detail was lost.' }
    $html = Get-FocusSpaceHealth -Uri "$base/html"
    if ($html.Healthy -or !$html.Detail) { throw 'An HTML proxy error was accepted.' }
    $timeout = Get-FocusSpaceHealth -Uri "$base/slow" -TimeoutSeconds 1
    if ($timeout.Healthy -or !$timeout.Detail) { throw 'Timeout detail was lost.' }
    # A failed public probe must not misclassify or terminate the healthy local app.
    if (!(Get-FocusSpaceHealth -Uri "$base/ok").Healthy) { throw 'Healthy local app was affected by probe failure.' }
    Write-Host 'PASS: healthy JSON, non-ready JSON, HTTP 503, HTML response, timeout, and local app survival.'
} finally {
    if ($server) { $server.Refresh(); if (!$server.HasExited) { Stop-Process -Id $server.Id } }
}
