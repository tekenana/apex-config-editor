// Shared window setup so every version uses the same security settings.
const path = require('path');
const { app, BrowserWindow, Menu } = require('electron');
const { registerIpc } = require('./register-ipc');

function startApp({ htmlPath, width, height, title, backgroundColor }) {
  // Dev screenshots use their own data folder, so they never share storage with (or touch the
  // remembered settings of) a copy of the app the user has open.
  if (process.env.ACE_USER_DATA) app.setPath('userData', process.env.ACE_USER_DATA);
  app.whenReady().then(() => {
    registerIpc();
    Menu.setApplicationMenu(null);
    const win = new BrowserWindow({
      width,
      height,
      minWidth: 760,
      minHeight: 520,
      title,
      backgroundColor,
      show: !process.env.ACE_SCREENSHOT, // dev screenshots render invisibly, nothing pops up
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true, // page JS can't touch preload/Node internals
        nodeIntegration: false, // page has no require / fs
        sandbox: true,
      },
    });
    win.loadFile(htmlPath);
    if (process.env.ACE_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' });

    // Dev helper: ACE_SCREENSHOT=out.png saves a screenshot after load, then quits.
    if (process.env.ACE_SCREENSHOT) {
      win.webContents.on('console-message', (e, level, message) => console.log(`[page] ${e.message ?? message}`));
      win.webContents.once('did-finish-load', async () => {
        await new Promise((r) => setTimeout(r, 1500));
        if (process.env.ACE_SCRIPT) {
          try {
            const result = await win.webContents.executeJavaScript(process.env.ACE_SCRIPT);
            if (result !== undefined) console.log(`[ACE_SCRIPT result] ${result}`);
          } catch (err) {
            console.log(`[ACE_SCRIPT error] ${err.message}`);
          }
        }
        await new Promise((r) => setTimeout(r, 700));
        const image = await win.webContents.capturePage();
        require('fs').writeFileSync(process.env.ACE_SCREENSHOT, image.toPNG());
        app.quit();
      });
    }
  });
  app.on('window-all-closed', () => app.quit());
}

module.exports = { startApp };
