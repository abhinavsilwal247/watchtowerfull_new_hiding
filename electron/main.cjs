const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { setupAutoUpdate } = require('./auto-update.cjs');

const PORT = process.env.PORT || '3001';
const isDev = !app.isPackaged;
let server;
let win;
let updater;
const logFile = path.join(app.getPath('userData'), 'watchtower.log');

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(String).join(' ')}\n`;
  try { fs.appendFileSync(logFile, line); } catch { /* */ }
  console.log(...args);
}

function serverEntry() {
  return isDev
    ? path.join(__dirname, '..', 'server', 'index.js')
    : path.join(process.resourcesPath, 'server', 'index.js');
}

function distDir() {
  return isDev
    ? path.join(__dirname, '..', 'dist')
    : path.join(process.resourcesPath, 'dist');
}

function iconPath() {
  const packaged = path.join(process.resourcesPath, 'build', 'icon.png');
  const dev = path.join(__dirname, '..', 'build', 'icon.png');
  const electronIcon = path.join(__dirname, 'icon.png');
  if (!isDev && fs.existsSync(packaged)) return packaged;
  if (fs.existsSync(dev)) return dev;
  if (fs.existsSync(electronIcon)) return electronIcon;
  return undefined;
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const req = http.get({ hostname: '127.0.0.1', port: PORT, path: '/', timeout: 1000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - started > 20000) reject(new Error('Watchtower server did not start'));
        else setTimeout(tick, 200);
      });
    };
    tick();
  });
}

function openWindow() {
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  const sendMax = () => win.webContents.send('win:maximized', win.isMaximized());
  win.on('maximize', sendMax);
  win.on('unmaximize', sendMax);
  win.once('ready-to-show', () => win.show());
  win.loadURL(`http://127.0.0.1:${PORT}/`);
}

function startServer() {
  const entry = serverEntry();
  if (!fs.existsSync(entry)) {
    throw new Error(`Server missing at ${entry}`);
  }
  const cwd = path.dirname(entry);
  log('starting server', entry);
  server = spawn(process.execPath, [entry], {
    cwd,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(PORT),
      WATCHTOWER_DIST: distDir(),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  server.stdout?.on('data', (d) => log('[server]', String(d).trim()));
  server.stderr?.on('data', (d) => log('[server:err]', String(d).trim()));
  server.on('exit', (code) => log('server exited', code));
}

ipcMain.on('win:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
ipcMain.on('win:maximize', (event) => {
  const w = BrowserWindow.fromWebContents(event.sender);
  if (!w) return;
  if (w.isMaximized()) w.unmaximize();
  else w.maximize();
});
ipcMain.on('win:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());

app.whenReady().then(async () => {
  try {
    startServer();
    await waitForServer();
    openWindow();
    updater = setupAutoUpdate();
  } catch (err) {
    log('startup failed', err?.stack || err);
    dialog.showErrorBox(
      'Watchtower could not start',
      `${err?.message || err}\n\nLog: ${logFile}\n\nReinstall the latest release, or run the installer again.`,
    );
    server?.kill();
    app.quit();
  }
});

app.on('window-all-closed', () => {
  server?.kill();
  app.quit();
});

app.on('before-quit', () => server?.kill());
