const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const { setupAutoUpdate } = require('./auto-update.cjs');

const PORT = process.env.PORT || '3001';
const isDev = !app.isPackaged;
const root = isDev ? path.join(__dirname, '..') : process.resourcesPath;
let server;
let win;
let updater;

function serverEntry() {
  return isDev
    ? path.join(root, 'server', 'index.js')
    : path.join(process.resourcesPath, 'server', 'index.js');
}

function distDir() {
  return isDev
    ? path.join(root, 'dist')
    : path.join(process.resourcesPath, 'dist');
}

function iconPath() {
  const packaged = path.join(process.resourcesPath, 'build', 'icon.png');
  const dev = path.join(__dirname, '..', 'build', 'icon.png');
  const electronIcon = path.join(__dirname, 'icon.png');
  const fs = require('fs');
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
        if (Date.now() - started > 25000) reject(new Error('Watchtower server did not start'));
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
  win.loadURL(`http://127.0.0.1:${PORT}/`);
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
  const entry = serverEntry();
  server = spawn(process.execPath, [entry], {
    cwd: path.dirname(entry),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(PORT),
      WATCHTOWER_DIST: distDir(),
    },
    stdio: 'inherit',
    windowsHide: true,
  });
  try {
    await waitForServer();
    openWindow();
    updater = setupAutoUpdate();
  } catch (err) {
    console.error(err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  server?.kill();
  app.quit();
});

app.on('before-quit', () => server?.kill());
