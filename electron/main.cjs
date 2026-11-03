const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } = require('electron');
const { spawn, execFileSync } = require('child_process');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { setupAutoUpdate } = require('./auto-update.cjs');

const PORT_MIN = 5000;
const PORT_MAX = 5100;
const isDev = !app.isPackaged;
let server;
let win;
let tray;
let updater;
let port = PORT_MIN;
let isQuitting = false;
const logFile = path.join(app.getPath('userData'), 'watchtower.log');

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(' ')}\n`;
  try { fs.appendFileSync(logFile, line); } catch { /* */ }
  console.log(...args);
}

function serverEntry() {
  if (isDev) return path.join(__dirname, '..', 'server', 'index.js');
  const bundled = path.join(process.resourcesPath, 'server', 'server.cjs');
  const legacy = path.join(process.resourcesPath, 'server', 'index.js');
  if (fs.existsSync(bundled)) return bundled;
  return legacy;
}

function distDir() {
  return isDev
    ? path.join(__dirname, '..', 'dist')
    : path.join(process.resourcesPath, 'dist');
}

function policyPath() {
  return path.join(app.getPath('userData'), 'policy.json');
}

function iconPath() {
  const candidates = isDev
    ? [
      path.join(__dirname, '..', 'build', 'icon.ico'),
      path.join(__dirname, '..', 'build', 'icon.png'),
      path.join(__dirname, 'icon.png'),
    ]
    : [
      path.join(process.resourcesPath, 'build', 'icon.ico'),
      path.join(process.resourcesPath, 'build', 'icon.png'),
      path.join(__dirname, 'icon.png'),
    ];
  return candidates.find((p) => fs.existsSync(p));
}

function trayImage() {
  const file = iconPath();
  if (!file) return nativeImage.createEmpty();
  const img = nativeImage.createFromPath(file);
  if (img.isEmpty()) return img;
  // Windows tray icons are small; keep crisp sizes.
  return img.resize({ width: 16, height: 16 });
}

function canListen(p) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.unref();
    s.once('error', () => resolve(false));
    s.once('listening', () => {
      s.close(() => resolve(true));
    });
    s.listen(p, '127.0.0.1');
  });
}

async function findFreePort() {
  for (let p = PORT_MIN; p <= PORT_MAX; p += 1) {
    if (await canListen(p)) return p;
  }
  return null;
}

function killPortHolders() {
  if (process.platform !== 'win32') return;
  try {
    const out = execFileSync('netstat.exe', ['-ano'], { encoding: 'utf8' });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
      if (!m) continue;
      const listenPort = Number(m[2]);
      if (listenPort < PORT_MIN || listenPort > PORT_MAX) continue;
      const pid = m[3];
      if (!pid || pid === '0' || pid === String(process.pid)) continue;
      pids.add(pid);
    }
    for (const pid of pids) {
      try {
        execFileSync('taskkill.exe', ['/F', '/PID', pid, '/T'], { stdio: 'ignore' });
        log('killed port holder pid', pid);
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    log('killPortHolders failed', err?.message || err);
  }
}

async function resolvePort() {
  const forced = Number(process.env.PORT);
  if (Number.isInteger(forced) && forced >= PORT_MIN && forced <= PORT_MAX && await canListen(forced)) {
    return forced;
  }

  let free = await findFreePort();
  if (free != null) return free;

  log(`ports ${PORT_MIN}-${PORT_MAX} all busy — clearing holders`);
  killPortHolders();
  await new Promise((r) => setTimeout(r, 400));

  free = await findFreePort();
  if (free != null) return free;

  throw new Error(`No free port in ${PORT_MIN}–${PORT_MAX} after clearing`);
}

function waitForServer(activePort) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const req = http.get({ hostname: '127.0.0.1', port: activePort, path: '/', timeout: 1000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - started > 20000) reject(new Error(`Watchtower server did not start on port ${activePort}`));
        else setTimeout(tick, 200);
      });
    };
    tick();
  });
}

function protectOwnWindow() {
  if (!win || win.isDestroyed()) return;
  try {
    // Windows: SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE) — screenshots show through us.
    win.setContentProtection(true);
  } catch (err) {
    log('setContentProtection failed', err?.message || err);
  }
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  protectOwnWindow();
}

function hideToTray() {
  if (!win || win.isDestroyed()) return;
  win.hide();
}

function createTray() {
  if (tray) return;
  tray = new Tray(trayImage());
  tray.setToolTip('Watchtower');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Open Watchtower',
      click: () => showWindow(),
    },
    { type: 'separator' },
    {
      label: 'Quit Watchtower',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.on('click', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isVisible()) hideToTray();
    else showWindow();
  });
  tray.on('double-click', () => showWindow());
}

function openWindow(activePort) {
  win = new BrowserWindow({
    width: 400,
    height: 476,
    minWidth: 340,
    minHeight: 460,
    title: 'Watchtower',
    frame: false,
    backgroundColor: '#ffffff',
    icon: iconPath(),
    autoHideMenuBar: true,
    show: false,
    skipTaskbar: true, // live in the notification tray, not the taskbar
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  protectOwnWindow();

  const sendMax = () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('win:maximized', win.isMaximized());
  };
  win.on('maximize', sendMax);
  win.on('unmaximize', sendMax);
  win.on('show', () => protectOwnWindow());
  win.on('focus', () => protectOwnWindow());
  win.on('minimize', (e) => {
    e.preventDefault();
    hideToTray();
  });
  win.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    hideToTray();
  });
  win.once('ready-to-show', () => {
    protectOwnWindow();
    win.show();
  });
  win.loadURL(`http://127.0.0.1:${activePort}/`);
}

function startServer(activePort) {
  const entry = serverEntry();
  if (!fs.existsSync(entry)) {
    throw new Error(`Server missing at ${entry}`);
  }
  const cwd = path.dirname(entry);
  log('starting server', entry, 'port', activePort);
  server = spawn(process.execPath, [entry], {
    cwd,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(activePort),
      WATCHTOWER_DIST: distDir(),
      WATCHTOWER_POLICY: policyPath(),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  server.stdout?.on('data', (d) => log('[server]', String(d).trim()));
  server.stderr?.on('data', (d) => log('[server:err]', String(d).trim()));
  server.on('exit', (code) => log('server exited', code));
}

ipcMain.on('win:minimize', () => hideToTray());
ipcMain.on('win:maximize', (event) => {
  const w = BrowserWindow.fromWebContents(event.sender);
  if (!w) return;
  if (w.isMaximized()) w.unmaximize();
  else w.maximize();
});
ipcMain.on('win:close', () => hideToTray());

if (process.platform === 'win32') {
  app.setAppUserModelId('com.watchtower.hiding');
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(async () => {
    try {
      port = await resolvePort();
      startServer(port);
      await waitForServer(port);
      createTray();
      openWindow(port);
      updater = setupAutoUpdate();
    } catch (err) {
      log('startup failed', err?.stack || err);
      dialog.showErrorBox(
        'Watchtower could not start',
        `${err?.message || err}\n\nDetails are in:\n${logFile}\n\nClose any old Watchtower process and try again.`,
      );
      server?.kill();
      app.quit();
    }
  });

  app.on('before-quit', () => {
    isQuitting = true;
    server?.kill();
  });

  app.on('window-all-closed', (e) => {
    // Stay alive in the tray unless the user chose Quit.
    if (!isQuitting) e.preventDefault?.();
  });
}
