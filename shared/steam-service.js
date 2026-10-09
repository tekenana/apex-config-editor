// EXPERIMENTAL: read/write Apex's launch options inside Steam's localconfig.vdf.
// Steam keeps per-account game settings in:
//   <Steam>\userdata\<accountId>\config\localconfig.vdf
// Apex (app 1172470) launch options live at:
//   UserLocalConfigStore > Software > Valve > Steam > apps > 1172470 > LaunchOptions
// Steam rewrites this file when it exits, so writing is only allowed while Steam is closed.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { regQuery } = require('./win-utils');
const { parseVdf, child, find, escapeVdf, indentAt } = require('./vdf');

const APEX_APP_ID = '1172470';
const APPS_PATH = ['UserLocalConfigStore', 'Software', 'Valve', 'Steam', 'apps'];

function readLaunchOptions(text) {
  const apex = find(parseVdf(text), [...APPS_PATH, APEX_APP_ID]);
  const opt = apex && child(apex, 'LaunchOptions');
  return opt && 'value' in opt ? opt.value : '';
}

// Returns new text with ONLY the LaunchOptions value changed/added; everything else untouched.
function setLaunchOptions(text, options) {
  const root = parseVdf(text);
  const apps = find(root, APPS_PATH);
  if (!apps || !apps.children) throw new Error('Could not find the "apps" section in Steam\u2019s config');
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const value = `"${escapeVdf(options)}"`;
  const apex = child(apps, APEX_APP_ID);

  if (apex && apex.children) {
    const opt = child(apex, 'LaunchOptions');
    if (opt && 'value' in opt) {
      return text.slice(0, opt.valueStart) + value + text.slice(opt.valueEnd);
    }
    const inner = indentAt(text, apex.keyStart) + '\t';
    const at = apex.open + 1;
    return text.slice(0, at) + `${nl}${inner}"LaunchOptions"\t\t${value}` + text.slice(at);
  }

  const ind = indentAt(text, apps.keyStart) + '\t';
  const at = apps.open + 1;
  const block = `${nl}${ind}"${APEX_APP_ID}"${nl}${ind}{${nl}${ind}\t"LaunchOptions"\t\t${value}${nl}${ind}}`;
  return text.slice(0, at) + block + text.slice(at);
}

// ---- Steam on disk ---------------------------------------------------------------------

async function steamPath() {
  const fromReg = await regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath');
  const candidates = [fromReg, 'C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'].filter(Boolean);
  return candidates.map((p) => path.normalize(p)).find((p) => fs.existsSync(path.join(p, 'userdata'))) || null;
}

function isSteamRunning() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true }, (err, stdout) => {
      resolve(!err && /"steam\.exe"/i.test(stdout));
    });
  });
}

// Persona names + last login time from loginusers.vdf (SteamID64 -> name).
// Account folder = SteamID64 - 76561197960265728.
function loginInfo(root) {
  const names = {};
  const lastLogin = {};
  try {
    const users = child(parseVdf(fs.readFileSync(path.join(root, 'config', 'loginusers.vdf'), 'utf8')), 'users');
    for (const u of (users && users.children) || []) {
      const accountId = (BigInt(u.key) - 76561197960265728n).toString();
      const persona = child(u, 'PersonaName');
      if (persona) names[accountId] = persona.value;
      const ts = child(u, 'Timestamp');
      lastLogin[accountId] = ts ? Number(ts.value) || 0 : 0;
    }
  } catch {
    /* names are optional */
  }
  return { names, lastLogin };
}

async function status() {
  const root = await steamPath();
  if (!root) return { found: false, running: false, accounts: [] };
  const { names, lastLogin } = loginInfo(root);
  const accounts = [];
  for (const id of fs.readdirSync(path.join(root, 'userdata'))) {
    const file = path.join(root, 'userdata', id, 'config', 'localconfig.vdf');
    if (!fs.existsSync(file)) continue;
    try {
      const text = fs.readFileSync(file, 'utf8');
      const apex = find(parseVdf(text), [...APPS_PATH, APEX_APP_ID]);
      accounts.push({ id, name: names[id] || null, lastLogin: lastLogin[id] || 0, hasApex: Boolean(apex), launchOptions: readLaunchOptions(text) });
    } catch (err) {
      accounts.push({ id, name: names[id] || null, lastLogin: lastLogin[id] || 0, hasApex: false, launchOptions: '', error: err.message });
    }
  }
  // Accounts with Apex first, then the one Steam logged into most recently (the one people mean).
  accounts.sort((a, b) => b.hasApex - a.hasApex || b.lastLogin - a.lastLogin);
  return { found: true, root, running: await isSteamRunning(), accounts };
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function write(accountId, options) {
  if (!/^\d+$/.test(accountId)) throw new Error('Invalid account');
  if (await isSteamRunning()) return { ok: false, message: 'Steam is running. Fully exit Steam first (right-click the tray icon \u2192 Exit).' };
  const root = await steamPath();
  const file = path.join(root, 'userdata', accountId, 'config', 'localconfig.vdf');
  const text = fs.readFileSync(file, 'utf8');
  const next = setLaunchOptions(text, options);
  if (readLaunchOptions(next) !== options) throw new Error('Verification failed before writing; nothing was changed');
  const backup = `${file}.apex-config-editor-${stamp()}.bak`;
  fs.copyFileSync(file, backup);
  fs.writeFileSync(file, next, 'utf8');
  if (readLaunchOptions(fs.readFileSync(file, 'utf8')) !== options) throw new Error(`Verification failed after writing. Backup: ${backup}`);
  return { ok: true, backup };
}

// Asks Steam to exit with its own "-shutdown" command (it saves its settings normally),
// then waits up to ~20 s for steam.exe to be gone. Closing Steam's window only hides it in the tray.
async function shutdown() {
  if (!(await isSteamRunning())) return { ok: true, running: false };
  const root = await steamPath();
  const exe = root && path.join(root, 'steam.exe');
  if (!exe || !fs.existsSync(exe)) return { ok: false, running: true, message: 'Couldn’t find steam.exe. Right-click the Steam icon near the clock → Exit.' };
  execFile(exe, ['-shutdown'], { windowsHide: true }, () => {});
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (!(await isSteamRunning())) return { ok: true, running: false };
  }
  return { ok: false, running: true, message: 'Steam is still closing. Wait a few seconds and press Check again.' };
}

module.exports = { parseVdf, readLaunchOptions, setLaunchOptions, status, write, shutdown, APEX_APP_ID };
