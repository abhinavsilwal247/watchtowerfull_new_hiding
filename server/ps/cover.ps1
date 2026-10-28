# Watchtower-owned click-through covers over private windows.
# You still see and click the app. Screenshots see black where the cover sits,
# because the cover belongs to Watchtower and uses WDA_MONITOR.
# stdin: { "covers": [ { "hwnd": 123, "x":0, "y":0, "w":800, "h":600 } ] }
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class Cover {
  public const uint WDA_MONITOR = 0x1;
  public const int WS_EX_LAYERED = 0x80000;
  public const int WS_EX_TRANSPARENT = 0x20;
  public const int WS_EX_TOOLWINDOW = 0x80;
  public const int WS_EX_NOACTIVATE = 0x08000000;
  public const int WS_POPUP = unchecked((int)0x80000000);
  public const int SWP_NOACTIVATE = 0x0010;
  public const int SWP_SHOWWINDOW = 0x0040;
  public const int LWA_ALPHA = 0x2;

  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr CreateWindowEx(int dwExStyle, string lpClassName, string lpWindowName, int dwStyle,
    int x, int y, int nWidth, int nHeight, IntPtr hWndParent, IntPtr hMenu, IntPtr hInstance, IntPtr lpParam);
  [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr h, uint c, byte a, uint f);
  [DllImport("user32.dll")] public static extern bool SetWindowDisplayAffinity(IntPtr h, uint a);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("kernel32.dll")] public static extern IntPtr GetModuleHandle(string n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern ushort RegisterClass(ref WNDCLASS lc);
  [DllImport("user32.dll")] public static extern IntPtr DefWindowProc(IntPtr h, uint m, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct WNDCLASS {
    public uint style; public IntPtr lpfnWndProc; public int cbClsExtra; public int cbWndExtra;
    public IntPtr hInstance; public IntPtr hIcon; public IntPtr hCursor; public IntPtr hbrBackground;
    public string lpszMenuName; public string lpszClassName;
  }

  static bool registered;
  static readonly Dictionary<long, IntPtr> map = new Dictionary<long, IntPtr>();
  const string CLASS = "WatchtowerCaptureCover";
  static readonly WndProc Proc = DefWindowProc;
  delegate IntPtr WndProc(IntPtr h, uint m, IntPtr w, IntPtr l);

  public static void EnsureClass() {
    if (registered) return;
    var wc = new WNDCLASS();
    wc.lpfnWndProc = Marshal.GetFunctionPointerForDelegate(Proc);
    wc.hInstance = GetModuleHandle(null);
    wc.lpszClassName = CLASS;
    RegisterClass(ref wc);
    registered = true;
  }

  public static void Sync(long[] hwnds, int[] xs, int[] ys, int[] ws, int[] hs) {
    EnsureClass();
    var keep = new HashSet<long>();
    for (int i = 0; i < hwnds.Length; i++) {
      long id = hwnds[i];
      keep.Add(id);
      IntPtr owner = new IntPtr(id);
      if (!IsWindow(owner)) continue;
      int x = xs[i], y = ys[i], w = ws[i], h = hs[i];
      if (w < 8 || h < 8) continue;
      IntPtr cover;
      if (!map.TryGetValue(id, out cover) || !IsWindow(cover)) {
        int ex = WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
        cover = CreateWindowEx(ex, CLASS, "Watchtower Capture Cover", WS_POPUP, x, y, w, h, owner, IntPtr.Zero, GetModuleHandle(null), IntPtr.Zero);
        if (cover == IntPtr.Zero) continue;
        SetLayeredWindowAttributes(cover, 0, 1, LWA_ALPHA);
        SetWindowDisplayAffinity(cover, WDA_MONITOR);
        ShowWindow(cover, 8);
        map[id] = cover;
      }
      SetWindowPos(cover, IntPtr.Zero, x, y, w, h, (uint)(SWP_NOACTIVATE | SWP_SHOWWINDOW));
      SetWindowDisplayAffinity(cover, WDA_MONITOR);
    }
    var dead = new List<long>();
    foreach (var kv in map) if (!keep.Contains(kv.Key) || !IsWindow(kv.Value)) dead.Add(kv.Key);
    foreach (var id in dead) {
      IntPtr c;
      if (map.TryGetValue(id, out c)) { if (IsWindow(c)) DestroyWindow(c); map.Remove(id); }
    }
  }

  public static void Clear() {
    foreach (var kv in map) if (IsWindow(kv.Value)) DestroyWindow(kv.Value);
    map.Clear();
  }
}
"@

[Console]::InputEncoding = [System.Text.Encoding]::UTF8
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if (-not $line) { continue }
  try {
    $msg = $line | ConvertFrom-Json
    $covers = @($msg.covers)
    if (-not $covers -or $covers.Count -eq 0 -or $null -eq $covers[0]) { [Cover]::Clear(); continue }
    $hwnds = [long[]]@($covers | ForEach-Object { [long]$_.hwnd })
    $xs = [int[]]@($covers | ForEach-Object { [int]$_.x })
    $ys = [int[]]@($covers | ForEach-Object { [int]$_.y })
    $ws = [int[]]@($covers | ForEach-Object { [int]$_.w })
    $hs = [int[]]@($covers | ForEach-Object { [int]$_.h })
    [Cover]::Sync($hwnds, $xs, $ys, $ws, $hs)
  } catch {}
}
[Cover]::Clear()
