// Main-process only: all disk access lives here (the renderer never sees `fs`).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { parse, serialize, applyChanges } = require('./cfg-parser');
const { regQuery, expandEnv } = require('./win-utils');
const { readValues, setValues } = require('./vdf');

const REAL_PATH = path.join(os.homedir(), 'Saved Games', 'Respawn', 'Apex', 'local', 'settings.cfg');
const TEST_PATH = path.join(os.homedir(), 'Desktop', 'settings-prueba.cfg');

// Default to the Desktop test copy so development never touches the live file.
function defaultPath() {
  if (process.env.ACE_FILE) return process.env.ACE_FILE; // dev override
  return fs.existsSync(TEST_PATH) ? TEST_PATH : REAL_PATH;
}

function isReadOnly(stat) {
  return (stat.mode & 0o200) === 0;
}

function samePath(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function load(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const stat = fs.statSync(filePath);
  const lines = parse(text);
  return {
    filePath,
    fileName: path.basename(filePath),
    isRealFile: samePath(filePath, REAL_PATH),
    readOnly: isReadOnly(stat),
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    roundTripOk: serialize(lines) === text,
    lines,
  };
}

function preview(filePath, changes) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = parse(text);
  const result = applyChanges(lines, changes);
  return {
    diff: result.diff,
    missing: result.missing,
    before: serialize(lines),
    after: serialize(result.lines),
  };
}

// ---- finding the file ---------------------------------------------------------------

const CFG_TAIL = ['Respawn', 'Apex', 'local', 'settings.cfg'];
// Windows' own record of where "Saved Games" lives (handles OneDrive / moved folders).
const SAVED_GAMES_KEY = 'HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders';
const SAVED_GAMES_ID = '{4C5C32FF-BB9D-43b0-B5B4-2D72E54EAAA4}';

function looksLikeApexCfg(file) {
  try {
    return parse(fs.readFileSync(file, 'utf8')).some((l) => l.type === 'bind' || l.type === 'cvar');
  } catch {
    return false;
  }
}

function describe(file, kind) {
  const stat = fs.statSync(file);
  return { path: file, kind, mtimeMs: stat.mtimeMs, readOnly: isReadOnly(stat), valid: looksLikeApexCfg(file) };
}

// Every place the game file might be, plus the Desktop test copy if it exists.
async function findConfigs() {
  const roots = [];
  const fromReg = await regQuery(SAVED_GAMES_KEY, SAVED_GAMES_ID);
  if (fromReg) roots.push(expandEnv(fromReg));
  roots.push(path.join(os.homedir(), 'Saved Games'));
  for (const od of [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial]) {
    if (od) roots.push(path.join(od, 'Saved Games'));
  }
  const seen = new Set();
  const found = [];
  for (const root of roots) {
    const file = path.join(root, ...CFG_TAIL);
    const key = path.resolve(file).toLowerCase();
    if (seen.has(key) || !fs.existsSync(file)) continue;
    seen.add(key);
    found.push(describe(file, 'game'));
  }
  if (fs.existsSync(TEST_PATH)) found.push(describe(TEST_PATH, 'test'));
  return found;
}

// Accepts a pasted file OR folder path (quotes and %VARS% allowed) and finds settings.cfg in it.
function resolveConfigInput(input) {
  const p = expandEnv(String(input || '').trim().replace(/^"(.*)"$/, '$1'));
  if (!p) return { ok: false, message: 'Paste a folder or file path first.' };
  const tries = [p, ...[1, 2, 3, 4].map((n) => path.join(p, ...CFG_TAIL.slice(-n)))];
  const file = tries.find((t) => fs.existsSync(t) && fs.statSync(t).isFile());
  if (!file) return { ok: false, message: 'No settings.cfg found there. Check the path, or launch Apex once so the game creates the file.' };
  if (!looksLikeApexCfg(file)) return { ok: false, message: 'That file doesn’t look like an Apex settings file.' };
  return { ok: true, ...describe(file, samePath(file, TEST_PATH) ? 'test' : 'game') };
}

// ---- backups ---------------------------------------------------------------

// The app sets this to "Desktop\Apex Config Editor backups" so users can find their copies.
// Unset (tests), backups go next to the file.
let backupRoot = null;

function setBackupRoot(dir) {
  backupRoot = dir;
}

// Each source file gets its OWN folder, so two files with the same name (e.g. a test copy and the
// real settings.cfg) can never share an ORIGINAL. The real game folder gets the plain name.
function backupDir(filePath) {
  const { dir, name } = path.parse(filePath);
  if (!backupRoot) return path.join(dir, `${name}-backups`);
  const isGameFolder = /[\\/]respawn[\\/]apex[\\/](local|profile)$/i.test(path.resolve(dir));
  if (isGameFolder) return path.join(backupRoot, name);
  const id = require('crypto').createHash('sha1').update(path.resolve(dir).toLowerCase()).digest('hex').slice(0, 6);
  return path.join(backupRoot, `${name} (other location ${id})`);
}

// Local time, e.g. 2026-10-03_20-52-00 (safe for Windows file names).
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

