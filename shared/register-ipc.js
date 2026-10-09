// Wires every IPC channel the renderers can call. Each channel = one function in config-service.
const fs = require('fs');
const path = require('path');
const { app, ipcMain, dialog, shell, clipboard, BrowserWindow } = require('electron');
const service = require('./config-service');
const catalog = require('./catalog');
const steam = require('./steam-service');

let watched = null;

// Remembers which settings.cfg the user picked (in Electron's per-user app data folder).
const prefsFile = () => path.join(app.getPath('userData'), 'ace-settings.json');

function readPrefs() {
  try {
    return JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writePrefs(prefs) {
  fs.writeFileSync(prefsFile(), JSON.stringify(prefs, null, 2));
}

// File to open at startup: dev override, else the remembered choice, else null (= show setup).
function startPath() {
  if (process.env.ACE_FILE) return process.env.ACE_FILE;
  const { configPath } = readPrefs();
  return configPath && fs.existsSync(configPath) ? configPath : null;
}

// Backups go to the Desktop so users can always find their ORIGINAL file.
// ACE_BACKUP_ROOT is a dev override (used by screenshot tests).
const backupRoot = () => process.env.ACE_BACKUP_ROOT || path.join(app.getPath('desktop'), 'Apex Config Editor backups');

function registerIpc() {
  service.setBackupRoot(backupRoot());
  ipcMain.handle('app:info', () => ({
    defaultPath: service.defaultPath(),
    startPath: startPath(),
    backupRoot: backupRoot(),
    realPath: service.REAL_PATH,
    testPath: service.TEST_PATH,
    catalog,
  }));

  // Loading also saves an untouched ORIGINAL copy of each file (once), before any edit.
  ipcMain.handle('config:load', (_e, filePath) => {
    const target = filePath || service.defaultPath();
    service.ensureOriginal(target);
    return service.load(target);
  });
  ipcMain.handle('video:load', (_e, cfgPath) => {
    const video = service.loadVideo(cfgPath);
    if (video.exists) service.ensureOriginal(video.filePath);
    return video;
  });
  ipcMain.handle('profile:load', (_e, cfgPath) => {
    const profile = service.loadProfile(cfgPath);
    if (profile.exists) service.ensureOriginal(profile.filePath);
    return profile;
  });
  ipcMain.handle('video:preview', (_e, filePath, changes) => service.previewVideo(filePath, changes));
  ipcMain.handle('video:save', (_e, filePath, changes, opts) => service.saveVideo(filePath, changes, opts));
  ipcMain.handle('config:preview', (_e, filePath, changes) => service.preview(filePath, changes));
  ipcMain.handle('config:save', (_e, filePath, changes, opts) => service.save(filePath, changes, opts));

  ipcMain.handle('config:pick', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = await dialog.showOpenDialog(win, {
      title: 'Open an Apex settings.cfg',
      defaultPath: service.defaultPath(),
      filters: [{ name: 'Config', extensions: ['cfg'] }, { name: 'All files', extensions: ['*'] }],
      properties: ['openFile'],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('backups:list', (_e, filePath) => service.listBackups(filePath));
  ipcMain.handle('backups:delete', (_e, filePath, backupPath) => service.deleteBackup(filePath, backupPath));
  ipcMain.handle('backups:restore', (_e, filePath, backupPath, opts) => service.restoreBackup(filePath, backupPath, opts));
  ipcMain.handle('backups:compare', (_e, filePath, backupPath) => service.compareWithBackup(filePath, backupPath));
  ipcMain.handle('backups:open-folder', (_e, filePath) => shell.openPath(service.openBackupFolder(filePath)));
  ipcMain.handle('apex:running', () => service.isApexRunning());

  // First-run setup: find the file, accept a pasted path, remember the choice.
  ipcMain.handle('setup:find', () => service.findConfigs());
  ipcMain.handle('setup:resolve', (_e, input) => service.resolveConfigInput(input));
  ipcMain.handle('setup:choose', (_e, filePath) => {
    const res = service.resolveConfigInput(filePath);
    if (!res.ok) return res;
    writePrefs({ ...readPrefs(), configPath: res.path });
    return res;
  });

  // Launch options: copy to clipboard, and EXPERIMENTAL direct write into Steam.
  ipcMain.handle('clipboard:write', (_e, text) => clipboard.writeText(String(text)));
  // Starts Apex through Steam (same link as Steam's desktop shortcut). Fixed URL, never from the page.
  ipcMain.handle('apex:launch', () => shell.openExternal(`steam://rungameid/${steam.APEX_APP_ID}`));
  ipcMain.handle('steam:status', () => steam.status());
  ipcMain.handle('steam:write', (_e, accountId, options) => steam.write(String(accountId), String(options)));
  ipcMain.handle('steam:shutdown', () => steam.shutdown());

  // Tell the page when the file changes on disk (e.g. the game rewrote it).
  ipcMain.handle('config:watch', (e, filePath) => {
    if (watched) fs.unwatchFile(watched);
    watched = filePath;
    fs.watchFile(filePath, { interval: 1000 }, (curr, prev) => {
      if (curr.mtimeMs !== prev.mtimeMs && !e.sender.isDestroyed()) {
        e.sender.send('config:changed-on-disk', { mtimeMs: curr.mtimeMs });
      }
    });
    return true;
  });
}

module.exports = { registerIpc };
