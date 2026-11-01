/**
 * Silent auto-update via GitHub Releases (electron-updater).
 * Only for installed NSIS builds — never force-quit the running app.
 */
const { autoUpdater } = require('electron-updater');
const { app } = require('electron');

const CHECK_MS = 6 * 60 * 60 * 1000;
let checkTimer = null;
let updateReady = false;

function log(...args) {
  console.log('[auto-update]', ...args);
}

function setupAutoUpdate({ onStatus } = {}) {
  // Portable / unpackaged builds should not try to self-update.
  const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR)
    || (app.isPackaged && process.execPath.toLowerCase().includes('\\temp\\'));
  if (!app.isPackaged || isPortable) {
    log('skipped (dev or portable)');
    return { check: () => {}, isReady: () => false, installNow: () => {} };
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.channel = 'latest';

  const notify = (msg) => {
    log(msg);
    try { onStatus?.(msg); } catch { /* */ }
  };

  autoUpdater.on('checking-for-update', () => notify('Checking for updates…'));
  autoUpdater.on('update-available', (info) => notify(`Update ${info.version} available — downloading…`));
  autoUpdater.on('update-not-available', () => notify('Up to date'));
  autoUpdater.on('error', (err) => notify(`Update error: ${err?.message || err}`));
  autoUpdater.on('download-progress', (p) => {
    if (p.percent === 0 || p.percent >= 99 || Math.floor(p.percent) % 25 === 0) {
      notify(`Download ${Math.floor(p.percent)}%`);
    }
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateReady = true;
    notify(`Update ${info.version} ready — installs when you quit Watchtower`);
  });

  const check = () => {
    autoUpdater.checkForUpdates().catch((e) => log('check failed', e.message || e));
  };

  setTimeout(check, 15_000);
  checkTimer = setInterval(check, CHECK_MS);
  if (checkTimer.unref) checkTimer.unref();

  return {
    check,
    isReady: () => updateReady,
    installNow: () => {
      if (updateReady) autoUpdater.quitAndInstall(false, true);
      else check();
    },
  };
}

module.exports = { setupAutoUpdate };