// ONE permanent "ORIGINAL" copy per file, made the first time the app sees it; never overwritten.
function ensureOriginal(filePath) {
  const dir = backupDir(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const { name, ext } = path.parse(filePath);
  const original = path.join(dir, `ORIGINAL-${name}${ext}`);
  if (!fs.existsSync(original)) {
    const now = new Date();
    fs.copyFileSync(filePath, original);
    fs.chmodSync(original, 0o666); // copies inherit read-only; keep backups deletable
    fs.utimesSync(original, now, now); // so the list shows WHEN the backup was taken
  }
  return original;
}

// ORIGINAL (if missing) + a timestamped copy of the current file, before every write.
function makeBackup(filePath) {
  const original = ensureOriginal(filePath);
  const dir = backupDir(filePath);
  const { name, ext } = path.parse(filePath);
  const now = new Date();
  // Never reuse a name: two backups in the same second (save, then restore) get -2, -3…
  const base = `${name}-${stamp()}`;
  let snapshot = path.join(dir, `${base}${ext}`);
  for (let n = 2; fs.existsSync(snapshot); n++) snapshot = path.join(dir, `${base}-${n}${ext}`);
  fs.copyFileSync(filePath, snapshot);
  fs.chmodSync(snapshot, 0o666);
  fs.utimesSync(snapshot, now, now);
  return { snapshot, original };
}

function listBackups(filePath) {
  const dir = backupDir(filePath);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((file) => {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      return { path: full, file, size: stat.size, mtimeMs: stat.mtimeMs, isOriginal: file.startsWith('ORIGINAL-') };
    })
    .sort((a, b) => (b.isOriginal - a.isOriginal) || (b.mtimeMs - a.mtimeMs));
}

// ---- writing ----------------------------------------------------------------

function writeRespectingReadOnly(filePath, text, reapplyReadOnly) {
  const wasReadOnly = isReadOnly(fs.statSync(filePath));
  if (wasReadOnly) fs.chmodSync(filePath, 0o666); // clear read-only
  fs.writeFileSync(filePath, text, 'utf8');
  const lockAfter = reapplyReadOnly ?? wasReadOnly;
  if (lockAfter) fs.chmodSync(filePath, 0o444);
  // Verify what landed on disk is exactly what we meant to write.
  if (fs.readFileSync(filePath, 'utf8') !== text) throw new Error('Verification failed: file on disk does not match');
  return { wasReadOnly, readOnlyAfter: lockAfter };
}

// opts: { expectedMtimeMs, reapplyReadOnly, force }
function save(filePath, changes, opts = {}) {
  const stat = fs.statSync(filePath);
  if (!opts.force && opts.expectedMtimeMs && Math.abs(stat.mtimeMs - opts.expectedMtimeMs) > 1) {
    return { ok: false, reason: 'stale', message: 'The file changed on disk after it was loaded. Reload before saving.' };
  }
  const text = fs.readFileSync(filePath, 'utf8');
  const result = applyChanges(parse(text), changes);
  if (result.diff.length === 0) return { ok: false, reason: 'nochanges', message: 'Nothing to save.' };

  const backup = makeBackup(filePath);
  const write = writeRespectingReadOnly(filePath, serialize(result.lines), opts.reapplyReadOnly);
  return { ok: true, diff: result.diff, backup, ...write, mtimeMs: fs.statSync(filePath).mtimeMs };
}

function assertBackupOf(filePath, backupPath) {
  if (path.dirname(path.resolve(backupPath)) !== path.resolve(backupDir(filePath))) {
    throw new Error('Not a backup of this file');
  }
}

// What would change if this backup were restored? Compared per setting/bind, not per line.
function compareWithBackup(filePath, backupPath) {
  assertBackupOf(filePath, backupPath);
  const currentText = fs.readFileSync(filePath, 'utf8');
  const backupText = fs.readFileSync(backupPath, 'utf8');
  if (isVideoFile(filePath)) {
    const a = readValues(currentText, VIDEO_BLOCK);
    const b = readValues(backupText, VIDEO_BLOCK);
    const diffs = [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .filter((k) => a[k] !== b[k])
      .map((k) => ({ type: 'video', name: `video:${k}`, current: a[k] ?? null, backup: b[k] ?? null }));
    return { identical: currentText === backupText, diffs };
  }
  const keyOf = (l) => {
    if (l.type === 'cvar') return `cvar:${l.name}`;
    if (l.type === 'bind') return `bind:${l.held ? 'hold' : 'tap'}:${l.key}:${l.flag}`;
    return null;
  };
  const toMap = (lines) => {
    const map = new Map();
    for (const l of lines) if (keyOf(l)) map.set(keyOf(l), l);
    return map;
  };
  const valueOf = (l) => (l ? (l.type === 'cvar' ? l.value : l.command) : null);
  const current = toMap(parse(currentText));
  const backup = toMap(parse(backupText));
  const diffs = [];
  for (const key of new Set([...current.keys(), ...backup.keys()])) {
    const a = current.get(key);
    const b = backup.get(key);
    if (valueOf(a) === valueOf(b)) continue;
    const line = a || b;
    diffs.push({
      type: line.type,
      name: line.name || null,
      bindKey: line.key || null,
      held: line.held || false,
      current: valueOf(a),
      backup: valueOf(b),
    });
  }
  return { identical: currentText === backupText, diffs };
}

function openBackupFolder(filePath) {
  const dir = backupDir(filePath);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Deletes ONE timestamped backup. Refuses the ORIGINAL and anything outside that file's backup folder.
function deleteBackup(filePath, backupPath) {
  const dir = path.resolve(backupDir(filePath));
  const target = path.resolve(backupPath);
  if (path.dirname(target).toLowerCase() !== dir.toLowerCase()) throw new Error('That file is not one of this file’s backups');
  if (path.basename(target).startsWith('ORIGINAL-')) throw new Error('The ORIGINAL backup can’t be deleted');
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error('Backup not found');
  fs.unlinkSync(target);
  return { ok: true };
}

function restoreBackup(filePath, backupPath, opts = {}) {
  assertBackupOf(filePath, backupPath);
  const backup = makeBackup(filePath); // current state is backed up first, so restore is undoable
  const write = writeRespectingReadOnly(filePath, fs.readFileSync(backupPath, 'utf8'), opts.reapplyReadOnly);
  return { ok: true, backup, ...write };
}

// ---- videoconfig.txt (graphics, resolution, display mode) -----------------------------
// Lives next to settings.cfg. Format: "VideoConfig" { "setting.x" "value" ... }

const VIDEO_BLOCK = ['VideoConfig'];
const isVideoFile = (filePath) => path.basename(filePath).toLowerCase() === 'videoconfig.txt';
const videoPathFor = (cfgPath) => path.join(path.dirname(cfgPath), 'videoconfig.txt');

function loadVideo(cfgPath) {
  const filePath = videoPathFor(cfgPath);
  if (!fs.existsSync(filePath)) return { filePath, exists: false, values: {} };
  const stat = fs.statSync(filePath);
  return {
    filePath,
    exists: true,
    values: readValues(fs.readFileSync(filePath, 'utf8'), VIDEO_BLOCK),
    readOnly: isReadOnly(stat),
    mtimeMs: stat.mtimeMs,
  };
}

function videoDiff(text, changes) {
  const before = readValues(text, VIDEO_BLOCK);
  return Object.entries(changes)
    .filter(([k, v]) => before[k] !== String(v))
    .map(([k, v]) => ({ name: `video:${k}`, oldValue: before[k] ?? null, newValue: String(v) }));
}

function previewVideo(filePath, changes) {
  return { diff: videoDiff(fs.readFileSync(filePath, 'utf8'), changes) };
}

// Same safety flow as save(): stale check, backup, unlock, write, verify, re-lock.
function saveVideo(filePath, changes, opts = {}) {
  if (!isVideoFile(filePath)) throw new Error('Not a videoconfig.txt file');
  const stat = fs.statSync(filePath);
  if (!opts.force && opts.expectedMtimeMs && Math.abs(stat.mtimeMs - opts.expectedMtimeMs) > 1) {
    return { ok: false, reason: 'stale', message: 'videoconfig.txt changed on disk after it was loaded. Reload before saving.' };
  }
  for (const v of Object.values(changes)) {
    if (/["\r\n]/.test(String(v))) throw new Error('Quotes and line breaks are not allowed in values');
  }
  const text = fs.readFileSync(filePath, 'utf8');
  const diff = videoDiff(text, changes);
  if (!diff.length) return { ok: false, reason: 'nochanges', message: 'Nothing to save.' };
  const next = setValues(text, VIDEO_BLOCK, changes);
  const backup = makeBackup(filePath);
  const write = writeRespectingReadOnly(filePath, next, opts.reapplyReadOnly);
  return { ok: true, diff, backup, ...write, mtimeMs: fs.statSync(filePath).mtimeMs };
}

// ---- profile.cfg (audio mix, volumes, other menu settings) ----------------------------------
// Lives in the "profile" folder next to the "local" folder. Same "name" "value" format as settings.cfg,
// so preview()/save() work on it unchanged. Steam Cloud syncs this file.

const profilePathFor = (cfgPath) => path.join(path.dirname(cfgPath), '..', 'profile', 'profile.cfg');

function loadProfile(cfgPath) {
  const filePath = path.normalize(profilePathFor(cfgPath));
  if (!fs.existsSync(filePath)) return { filePath, exists: false, lines: [] };
  return { exists: true, ...load(filePath) };
}

// ---- environment checks -----------------------------------------------------

function isApexRunning() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(false);
      resolve(/"r5apex[^"]*\.exe"/i.test(stdout));
    });
  });
}

module.exports = {
  REAL_PATH,
  TEST_PATH,
  defaultPath,
  load,
  preview,
  save,
  listBackups,
  restoreBackup,
  deleteBackup,
  compareWithBackup,
  setBackupRoot,
  ensureOriginal,
  loadVideo,
  previewVideo,
  saveVideo,
  videoPathFor,
  loadProfile,
  profilePathFor,
  findConfigs,
  resolveConfigInput,
  openBackupFolder,
  isApexRunning,
};
