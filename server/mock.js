// Fake data so the UI can be developed/tested without Windows.
const apps = [
  ['chrome', 'Inbox - Gmail - Google Chrome', 'C:\\Program Files\\Google\\Chrome\\chrome.exe'],
  ['Code', 'App.jsx - watchtower - Visual Studio Code', 'C:\\Users\\me\\AppData\\Local\\Programs\\Code\\Code.exe'],
  ['slack', 'Slack | #general', 'C:\\Users\\me\\AppData\\Local\\slack\\slack.exe'],
  ['explorer', 'Downloads', 'C:\\Windows\\explorer.exe'],
  ['Teams', 'Meeting | Microsoft Teams', 'C:\\Program Files\\WindowsApps\\ms-teams.exe'],
  ['SnippingTool', 'Snipping Tool', 'C:\\Windows\\System32\\SnippingTool.exe'],
  ['AcroRd32', 'Patient chart - J. Doe.pdf - Adobe Acrobat Reader', 'C:\\Program Files\\Adobe\\Acrobat Reader\\AcroRd32.exe'],
  ['WhatsApp', 'WhatsApp', 'C:\\Users\\me\\AppData\\Local\\WhatsApp\\WhatsApp.exe'],
];
let n = 0;
const minimized = new Set();
const topmost = new Set([1005]);
const capture = new Set([1001]);
const killed = new Set();

export function mockMinimize(hwnd) { minimized.add(Number(hwnd)); }
export function mockRestore(hwnd) { minimized.delete(Number(hwnd)); }
export function mockTopmost(hwnd) { topmost.add(Number(hwnd)); minimized.delete(Number(hwnd)); }
export function mockUntopmost(hwnd) { topmost.delete(Number(hwnd)); }
export function mockCaptureHide(hwnd) { capture.add(Number(hwnd)); topmost.delete(Number(hwnd)); }
export function mockCaptureShow(hwnd) { capture.delete(Number(hwnd)); }
export function mockKill(pid) { killed.add(Number(pid)); }
export function mockReset() {
  minimized.clear(); topmost.clear(); topmost.add(1005);
  capture.clear(); capture.add(1001); killed.clear();
}

export function mockTick() {
  n++;
  const wins = apps.map(([proc, title, path], i) => ({
    hwnd: 1000 + i, title, pid: 4000 + i, proc, path,
    minimized: i === 3 || minimized.has(1000 + i),
    topmost: topmost.has(1000 + i),
    layered: false, clickThrough: false, toolWindow: false,
    affinity: capture.has(1000 + i) ? 17 : 0,
    w: 1200, h: 800, x: 40 + i * 20, y: 40 + i * 20, z: i + 1,
  }));
  wins.push({
    hwnd: 2000, title: '', pid: 5100, proc: 'atuser', path: 'C:\\Program Files\\ActivTrak\\atuser.exe',
    minimized: false, topmost: true, layered: true, clickThrough: true, toolWindow: true, affinity: 0, w: 1920, h: 1080, z: 0,
  });
  const fgIdx = Math.floor(n / 6) % 4;
  const idleMs = n % 6 === 1 ? 4200 : 300;
  return { t: Date.now(), fg: wins[fgIdx].hwnd, idleMs, wins };
}
export function mockScan() {
  const procs = [
    { pid: 5100, ppid: 4, name: 'atuser.exe', path: 'C:\\Program Files\\ActivTrak\\atuser.exe', cmd: '', conns: 2, remotes: ['52.1.2.3:443', '52.1.2.4:443'] },
    { pid: 6200, ppid: 4, name: 'AnyDesk.exe', path: 'C:\\Program Files (x86)\\AnyDesk\\AnyDesk.exe', cmd: '--service', conns: 1, remotes: ['198.51.100.7:6568'] },
    { pid: 6300, ppid: 4, name: 'Tivazo.exe', path: 'C:\\Users\\me\\AppData\\Local\\Programs\\Tivazo\\Tivazo.exe', cmd: '', conns: 1, remotes: ['203.0.113.10:443'] },
    { pid: 4000, ppid: 1, name: 'chrome.exe', path: 'C:\\Program Files\\Google\\Chrome\\chrome.exe', cmd: '', conns: 9, remotes: ['142.250.1.1:443'] },
  ].filter((p) => !killed.has(p.pid));
  return {
    procs,
    services: [{ name: 'CSFalconService', display: 'CrowdStrike Falcon Sensor Service', path: 'C:\\Windows\\System32\\CSFalconService.exe', pid: 900 }],
  };
}
