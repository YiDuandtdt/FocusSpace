function Get-FocusSpaceHealth {
    param(
        [Parameter(Mandatory=$true)][string]$Uri,
        [int]$TimeoutSeconds = 5
    )
    $request = $null
    $response = $null
    $reader = $null
    try {
        # The public URL must be checked directly. A system proxy can time out
        # while the same tunnel is reachable by everyone else.
        $request = [System.Net.HttpWebRequest]::Create($Uri)
        $request.Method = 'GET'
        $request.Proxy = $null
        $request.Timeout = $TimeoutSeconds * 1000
        $request.ReadWriteTimeout = $TimeoutSeconds * 1000
        $response = $request.GetResponse()
        $reader = [System.IO.StreamReader]::new($response.GetResponseStream())
        $body = $reader.ReadToEnd() | ConvertFrom-Json -ErrorAction Stop
        if ($body.status -ne 'ok') {
            return [pscustomobject]@{ Healthy = $false; StatusCode = [int]$response.StatusCode; Detail = 'The response did not contain status=ok.' }
        }
        return [pscustomobject]@{ Healthy = $true; StatusCode = [int]$response.StatusCode; Detail = 'OK' }
    } catch {
        $statusCode = $null
        $webException = if ($_.Exception -is [System.Net.WebException]) {
            $_.Exception
        } elseif ($_.Exception.InnerException -is [System.Net.WebException]) {
            $_.Exception.InnerException
        } else {
            $null
        }
        if ($webException -and $webException.Response -and $webException.Response.StatusCode) {
            $statusCode = [int]$webException.Response.StatusCode
        }
        return [pscustomobject]@{ Healthy = $false; StatusCode = $statusCode; Detail = $_.Exception.Message }
    } finally {
        if ($reader) { $reader.Dispose() }
        if ($response) { $response.Dispose() }
    }
}
