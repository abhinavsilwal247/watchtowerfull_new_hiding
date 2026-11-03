# Usage: action.ps1 -Op focus|topmost|untopmost|minimize|nocapture|release|hidetab|showtab|decoy -Hwnd <long>
#        action.ps1 -Op … -Hwnds "123,456"
# nocapture = exclude window from capture (screenshots show what is behind it — not a black box)
# release   = clear capture exclusion; leave Z-order alone
# hidetab   = remove window from the taskbar (ITaskbarList::DeleteTab) — still usable
# showtab   = restore window on the taskbar
# decoy     = paint that window's taskbar button as active WITHOUT stealing real focus
param([string]$Op, [long]$Hwnd, [string]$Hwnds)
Add-Type @"
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("56FDF342-FD6D-11d0-958A-006097C9A090")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ITaskbarList {
  void HrInit();
  void AddTab(IntPtr hwnd);
  void DeleteTab(IntPtr hwnd);
  void ActivateTab(IntPtr hwnd);
  void SetActiveAlt(IntPtr hwnd);
}

[ComImport, Guid("56FDF344-FD6D-11d0-958A-006097C9A090")]
class CTaskbarList {}

public static class A {
  public const uint WDA_NONE = 0;
  public const uint WDA_EXCLUDEFROMCAPTURE = 0x11;
  public const uint SWP_Quiet = 0x13; // NOMOVE|NOSIZE|NOACTIVATE
  static ITaskbarList _tbl;
  static ITaskbarList Tbl() {
    if (_tbl == null) {
      _tbl = (ITaskbarList)new CTaskbarList();
      _tbl.HrInit();
    }
    return _tbl;
  }

  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool SetWindowDisplayAffinity(IntPtr h, uint a);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, uint fl, UIntPtr ex);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string name);

  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsWow64Process(IntPtr h, out bool wow64);
  [DllImport("kernel32.dll", CharSet=CharSet.Ansi, SetLastError=true)] static extern IntPtr GetModuleHandle(string n);
  [DllImport("kernel32.dll", CharSet=CharSet.Ansi, SetLastError=true)] static extern IntPtr GetProcAddress(IntPtr m, string n);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr VirtualAllocEx(IntPtr h, IntPtr a, UIntPtr s, uint t, uint p);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool VirtualFreeEx(IntPtr h, IntPtr a, UIntPtr s, uint t);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool WriteProcessMemory(IntPtr h, IntPtr b, byte[] buf, UIntPtr n, out UIntPtr w);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateRemoteThread(IntPtr h, IntPtr attr, UIntPtr stack, IntPtr start, IntPtr param, uint flags, out uint tid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeThread(IntPtr h, out uint code);

  const uint PROC = 0x0002 | 0x0008 | 0x0010 | 0x0020 | 0x0400;

  // Ask the window's own process to set capture affinity (needed for Chrome / WhatsApp / others).
  static bool AffinityRemote(IntPtr hwnd, uint affinity) {
    if (IntPtr.Size != 8) return false;
    uint pid;
    GetWindowThreadProcessId(hwnd, out pid);
    if (pid == 0) return false;
    IntPtr hProc = OpenProcess(PROC, false, pid);
    if (hProc == IntPtr.Zero) return false;
    try {
      bool wow;
      if (IsWow64Process(hProc, out wow) && wow) return false;
      IntPtr fn = GetProcAddress(GetModuleHandle("user32.dll"), "SetWindowDisplayAffinity");
      if (fn == IntPtr.Zero) return false;

      byte[] stub = new byte[] {
        0x48, 0x83, 0xEC, 0x28,
        0x48, 0x8B, 0x0D, 0x15, 0x00, 0x00, 0x00,
        0x48, 0x8B, 0x15, 0x16, 0x00, 0x00, 0x00,
        0x48, 0x8B, 0x05, 0x17, 0x00, 0x00, 0x00,
        0xFF, 0xD0,
        0x48, 0x83, 0xC4, 0x28,
        0xC3
      };

      IntPtr remote = VirtualAllocEx(hProc, IntPtr.Zero, (UIntPtr)56, 0x3000, 0x40);
      if (remote == IntPtr.Zero) return false;
      try {
        byte[] block = new byte[56];
        Buffer.BlockCopy(stub, 0, block, 0, 32);
        BitConverter.GetBytes(hwnd.ToInt64()).CopyTo(block, 32);
        BitConverter.GetBytes((long)affinity).CopyTo(block, 40);
        BitConverter.GetBytes(fn.ToInt64()).CopyTo(block, 48);
        UIntPtr written;
        if (!WriteProcessMemory(hProc, remote, block, (UIntPtr)56, out written)) return false;
        uint tid;
        IntPtr th = CreateRemoteThread(hProc, IntPtr.Zero, UIntPtr.Zero, remote, IntPtr.Zero, 0, out tid);
        if (th == IntPtr.Zero) return false;
        try {
          WaitForSingleObject(th, 3000);
          uint code;
          GetExitCodeThread(th, out code);
          return code != 0;
        } finally { CloseHandle(th); }
      } finally { VirtualFreeEx(hProc, remote, UIntPtr.Zero, 0x8000); }
    } finally { CloseHandle(hProc); }
  }

  public static bool HideFromCapture(IntPtr h) {
    if (SetWindowDisplayAffinity(h, WDA_EXCLUDEFROMCAPTURE)) return true;
    return AffinityRemote(h, WDA_EXCLUDEFROMCAPTURE);
  }

  public static void ClearCapture(IntPtr h) {
    if (!SetWindowDisplayAffinity(h, WDA_NONE))
      AffinityRemote(h, WDA_NONE);
  }

  public static void NoCapture(IntPtr h) {
    HideFromCapture(h);
    SetWindowPos(h, new IntPtr(-2), 0, 0, 0, 0, SWP_Quiet);
  }

  public static void HideTab(IntPtr h) {
    try { Tbl().DeleteTab(h); } catch { }
  }

  public static void ShowTab(IntPtr h) {
    try { Tbl().AddTab(h); } catch { }
  }

  // Mark taskbar button active without changing the real foreground window.
  public static void DecoyActivate(IntPtr h) {
    try { Tbl().ActivateTab(h); } catch { }
  }

  // Soften taskbar in screenshots: exclude the main tray from capture when needed.
  public static void TrayNoCapture(bool on) {
    IntPtr tray = FindWindow("Shell_TrayWnd", null);
    if (tray == IntPtr.Zero) return;
    if (on) HideFromCapture(tray); else ClearCapture(tray);
  }

  public static void Pin(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);
    SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x53);
    BringWindowToTop(h);
  }
}
"@
function Invoke-Op([string]$op, [IntPtr]$h) {
  switch ($op) {
    'focus' {
      if ([A]::IsIconic($h)) { [void][A]::ShowWindow($h, 9) }
      [A]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [A]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
      [void][A]::BringWindowToTop($h); [void][A]::SetForegroundWindow($h)
    }
    'topmost'   { [A]::Pin($h) }
    'untopmost' { [void][A]::SetWindowPos($h, [IntPtr]::new(-2), 0, 0, 0, 0, [A]::SWP_Quiet) }
    'minimize'  { [void][A]::ShowWindow($h, 6) }
    'nocapture' { [A]::NoCapture($h) }
    'exclude'   { [A]::NoCapture($h) }
    'raise'     { [A]::NoCapture($h) }
    'release'   { [A]::ClearCapture($h) }
    'hidetab'   { [A]::HideTab($h) }
    'showtab'   { [A]::ShowTab($h) }
    'decoy'     { [A]::DecoyActivate($h) }
    'trayhide'  { [A]::TrayNoCapture($true) }
    'trayshow'  { [A]::TrayNoCapture($false) }
    default     { throw "unknown op: $op" }
  }
}
if ($Hwnds) {
  if ($Op -notin @('minimize', 'topmost', 'untopmost', 'nocapture', 'exclude', 'raise', 'release', 'hidetab', 'showtab', 'decoy')) {
    throw 'Hwnds is only supported for minimize|topmost|untopmost|nocapture|exclude|raise|release|hidetab|showtab|decoy'
  }
  foreach ($x in ($Hwnds -split ',')) {
    $n = 0L
    if ([long]::TryParse($x.Trim(), [ref]$n) -and $n -gt 0) { Invoke-Op $Op ([IntPtr]$n) }
  }
  exit 0
}
Invoke-Op $Op ([IntPtr]$Hwnd)
