# One-shot: every process (with command line, parent, remote connections) plus running services.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$conns = @{}
Get-NetTCPConnection -State Established | Where-Object { $_.RemoteAddress -notmatch '^(127\.|::1|0\.0\.0\.0)' } | ForEach-Object {
  if (-not $conns.ContainsKey($_.OwningProcess)) { $conns[$_.OwningProcess] = New-Object System.Collections.Generic.HashSet[string] }
  [void]$conns[$_.OwningProcess].Add("$($_.RemoteAddress):$($_.RemotePort)")
}
$procs = Get-CimInstance Win32_Process | ForEach-Object {
  $r = $conns[[int]$_.ProcessId]
  [pscustomobject]@{ pid = $_.ProcessId; ppid = $_.ParentProcessId; name = $_.Name; path = $_.ExecutablePath; cmd = $_.CommandLine
    conns = if ($r) { $r.Count } else { 0 }; remotes = if ($r) { @($r | Select-Object -First 5) } else { @() } }
}
$svcs = Get-CimInstance Win32_Service | Where-Object { $_.State -eq 'Running' } | ForEach-Object {
  [pscustomobject]@{ name = $_.Name; display = $_.DisplayName; path = $_.PathName; pid = $_.ProcessId }
}
[pscustomobject]@{ procs = @($procs); services = @($svcs) } | ConvertTo-Json -Compress -Depth 4
