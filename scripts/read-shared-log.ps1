function Read-SharedLog {
    param([Parameter(Mandatory=$true)][string]$Path)
    $stream = $null
    $reader = $null
    try {
        # The writer keeps its handle open. A reader must permit existing writes.
        $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
        $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
        $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8, $true)
        return $reader.ReadToEnd()
    } catch [System.IO.IOException] {
        # Creation, rotation or a temporary exclusive lock: retry on the next poll.
        return ''
    } finally {
        if ($reader) { $reader.Dispose() }
        elseif ($stream) { $stream.Dispose() }
    }
}
