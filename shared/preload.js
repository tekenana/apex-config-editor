// The ONLY bridge between the page and Node. The page gets `window.api` and nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  info: () => ipcRenderer.invoke('app:info'),
  load: (filePath) => ipcRenderer.invoke('config:load', filePath),
  preview: (filePath, changes) => ipcRenderer.invoke('config:preview', filePath, changes),
  save: (filePath, changes, opts) => ipcRenderer.invoke('config:save', filePath, changes, opts),
  loadVideo: (cfgPath) => ipcRenderer.invoke('video:load', cfgPath),
  loadProfile: (cfgPath) => ipcRenderer.invoke('profile:load', cfgPath),
  previewVideo: (filePath, changes) => ipcRenderer.invoke('video:preview', filePath, changes),
  saveVideo: (filePath, changes, opts) => ipcRenderer.invoke('video:save', filePath, changes, opts),
  pickFile: () => ipcRenderer.invoke('config:pick'),
  findConfigs: () => ipcRenderer.invoke('setup:find'),
  resolveConfig: (input) => ipcRenderer.invoke('setup:resolve', input),
  chooseConfig: (filePath) => ipcRenderer.invoke('setup:choose', filePath),
  listBackups: (filePath) => ipcRenderer.invoke('backups:list', filePath),
  restoreBackup: (filePath, backupPath, opts) => ipcRenderer.invoke('backups:restore', filePath, backupPath, opts),
  deleteBackup: (filePath, backupPath) => ipcRenderer.invoke('backups:delete', filePath, backupPath),
  compareBackup: (filePath, backupPath) => ipcRenderer.invoke('backups:compare', filePath, backupPath),
  openBackupFolder: (filePath) => ipcRenderer.invoke('backups:open-folder', filePath),
  isApexRunning: () => ipcRenderer.invoke('apex:running'),
  launchApex: () => ipcRenderer.invoke('apex:launch'),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  steamStatus: () => ipcRenderer.invoke('steam:status'),
  steamWrite: (accountId, options) => ipcRenderer.invoke('steam:write', accountId, options),
  steamShutdown: () => ipcRenderer.invoke('steam:shutdown'),
  watch: (filePath) => ipcRenderer.invoke('config:watch', filePath),
  onChangedOnDisk: (callback) => {
    ipcRenderer.removeAllListeners('config:changed-on-disk');
    ipcRenderer.on('config:changed-on-disk', (_e, data) => callback(data));
  },
});
