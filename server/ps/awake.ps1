# Holds the execution-state flag until this process is killed (Windows restores normal power management on exit).
param([int]$Display = 1)
Add-Type @"
using System.Runtime.InteropServices;
public static class P { [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f); }
"@
$f = 0x80000001; if ($Display -eq 1) { $f = $f -bor 0x2 }
[void][P]::SetThreadExecutionState([uint32]$f)
while ($true) { Start-Sleep -Seconds 30; [void][P]::SetThreadExecutionState([uint32]$f) }
