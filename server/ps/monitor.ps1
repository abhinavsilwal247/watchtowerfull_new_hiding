# Streams one JSON line per tick: foreground window, idle time, and all visible top-level windows (Z-order, top first).
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class W {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetWindowDisplayAffinity(IntPtr h, out uint a);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public class Info { public long Hwnd; public string Title; public uint Pid; public bool Min; public bool Topmost; public bool Layered; public bool Transparent; public bool ToolWin; public uint Affinity; public int X; public int Y; public int Width; public int Height; public int Z; }
  public static uint IdleMs() { var l = new LASTINPUTINFO(); l.cbSize = (uint)Marshal.SizeOf(l); GetLastInputInfo(ref l); return unchecked((uint)Environment.TickCount - l.dwTime); }
  public static List<Info> List() {
    var res = new List<Info>(); int z = 0;
    EnumWindows((h, l) => {
      z++;
      if (!IsWindowVisible(h)) return true;
      int ex = GetWindowLong(h, -20);
      bool topmost = (ex & 0x8) != 0, layered = (ex & 0x80000) != 0, transp = (ex & 0x20) != 0, tool = (ex & 0x80) != 0;
      int len = GetWindowTextLength(h);
      string title = "";
      if (len > 0) { var sb = new StringBuilder(len + 1); GetWindowText(h, sb, sb.Capacity); title = sb.ToString(); }
      // keep titled windows, plus untitled overlays (topmost / click-through) which are interesting
      if (title.Length == 0 && !(topmost || transp)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      uint aff; GetWindowDisplayAffinity(h, out aff);
      RECT r; GetWindowRect(h, out r);
      res.Add(new Info { Hwnd = h.ToInt64(), Title = title, Pid = pid, Min = IsIconic(h), Topmost = topmost, Layered = layered, Transparent = transp, ToolWin = tool, Affinity = aff, X = r.L, Y = r.T, Width = r.R - r.L, Height = r.B - r.T, Z = z });
      return true;
    }, IntPtr.Zero);
    return res;
  }
}
"@
$cache = @{}; $tick = 0
while ($true) {
  $tick++
  if ($tick % 30 -eq 0) { $cache = @{} }
  $fg = [W]::GetForegroundWindow().ToInt64()
  $idle = [W]::IdleMs()
  $wins = foreach ($w in [W]::List()) {
    $p = $cache[[int]$w.Pid]
    if (-not $p) {
      $proc = Get-Process -Id $w.Pid
      $path = $null; try { $path = $proc.Path } catch {}
      $p = @{ name = $proc.ProcessName; path = $path }
      $cache[[int]$w.Pid] = $p
    }
    [pscustomobject]@{
      hwnd = $w.Hwnd; title = $w.Title; pid = $w.Pid; proc = $p.name; path = $p.path
      minimized = $w.Min; topmost = $w.Topmost; layered = $w.Layered; clickThrough = $w.Transparent
      toolWindow = $w.ToolWin; affinity = $w.Affinity; x = $w.X; y = $w.Y; w = $w.Width; h = $w.Height; z = $w.Z
    }
  }
  [pscustomobject]@{ t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); fg = $fg; idleMs = $idle; wins = @($wins) } | ConvertTo-Json -Compress -Depth 4
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 700
}
