const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('watchtower', {
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  onMaximized: (cb) => {
    const listener = (_event, value) => cb(value);
    ipcRenderer.on('win:maximized', listener);
    return () => ipcRenderer.removeListener('win:maximized', listener);
  },
});
