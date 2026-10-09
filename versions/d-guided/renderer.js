// Version D renderer — Explorer's dark UI plus:
//  ★ Jump and dash abilities on SPACE (main feature: abilities on SPACE, not the scroll wheel)
//  - undo/redo history for edits (Ctrl+Z / Ctrl+Y)
//  - guided, step-by-step save wizard (close Apex → review → backup → lock)
//  - Backups & restore view with "revert everything to original"
//  - binds split into Core / Controller / Misc
// Sidebar groups: "tweaks" = things Apex's own menus can't do; "game" = the same settings as
// Apex's menus (still useful: edit with the game closed, keep them read-only, presets, undo).
const NAV_GROUPS = { tweaks: 'Config file only', game: 'Game settings', files: 'Files' };
// One-line explanation under a group heading (only the config-file zone has one).
const NAV_GROUP_NOTES = { tweaks: 'Stuff Apex’s menus can’t do' };
const VIEWS = [
  { id: 'jump', title: 'Movement abilities on SPACE only', nav: 'Dash, jetpack and double jump fix', icon: '★', featured: true, group: 'tweaks' },
  { id: 'performance', title: 'Performance mode', nav: 'FPS booster', icon: '⚡', group: 'tweaks' },
  { id: 'launch', title: 'Skip intro & launch options', icon: '▶', group: 'tweaks' },
  { id: 'pros', title: 'Controller presets', icon: '◍', group: 'tweaks' },
  { id: 'all', title: 'All settings', icon: '≡', group: 'tweaks' },
  { id: 'graphics', title: 'Graphics & video', icon: '◧', group: 'game' },
  { id: 'binds', title: 'Mouse & keyboard', icon: '⌨', group: 'game' },
  { id: 'controller', title: 'Controller', icon: '◐', group: 'game' },
  { id: 'audio', title: 'Audio & voice', icon: '♪', group: 'game' },
  { id: 'backups', title: 'Backups & restore', icon: '⟲', group: 'files' },
];

const state = {
  info: null,
  file: null,
  view: 'jump',
  query: '',
  bindTab: 'core',
  bindConflict: null, // { fromId, toId, key, command, taken } while asking swap / replace
  apexRunning: false,
  stale: false,
  saving: false,
  backups: [],
  video: null, // videoconfig.txt next to settings.cfg
  videoBackups: [],
  scalingGuide: 'nvidia',
  compare: {}, // backup path -> compare result
  openCompare: null,
  confirm: null, // which destructive button is waiting for a 2nd click
  jumpAdvancedOpen: false,
  proTab: {}, // Controller presets: which tab each pro card shows
  expanded: {}, // fadeBox id -> true when "Show more" was pressed
  launch: null, // set in init from localStorage
  steam: null,
  steamAccount: null,
  steamOpen: false,
  steamLoading: false,
  steamClosing: false, // "Close Steam for me" in progress
  jumpOpts: { abilityKey: 'SPACE', jumpOnly: {} }, // jumpOnly[key] === false = leave that key alone
  wizard: null,
  setup: null,
  lastEdit: { key: null, time: 0 },
  showLaunch: false, // floating "Launch Apex" button, shown after a successful save
};

// Undo/redo: every edit pushes a full snapshot of pending changes.
const history = { stack: [{}], index: 0 };
const changes = () => history.stack[history.index];

// "Quiet" keys: pending changes made as a side effect of a bigger toggle (a pro setup turning
// ALC on, its yaw/pitch values…). Their cards don't turn red; only what you touched does.
// Stored on each history snapshot (hidden from Object.keys), so undo/redo keep it right.
const quietKeys = (snapshot = changes()) => snapshot.__quiet || new Set();
function withQuiet(next, quiet) {
  Object.defineProperty(next, '__quiet', { value: new Set([...quiet].filter((k) => k in next)), enumerable: false });
  return next;
}

const $ = (sel) => document.querySelector(sel);

// ---- theme ---------------------------------------------------------------------------
// "red" = the default look in style.css; "navy" = the palette in guided.css, picked by
// <html data-theme="navy">. Remembered per PC in localStorage.
const THEME_KEY = 'ace.theme';

function loadTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === 'navy' ? 'navy' : 'red';
  } catch {
    return 'red';
  }
}

function applyTheme(theme) {
  if (theme === 'navy') document.documentElement.dataset.theme = 'navy';
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore: the theme just isn't remembered */
  }
}

applyTheme(loadTheme()); // before the first render, so the window never flashes the other theme

// ---- startup ----------------------------------------------------------------------

async function init() {
  state.info = await window.api.info();
  state.launch = loadLaunchState();

  $('#search').addEventListener('input', (e) => {
    state.query = e.target.value.trim().toLowerCase();
    renderView();
  });
  $('#open-btn').addEventListener('click', () => openSetup(false));
  $('#theme').value = loadTheme();
  $('#theme').addEventListener('change', (e) => applyTheme(e.target.value));
  $('#setup').addEventListener('cancel', (e) => { if (state.setup && state.setup.required) e.preventDefault(); });
  $('#undo-btn').addEventListener('click', undo);
  $('#redo-btn').addEventListener('click', redo);
  $('#discard-btn').addEventListener('click', () => commit({}, null));
  $('#save-btn').addEventListener('click', openWizard);
  $('#wizard').addEventListener('close', () => { state.wizard = null; });

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = (t.tagName === 'INPUT' && ['text', 'number', 'search'].includes(t.type)) || t.tagName === 'TEXTAREA';
    if (typing || !e.ctrlKey) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  });

  window.api.onChangedOnDisk(({ mtimeMs }) => {
    if (state.saving || Math.abs(mtimeMs - state.file.mtimeMs) <= 1) return;
    state.stale = true;
    renderBanners();
  });

  if (state.info.startPath) await loadFile(state.info.startPath);
  else await openSetup(true);
  pollApex();
  setInterval(pollApex, 3000);
}

async function loadFile(filePath, { keepHistory = false } = {}) {
  try {
    state.file = await window.api.load(filePath);
  } catch (err) {
    return toast(`Could not open file: ${errorText(err)}`, true);
  }
  if (!keepHistory) {
    history.stack = [{}];
    history.index = 0;
  }
  state.stale = false;
  state.confirm = null;
  state.compare = {};
  state.openCompare = null;
  await window.api.watch(filePath);
  state.backups = await window.api.listBackups(filePath);
  try {
    state.video = await window.api.loadVideo(filePath);
  } catch {
    state.video = null;
  }
  state.videoBackups = state.video && state.video.exists ? await window.api.listBackups(state.video.filePath) : [];
  try {
    state.profile = await window.api.loadProfile(filePath);
  } catch {
    state.profile = null;
  }
  state.profileBackups = state.profile && state.profile.exists ? await window.api.listBackups(state.profile.filePath) : [];
  renderAll();
  // Mouse acceleration makes aim inconsistent, so it's switched off by default (as a pending
  // change: visible, undoable, and nothing is written until Save).
  if (!keepHistory && original('m_acceleration') === '1') {
    setChange('m_acceleration', '0');
    toast('Mouse acceleration was on. It’s queued to turn off; press Save… to apply, or Undo to keep it.');
  }
}

async function pollApex() {
  const running = await window.api.isApexRunning();
  if (running === state.apexRunning) return;
  state.apexRunning = running;
  renderApexStatus();
  renderLaunchFab();
  if (state.wizard) renderWizard();
}

// ---- model helpers ---------------------------------------------------------------

const isBindKey = (key) => key.startsWith('bind:');
// Graphics changes are keyed "video:setting.xyz" and saved to videoconfig.txt.
const isVideoKey = (key) => key.startsWith('video:');
const isProfileKey = (key) => key.startsWith('profile:');
const profileName = (key) => key.slice('profile:'.length);
const videoName = (key) => key.slice('video:'.length);
const videoItem = (key) => VIDEO_SETTINGS.find((s) => s.key === videoName(key));

function findBind(key, held = false) {
  const lines = state.file.lines;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.type === 'bind' && l.key === key && l.held === held) return l;
  }
  return null;
}

function findBindById(id) {
  return state.file.lines.find((l) => l.type === 'bind' && l.id === id) || null;
}

function original(key) {
  if (isVideoKey(key)) {
    return state.video && state.video.exists ? state.video.values[videoName(key)] ?? null : null;
  }
  if (isProfileKey(key)) {
    const line = state.profile && state.profile.exists ? findCvar(state.profile.lines, profileName(key)) : null;
    return line ? line.value : null;
  }
  if (isBindKey(key)) {
    const line = findBindById(key);
    return line ? line.command : null;
  }
  const line = findCvar(state.file.lines, key);
  return line ? line.value : null;
}

function current(key) {
  return changes()[key] ?? original(key);
}

// Extra videoconfig lines that are plain on/off switches (shown as On/Off, not 1/0).
const VIDEO_SWITCHES = new Set(['setting.csm_enabled', 'setting.volumetric_fog', 'setting.cl_gib_allow', 'setting.cl_ragdoll_self_collision', 'setting.r_createmodeldecals', 'setting.mat_mip_linear']);

const VIDEO_LABELS = {
  'setting.defaultres': 'Resolution width',
  'setting.defaultresheight': 'Resolution height',
  'setting.fullscreen': 'Display mode (full screen)',
  'setting.nowindowborder': 'Display mode (border)',
  // Only changed by the Performance mode card:
  'setting.mat_backbuffer_count': 'Frame buffering',
  'setting.csm_enabled': 'Sun shadows',
  'setting.shadow_maxdynamic': 'Dynamic shadows',
  'setting.shadow_depth_dimen_min': 'Shadow map size',
  'setting.shadow_depth_upres_factor_max': 'Shadow upscaling',
  'setting.volumetric_fog': 'Volumetric fog',
  'setting.map_detail_level': 'Map detail',
  'setting.cl_particle_fallback_base': 'Particle fallback',
  'setting.cl_particle_fallback_multiplier': 'Particle fallback scale',
  'setting.cl_gib_allow': 'Gibs (body chunks)',
  'setting.cl_ragdoll_self_collision': 'Ragdoll self-collision',
  'setting.r_decals': 'Decals (bullet holes, blood)',
  'setting.r_createmodeldecals': 'Decals on models',
  'setting.mat_mip_linear': 'Texture blending',
};

function labelFor(key) {
  if (key === MANTLE_KEY) return 'Mantle boost';
  if (key === 'profile:gamepad_custom_pilot') return 'Controller buttons (custom layout)';
  if (key === 'profile:gamepad_button_layout') return 'Controller button layout';
  const listed = state.info.catalog.find((c) => c.name === key);
  if (listed) return listed.label;
  if (isVideoKey(key)) {
    const item = videoItem(key);
    return item ? item.label : VIDEO_LABELS[videoName(key)] || videoName(key);
  }
  if (isBindKey(key)) {
    const [, kind, k] = key.match(/^bind:(tap|hold):(.*):[^:]*$/);
    return `${k} key${kind === 'hold' ? ' (hold)' : ''}`;
  }
  const item = state.info.catalog.find((c) => c.name === key);
  return item ? item.label : key;
}

// How a value is shown to people: bind commands as actions, menu values by their menu name.
function formatValue(key, value) {
  if (isBindKey(key)) return describeCommand(value);
  if (value == null) return '(not set)';
  if (key === MANTLE_KEY) return MANTLE_NAMES[value] || `"${value}"`;
  const listed = state.info.catalog.find((c) => c.name === key);
  if (listed && listed.menu) return listed.menu[value] || `"${value}"`;
  if (listed && listed.percent) return toPercent(value) + '%';
  if (listed && listed.fov) return String(toFov(value));
  if (listed && listed.ads) return Number(value) === 1 ? 'Same (1.0)' : `${Number(value)}×`;
  if (listed && listed.type === 'number' && !Number.isNaN(Number(value))) return String(Number(value));
  const item = isVideoKey(key) && videoItem(key);
  if (isVideoKey(key) && !item) { // extra videoconfig lines (Performance mode card)
    if (VIDEO_SWITCHES.has(videoName(key))) return value === '0' ? 'Off' : value === '1' ? 'On' : value;
    return videoName(key) === 'setting.r_decals' && value === '0' ? 'Off' : value;
  }
  const opt = item && item.options.find((o) => o[0] === value);
  return opt ? opt[1] : `"${value}"`;
}

function describeCommand(command) {
  if (command == null || !command.trim()) return 'nothing';
  const parts = command.split(';').map((c) => c.trim()).filter(Boolean);
  return parts.map((p) => friendlyPart(p) || p).join(' + ');
}

// ---- history ----------------------------------------------------------------------

function commit(next, editKey) {
  if (!next.__quiet) withQuiet(next, quietKeys()); // keep earlier quiet keys that are still pending
  const now = Date.now();
  // Rapid edits to the same setting (dragging a slider) collapse into ONE undo step.
  const coalesce = editKey && state.lastEdit.key === editKey && now - state.lastEdit.time < 800
    && history.index > 0 && history.index === history.stack.length - 1;
  if (coalesce) {
    history.stack[history.index] = next;
  } else {
    history.stack = history.stack.slice(0, history.index + 1);
    history.stack.push(next);
    history.index++;
  }
  state.lastEdit = { key: editKey, time: now };
  if (editKey) {
    document.querySelectorAll(`[data-name="${CSS.escape(editKey)}"]`).forEach((row) => row.classList.toggle('changed', editKey in next));
    renderChanges();
    renderNav();
    if (state.view === 'jump' || ((state.view === 'controller' || state.view === 'pros') && editKey === ALC_KEY)) renderView();
  } else {
    renderAll();
  }
}

function setChange(key, value) {
  const next = { ...changes() };
  if (value === original(key)) delete next[key];
  else next[key] = value;
  const quiet = new Set(quietKeys());
  quiet.delete(key); // edited by hand: show it as changed
  commit(withQuiet(next, quiet), key);
}

function removeChange(key) {
  const next = { ...changes() };
  delete next[key];
  commit(next, null);
}

function undo() {
  if (history.index === 0) return;
  history.index--;
  state.lastEdit = { key: null, time: 0 };
  renderAll();
  toast('Undone');
}

function redo() {
  if (history.index >= history.stack.length - 1) return;
  history.index++;
  state.lastEdit = { key: null, time: 0 };
  renderAll();
  toast('Redone');
}

function matches(...texts) {
  return !state.query || texts.some((t) => t && String(t).toLowerCase().includes(state.query));
}

function go(view) {
  if (view !== state.view) {
    // A search only applies to the tab it was typed in; a leftover one would hide most cards.
    state.query = '';
    $('#search').value = '';
  }
  state.view = view;
  state.confirm = null;
  renderNav();
  renderView();
}

// ---- rendering: chrome -------------------------------------------------------------

function renderAll() {
  const f = state.file;
  $('#file-name').textContent = f.fileName;
  $('#file-name').title = f.filePath;
  $('#file-badges').replaceChildren();
  renderApexStatus();
  renderBanners();
  renderNav();
  renderView();
  renderChanges();
}

const PROTECT_TIP = 'Saving makes your settings files read-only, so Apex can\u2019t reset your changes. While they\u2019re read-only, changes made in Apex\u2019s own menus won\u2019t stick; change them here instead.';

function renderApexStatus() {
  if (!state.file) return;
  const video = state.video && state.video.exists ? state.video : null;
  const isProtected = state.file.readOnly && (!video || video.readOnly);
  setChildren($('#apex-status'),
    state.apexRunning
      ? el('div', { class: 'status-line bad' }, '● Close Apex before saving')
      : el('div', { class: 'status-line ok' }, '● Apex is closed · safe to save'),
    isProtected
      ? el('div', { class: 'status-line ok', title: PROTECT_TIP }, '● Read-only · Apex can’t reset your changes')
      : el('div', { class: 'status-line warn', title: PROTECT_TIP }, '● Not read-only yet · press Save, then launch Apex'),
  );
}

function renderBanners() {
  const list = [];
  if (state.stale) {
    list.push(el('div', { class: 'banner error' },
      el('span', {}, 'This file was changed by something else (probably the game) after you opened it.'),
      el('button', { class: 'btn small', onclick: () => loadFile(state.file.filePath) }, 'Reload file'),
    ));
  }
  setChildren($('#banners'), ...list);
}

function renderNav() {
  const names = Object.keys(changes());
  const changedIn = (id) => {
    if (id === 'all') return names.filter((n) => !isBindKey(n) && !isVideoKey(n) && !isProfileKey(n)).length;
    if (id === 'graphics') {
      const elsewhere = (n) => state.info.catalog.some((c) => c.name === n && c.section !== 'graphics');
      return names.filter((n) => (isVideoKey(n) && !elsewhere(n)) || state.info.catalog.some((c) => c.name === n && c.section === 'graphics')).length;
    }
    if (id === 'binds') return names.filter((n) => isBindKey(n) || state.info.catalog.some((c) => c.name === n && c.section === 'mouse')).length;
    return names.filter((n) => state.info.catalog.some((c) => c.name === n && c.section === id)).length;
  };
  const item = (v) => {
    const n = ['jump', 'launch', 'backups', 'performance', 'pros'].includes(v.id) ? 0 : changedIn(v.id);
    return el('button', {
      class: `nav-item${state.view === v.id ? ' active' : ''}${v.featured ? ' featured' : ''}`,
      onclick: () => go(v.id),
    }, el('span', { class: 'icon' }, v.icon), v.nav || v.title, n ? el('span', { class: 'count' }, n) : null);
  };
  // Each group is one block: heading, optional note, its tabs. The config-file group is a tinted zone.
  $('#nav').replaceChildren(...Object.keys(NAV_GROUPS).map((g) =>
    el('div', { class: `nav-section${g === 'tweaks' ? ' zone' : ''}` },
      el('div', { class: 'nav-group' }, NAV_GROUPS[g]),
      NAV_GROUP_NOTES[g] ? el('div', { class: 'nav-note' }, NAV_GROUP_NOTES[g]) : null,
      ...VIEWS.filter((v) => v.group === g).map(item))));
}

function renderView() {
  const view = VIEWS.find((v) => v.id === state.view);
  $('#view-title').textContent = view.title;
  $('#search').hidden = ['jump', 'backups', 'performance', 'pros'].includes(state.view);
  const render = {
    jump: renderJump,
    launch: renderLaunch,
    binds: () => el('div', {}, renderSection('mouse'), el('h3', { class: 'section-h' }, 'Key binds'), renderBinds('keyboard')),
    all: renderAllSettings,
    backups: renderBackups,
    graphics: renderGraphics,
    controller: renderController,
    pros: renderControllerPresets,
    performance: () => el('div', {}, el('div', { class: 'grid' }, renderPerformance({ full: true })),
      el('p', { class: 'note spaced' }, 'Every setting it changes can also be set one by one in Graphics & video (the hidden ones only here).')),
  }[state.view] || (() => renderSection(state.view));
  $('#view').replaceChildren(render());
}

// ---- view: ★ Jump and dash abilities on SPACE --------------------------------------------------
// Default for everyone: SPACE = "+jump;+dodge" (jump + movement ability), and every OTHER
// key that jumps (scroll wheel etc.) keeps a plain jump. Advanced lets people pick another
// ability key and which jump keys stay jump-only. Keys that only send "+dodge"
// (e.g. an in-game Movement Ability bind on B) are never touched.

// What turning it on fixes, in order of importance: [fix, who, how]. `k` = the ability
// key ("SPACE"), so the list names the real key. Numbered 1, 2, 3… on the card.
const FIXES = [
  ['Bunny hop', 'Ash · Valk · Sparrow', () => 'Scroll-wheel hops stay clean, nothing else fires'],
  ['Wall bounce', 'Ash · Valk · Sparrow', () => 'Scrolling into a wall only jumps'],
  ['Dash', 'Ash', (k) => `Only on ${k}`],
  ['Jetpack', 'Valkyrie', (k) => `Only on ${k}`],
  ['Double jump', 'Sparrow', (k) => `Only on ${k}`],
  ['Mantle boost', 'Everyone', (k) => `Only on ${k} (or your Movement Ability key)`],
];
// Side effects worth knowing (not fixes), shown under the fixes: [label, who, how].
const HEADS_UP = [
  ['Heads up', 'Octane', (k) => `Jump pad double jump only works on ${k} now, not the scroll wheel`],
];

const ABILITY_CMD = '+dodge';
const JUMP_CMD = '+jump';

// Apex's "Mantle boost" input option, stored in profile.cfg: 1 = Jump, 3 = Movement Ability
// (both confirmed in game). With Jump, every +jump key (scroll wheel too) can trigger it.
const MANTLE_KEY = 'profile:mantle_boost_input_setting';
const MANTLE_ABILITY = '3';
const MANTLE_JUMP = '1';
const MANTLE_NAMES = { 1: 'Jump', 3: 'Movement Ability' };
const MANTLE_PREV = 'ace.mantlePrev'; // localStorage: the value to go back to when the toggle is turned off

function rememberMantle(value) {
  try {
    localStorage.setItem(MANTLE_PREV, value);
  } catch {
    /* ignore: turning off then falls back to Jump */
  }
}

// The value to restore when turning the feature off: what it was before, else Jump.
function previousMantle() {
  try {
    const v = localStorage.getItem(MANTLE_PREV);
    if (v && /^\d+$/.test(v) && v !== MANTLE_ABILITY) return v;
  } catch {
    /* ignore */
  }
  return MANTLE_JUMP;
}

const KEY_NAMES = { SPACE: 'Space bar', MWHEELUP: 'Scroll wheel up', MWHEELDOWN: 'Scroll wheel down', LALT: 'Left Alt', LCTRL: 'Left Ctrl', LSHIFT: 'Left Shift', MOUSE4: 'Mouse 4', MOUSE5: 'Mouse 5' };
const keyName = (key) => KEY_NAMES[key] || `${key} key`;

const chainOf = (command) => (command || '').split(';').map((c) => c.trim()).filter(Boolean);
const hasCmd = (command, cmd) => chainOf(command).some((c) => c.toLowerCase() === cmd);
const withCmd = (command, cmd) => (hasCmd(command, cmd) ? command : [...chainOf(command), cmd].join(';'));
const withoutCmd = (command, cmd) => chainOf(command).filter((c) => c.toLowerCase() !== cmd).join(';');

// The id to edit for a key: its existing tap bind, or a new primary-slot bind.
function bindIdForKey(key) {
  const line = findBind(key);
  return line ? line.id : `bind:tap:${key}:0`;
}

// Tap binds (as saved in the file) that include +jump. Keyboard/mouse only, not controller.
function detectedJumpKeys() {
  const keys = [];
  for (const l of state.file.lines) {
    if (l.type !== 'bind' || l.held || CONTROLLER_KEYS.has(l.key)) continue;
    if (hasCmd(l.command, JUMP_CMD) && !keys.includes(l.key)) keys.push(l.key);
  }
  return keys;
}

function jumpPlan() {
  const ability = state.jumpOpts.abilityKey;
  const others = detectedJumpKeys().filter((k) => k !== ability);
  const jumpOnly = others.filter((k) => state.jumpOpts.jumpOnly[k] !== false);
  const row = (key, role) => {
    const bindId = bindIdForKey(key);
    const now = current(bindId);
    const target = role === 'ability' ? withCmd(withCmd(now, JUMP_CMD), ABILITY_CMD) : withoutCmd(now, ABILITY_CMD) || JUMP_CMD;
    return { key, role, bindId, now, target, done: now === target };
  };
  // Keys that send the movement ability on their own (likely the in-game "Movement Ability" bind).
  const abilityOnly = [];
  for (const l of state.file.lines) {
    if (l.type !== 'bind' || l.held || l.key === ability || CONTROLLER_KEYS.has(l.key)) continue;
    const cmd = current(l.id);
    if (hasCmd(cmd, ABILITY_CMD) && !hasCmd(cmd, JUMP_CMD) && !abilityOnly.includes(l.key)) abilityOnly.push(l.key);
  }
  // Mantle boost lives in profile.cfg. If the file or the line is missing, the app can't set it.
  const mantleNow = current(MANTLE_KEY);
  const mantle = { available: original(MANTLE_KEY) !== null, now: mantleNow, target: MANTLE_ABILITY, done: mantleNow === MANTLE_ABILITY };
  return {
    ability: row(ability, 'ability'),
    jumpOnly: jumpOnly.map((k) => row(k, 'jump')),
    skipped: others.filter((k) => !jumpOnly.includes(k)),
    abilityOnly,
    mantle,
  };
}

// On = every key is at its target AND mantle boost is on Movement Ability (when the app can set it).
function jumpIsOn() {
  const plan = jumpPlan();
  return plan.ability.done && plan.jumpOnly.every((r) => r.done) && (!plan.mantle.available || plan.mantle.done);
}

function setJumpAbilities(on) {
  const plan = jumpPlan();
  const next = { ...changes() };
  const put = (id, value) => {
    if (value === original(id)) delete next[id];
    else next[id] = value;
  };
  if (on) {
    for (const r of [plan.ability, ...plan.jumpOnly]) put(r.bindId, r.target);
    if (plan.mantle.available) {
      // Remember the player's own choice, so turning this off can put it back.
      const saved = original(MANTLE_KEY);
      if (saved !== MANTLE_ABILITY) rememberMantle(saved);
      put(MANTLE_KEY, MANTLE_ABILITY);
    }
  } else {
    // Off = the ability key goes back to a plain jump; jump-only keys stay as they are;
    // mantle boost goes back to what it was before (or Jump).
    put(plan.ability.bindId, withoutCmd(plan.ability.now, ABILITY_CMD) || JUMP_CMD);
    if (plan.mantle.available && plan.mantle.now === MANTLE_ABILITY) put(MANTLE_KEY, previousMantle());
  }
  commit(next, null);
  toast(on ? 'Added to pending changes. Press Save… to apply.' : 'Turned off in pending changes. Press Save… to apply.');
}

function keyCap(text, extra = '') {
  return el('span', { class: `keycap ${extra}` }, text);
}

function renderJump() {
  const on = jumpIsOn();
  const plan = jumpPlan();
  const ability = plan.ability.key;
  const pending = [plan.ability, ...plan.jumpOnly].some((r) => r.bindId in changes()) || MANTLE_KEY in changes();
  const status = on
    ? (pending ? 'On · not saved yet, press Save… to apply' : 'On · saved in your file')
    : (pending ? 'Off · not saved yet, press Save… to apply' : 'Off');

  const keyLabel = ability === 'SPACE' ? 'SPACE' : keyName(ability);
  const toggle = el('label', { class: `tile toggle wide hero-toggle${pending ? ' changed' : ''}` },
    el('div', {},
      el('div', { class: 'tile-label' }, 'Bunny hop, wall bounce, dash, jetpack, double jump and mantle boost fix'),
      el('div', { class: 'tile-help' },
        `Clean bunny hops on the scroll wheel: scrolling only jumps, so your dash, jetpack or double jump never fires by accident. They stay on ${keyLabel}.`),
      el('div', { class: 'fix-list' },
        FIXES.map(([fix, who, how], i) => el('div', { class: 'fix-row' },
          el('span', { class: 'fix-num' }, String(i + 1)),
          el('span', { class: 'fix-gain' }, fix),
          el('span', { class: 'fix-who' }, who),
          el('span', { class: 'fix-how' }, how(keyLabel)))),
        HEADS_UP.map(([label, who, how]) => el('div', { class: 'fix-row heads-up' },
          el('span', { class: 'fix-num' }, '⚠'),
          el('span', { class: 'fix-gain' }, label),
          el('span', { class: 'fix-who' }, who),
          el('span', { class: 'fix-how' }, how(keyLabel))))),
      el('code', { class: 'tile-cvar' }, status),
    ),
    el('input', { type: 'checkbox', class: 'switch big', checked: on, onchange: (e) => setJumpAbilities(e.target.checked) }),
  );


  const choices = [...new Set(['SPACE', ...detectedJumpKeys()])];
  const advanced = el('div', { class: 'tile wide' },
    el('details', { open: state.jumpAdvancedOpen, ontoggle: (e) => (state.jumpAdvancedOpen = e.target.open) },
      el('summary', { class: 'tile-label' }, 'Advanced: choose your keys'),

      el('div', { class: 'adv-row' },
        el('div', {}, el('div', { class: 'adv-title' }, 'Ability key'), el('div', { class: 'tile-help' }, 'Jumps AND activates movement abilities.')),
        el('select', {
          class: 'raw adv-select',
          onchange: (e) => { state.jumpOpts.abilityKey = e.target.value; renderView(); },
        }, choices.map((k) => el('option', { value: k, selected: k === ability }, keyName(k)))),
      ),

      el('div', { class: 'adv-title spaced' }, 'Jump-only keys'),
      el('div', { class: 'tile-help' }, 'Other keys that jump in your file. Ticked keys never activate abilities.'),
      plan.jumpOnly.length || plan.skipped.length
        ? el('div', { class: 'adv-keys' }, [...plan.jumpOnly.map((r) => r.key), ...plan.skipped].map((k) =>
          el('label', { class: 'opt' },
            el('input', { type: 'checkbox', checked: state.jumpOpts.jumpOnly[k] !== false, onchange: (e) => { state.jumpOpts.jumpOnly[k] = e.target.checked; renderView(); } }),
            keyCap(k), ` ${keyName(k)}  `, el('code', { class: 'dim' }, current(bindIdForKey(k)) || ''))))
        : el('p', { class: 'dim' }, 'No other jump keys found in your file.'),

      plan.abilityOnly.length ? el('div', { class: 'adv-note' },
        el('b', {}, 'Left as is: '),
        plan.abilityOnly.flatMap((k, i) => [i ? ', ' : '', keyCap(k)]),
        ` ${plan.abilityOnly.length > 1 ? 'also send' : 'also sends'} the movement ability on its own (probably your in-game Movement Ability bind). The app doesn’t change ${plan.abilityOnly.length > 1 ? 'these keys' : 'this key'}.`) : null,

      el('table', { class: 'table compact spaced' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Key'), el('th', {}, 'Now'), el('th', {}, 'When on'))),
        el('tbody', {}, [plan.ability, ...plan.jumpOnly].map((r) => el('tr', {},
          el('td', {}, keyCap(r.key)),
          el('td', {}, el('code', {}, r.now ?? '(not bound)')),
          el('td', {}, el('code', {}, r.target)),
        )), plan.mantle.available ? el('tr', {},
          el('td', {}, 'Mantle boost'),
          el('td', {}, el('code', {}, formatValue(MANTLE_KEY, plan.mantle.now))),
          el('td', {}, el('code', {}, formatValue(MANTLE_KEY, plan.mantle.target))),
        ) : null),
      ),
      plan.mantle.available ? null : el('div', { class: 'adv-note' },
        el('b', {}, 'Mantle boost: '),
        'its setting wasn’t found in your profile.cfg, so the app can’t change it. In Apex, open the settings and set Mantle Boost to Movement Ability once.'),
      el('div', { class: 'tile-help' }, 'The semicolon in "+jump;+dodge" chains two commands on one key. Test it in the Firing Range after saving.'),
    ),
  );

  return el('div', {},
    el('div', { class: 'grid' }, toggle),
    el('div', { class: 'grid spaced' }, advanced),
  );
}

// ---- view: Skip intro & launch options ------------------------------------------------
// Launch options aren't in settings.cfg; they're typed into the launcher (Steam / EA app).
// Choices are remembered per PC in localStorage (a convenience; nothing breaks without it).

function loadLaunchState() {
  try {
    const saved = JSON.parse(localStorage.getItem('ace.launch'));
    if (saved && typeof saved.on === 'object') return { on: saved.on, extra: String(saved.extra || '') };
  } catch {
    /* ignore */
  }
  return { on: { novid: true }, extra: '' };
}

function saveLaunchState() {
  try {
    localStorage.setItem('ace.launch', JSON.stringify(state.launch));
  } catch {
    /* ignore */
  }
}

// onlyTier = just that tier's options (the line under Recommended); none = the full line.
function launchLine(onlyTier = null) {
  const parts = LAUNCH_OPTIONS.filter((o) => o.id in state.launch.on && (!onlyTier || o.tier === onlyTier)).map((o) => launchItemText(o, state.launch.on[o.id]));
  return parts.join(' ');
}

function setLaunchOption(id, value) {
  if (value === false) delete state.launch.on[id];
  else state.launch.on[id] = value;
  saveLaunchState();
  renderView();
}

async function copyText(text, what = 'Copied') {
  await window.api.copyText(text);
  toast(`${what} to clipboard`);
}

// Long content cut to a short preview that fades out, with a see-through "Show more" button
// floating over the fade. Expanded/collapsed is remembered per id while the app is open.
function fadeBox(id, ...content) {
  const open = !!state.expanded[id];
  const inner = el('div', { class: 'fade-inner' }, ...content);
  const box = el('div', { class: `fade-box${open ? '' : ' collapsed'}` }, inner);
  const btn = el('button', {
    class: 'fade-more',
    onclick: () => {
      state.expanded[id] = !state.expanded[id];
      // CSS can't animate to 'none', so set the real height first, then flip the class.
      inner.style.maxHeight = `${inner.scrollHeight}px`;
      void inner.offsetHeight; // apply that height now, so the change below animates
      box.classList.toggle('collapsed', !state.expanded[id]);
      btn.textContent = state.expanded[id] ? 'Show less' : 'Show more';
    },
  }, open ? 'Show less' : 'Show more');
  // Once fully open, drop the fixed height so content that loads later (or wraps) isn't cut off.
  inner.addEventListener('transitionend', () => { if (state.expanded[id]) inner.style.maxHeight = ''; });
  box.append(btn);
  // Short content: show it all, no fade and no button. (Measured once it is on screen.)
  requestAnimationFrame(() => { if (inner.scrollHeight <= FADE_HEIGHT + 10) box.classList.add('short'); });
  return box;
}
const FADE_HEIGHT = 150; // keep in sync with .fade-box.collapsed .fade-inner in guided.css

// "Copy to clipboard" button; shows ✓ Copied for a moment. Red when it's the main action.
function copyButton(text, primary = false) {
  const btn = el('button', {
    class: `btn small${primary ? ' primary' : ''}`,
    disabled: !text,
    onclick: async () => {
      await copyText(text, 'Launch options copied');
      btn.textContent = '✓ Copied';
      setTimeout(() => { btn.textContent = 'Copy to clipboard'; }, 1500);
    },
  }, 'Copy to clipboard');
  return btn;
}

function tierTag(tier) {
  const label = { recommended: 'Recommended', situational: 'Situational', myth: 'Not worth it' }[tier];
  return el('span', { class: `tier tier-${tier}` }, label);
}

// The card always previews its command; greyed out while the option is off.
function renderLaunchOption(opt) {
  const on = opt.id in state.launch.on;
  const value = on && opt.input ? state.launch.on[opt.id] : opt.input ? opt.input.default : null;
  const preview = el('code', {}, launchItemText(opt, value));
  const slider = opt.input && opt.input.slider;
  const sliderText = (v) => (slider.zero && v === '0' ? slider.zero : `${v} ${opt.input.label}`);
  const sliderValue = slider ? el('span', { class: 'slider-value' }, sliderText(value)) : null;

  return el('div', { class: `tile launch-tile${on ? ' on' : ''}${opt.tier === 'myth' ? ' myth' : ''}` },
    el('label', { class: 'launch-head' },
      el('div', {},
        el('div', { class: 'tile-label' }, opt.label, tierTag(opt.tier)),
        el('div', { class: 'tile-help' }, opt.help),
      ),
      el('input', { type: 'checkbox', class: 'switch', checked: on, onchange: (e) => setLaunchOption(opt.id, e.target.checked ? (opt.input ? value : true) : false) }),
    ),
    slider ? el('div', { class: 'slider-row' },
      el('input', {
        type: 'range', min: String(slider.min), max: String(slider.max), value, disabled: !on, 'aria-label': opt.label,
        oninput: (e) => {
          preview.textContent = launchItemText(opt, e.target.value);
          sliderValue.textContent = sliderText(e.target.value);
        },
        onchange: (e) => setLaunchOption(opt.id, e.target.value),
      }),
      sliderValue,
    ) : null,
    el('div', { class: `snippet${on ? '' : ' off'}` },
      preview,
      opt.input && !slider ? el('input', {
        class: 'num snippet-input',
        value,
        disabled: !on,
        'aria-label': opt.input.label,
        onchange: (e) => {
          if (!opt.input.pattern.test(e.target.value)) {
            e.target.value = value;
            return toast(`Enter a number for ${opt.label}`, true);
          }
          setLaunchOption(opt.id, e.target.value);
        },
      }) : null,
      opt.input && !slider ? el('span', { class: 'dim' }, opt.input.label) : null,
    ),
  );
}

// Full launch line, repeated under each section so it's always in view: pick a launcher,
// then Copy (+ paste steps) or, for Steam, write it straight in.
// full = the first line (Recommended): lead text, Apply to Steam, Copy, paste steps, Steam status.
// Otherwise just the line and Copy (the full line, under Situational).
function renderLinePreview(line, full) {
  // Each option is one unbreakable chunk, so a long line only wraps between options.
  const lineEl = line
    ? el('code', { class: 'launch-line' }, splitLaunchLine(line).map((i) => el('span', { class: 'token' }, [i.head, ...i.args].join(' '))))
    : el('code', { class: 'launch-line empty' }, 'Nothing selected yet');
  if (!full) return el('div', { class: 'section-line' }, lineEl, el('div', { class: 'line-actions' }, copyButton(line)));
  const st = steamWriteState(line);
  return el('div', { class: 'section-line' },
    el('p', { class: 'how-lead' }, 'Apply it to Steam launch options automatically, or copy it and paste it yourself (Steam or EA app):'),
    lineEl,
    el('div', { class: 'line-actions' },
      steamWriteButton(line, 'Apply to Steam launch options', !st.ready),
      el('span', { class: 'or-text' }, 'or copy manually to Steam'),
      copyButton(line)),
    el('div', {},
      el('p', { class: 'how-lead' }, 'To paste it yourself:'),
      el('ol', { class: 'where-steps' }, PASTE_STEPS.map((step) => el('li', {}, step)))),
    el('div', { class: 'steam-status' }, st.note),
  );
}


// Whether "Apply to Steam launch options" can run right now, plus a short note (and buttons) saying why not.
// Steam already has exactly this line (plus any kept extras) for the selected account?
function steamHasLine(line) {
  const acct = state.steam && state.steam.accounts.find((a) => a.id === state.steamAccount);
  return Boolean(line && acct && acct.launchOptions.trim() === mergeWithSteam(line, acct));
}

// Same size in both states; shows "✓ Written" until the line changes.
function steamWriteButton(line, label, disabled) {
  const done = steamHasLine(line);
  return el('button', {
    class: `btn small primary steam-write${done ? ' done' : ''}`,
    disabled: done || disabled,
    title: done ? 'Steam already has this exact line. Change an option to write again.' : null,
    onclick: () => writeSteam(line),
  }, done ? '✓ Written' : label);
}

function steamWriteState(line) {
  const s = state.steam;
  if (!s) return { ready: false, note: el('span', { class: 'dim' }, 'Looking for Steam…') };
  if (!s.found) return { ready: false, note: el('span', {}, 'Steam wasn’t found on this PC. Use Copy instead.') };
  if (state.steamClosing) return { ready: false, note: el('span', { class: 'warn-text' }, 'Closing Steam…') };
  if (s.running) {
    return {
      ready: false,
      note: el('span', { class: 'steam-running' },
        el('span', { class: 'warn-text' }, 'Close Steam first. It’s still running (maybe hidden in the tray near the clock).'),
        el('button', { class: 'btn tiny primary', onclick: closeSteam }, 'Close Steam for me'),
        el('button', { class: 'btn tiny', onclick: () => refreshSteam(true) }, 'Check again')),
    };
  }
  const acct = s.accounts.find((a) => a.id === state.steamAccount);
  if (!acct || !acct.hasApex) return { ready: false, note: el('span', {}, 'Apex wasn’t found in this Steam account. Pick another account in the box at the bottom.') };
  if (!line) return { ready: false, note: el('span', { class: 'dim' }, 'Turn on at least one option.') };
  const withApex = s.accounts.filter((a) => a.hasApex);
  return {
    ready: true,
    note: el('span', { class: 'steam-running' },
      el('span', { class: 'ok-text' }, steamHasLine(line) ? '✓ This line is in Steam for' : 'Steam is closed · ready to write to'),
      withApex.length > 1
        ? el('select', { class: 'raw account-pick', onchange: (e) => { state.steamAccount = e.target.value; state.confirm = null; renderView(); } },
          withApex.map((a) => el('option', { value: a.id, selected: a.id === acct.id }, a.name || `Account ${a.id}`)))
        : el('b', {}, acct.name || `account ${acct.id}`),
      el('span', { class: 'dim' }, 'A backup is made first.')),
  };
}

async function closeSteam() {
  state.steamClosing = true;
  renderView();
  try {
    const res = await window.api.steamShutdown();
    if (!res.ok) toast(res.message, true);
    else toast('Steam closed. You can write now.');
  } catch (err) {
    toast(`Could not close Steam: ${errorText(err)}`, true);
  }
  state.steamClosing = false;
  await refreshSteam();
}

function renderLaunch() {
  if (!state.steam && !state.steamLoading) refreshSteam();
  const line = launchLine();

  const sections = LAUNCH_TIERS.map(([tier, title, note]) => {
    const opts = LAUNCH_OPTIONS.filter((o) => o.tier === tier && matches(o.label, o.head, o.help));
    if (!opts.length) return null;
    return el('div', {},
      el('h3', { class: 'section-h' }, title),
      el('p', { class: 'note' }, note),
      el('div', { class: tier === 'recommended' ? 'grid two' : 'grid' }, opts.map(renderLaunchOption)),
      tier === 'myth' ? null : tier === 'recommended' ? renderLinePreview(launchLine('recommended'), true) : renderLinePreview(line, false),
    );
  });

  return el('div', {},
    sections,
    el('div', { class: 'grid spaced' }, renderSteamCard(line)),
  );
}

// ---- write straight into Steam -----------------------------------------------

async function refreshSteam(feedback = false) {
  state.steamLoading = true;
  try {
    state.steam = await window.api.steamStatus();
  } catch (err) {
    state.steam = { found: false, error: errorText(err), accounts: [] };
  }
  const ids = state.steam.accounts.map((a) => a.id);
  if (!ids.includes(state.steamAccount)) state.steamAccount = (state.steam.accounts.find((a) => a.hasApex) || state.steam.accounts[0] || {}).id || null;
  state.steamLoading = false;
  if (feedback) toast(state.steam.running ? 'Steam is still running. Use “Close Steam for me” or exit it from the tray.' : 'Steam is closed. Ready to write.', state.steam.running);
  if (state.view === 'launch') renderView();
}

function renderSteamCard(line) {
  const open = state.steamOpen;
  const body = [];
  if (open) {
    const s = state.steam;
    if (!s) {
      body.push(el('p', { class: 'dim' }, 'Looking for Steam…'));
    } else if (!s.found) {
      body.push(el('p', {}, 'Steam wasn’t found on this PC. Use Copy above instead.'));
    } else {
      const acct = s.accounts.find((a) => a.id === state.steamAccount);
      body.push(
        s.running || state.steamClosing ? el('div', { class: 'banner warn' }, steamWriteState(line).note) : null,
        el('label', { class: 'steam-row' },
          el('span', { class: 'extra-label' }, 'Steam account'),
          el('select', { class: 'raw', onchange: (e) => { state.steamAccount = e.target.value; state.confirm = null; renderView(); } },
            s.accounts.map((a) => el('option', { value: a.id, selected: a.id === state.steamAccount },
              `${a.name || `Account ${a.id}`}${a.hasApex ? '' : ' (Apex not found)'}`)))),
        acct ? el('div', { class: 'steam-row' },
          el('span', { class: 'extra-label' }, 'In Steam now'),
          el('code', { class: 'launch-line small' }, acct.launchOptions || '(empty)')) : null,
        el('div', { class: 'steam-actions' },
          el('button', {
            class: 'btn small',
            disabled: !acct || !acct.launchOptions,
            onclick: () => {
              state.launch = importLaunchLine(acct.launchOptions);
              saveLaunchState();
              renderView();
              toast('Loaded your Steam launch options into the toggles');
            },
          }, '↓ Load into the toggles'),
        ),
        el('p', { class: 'note' }, 'Applying to Steam (the red button under Recommended) backs up Steam’s settings file first and only changes Apex’s launch options. It only works for Steam; for the EA app, use Copy to clipboard.'),
      );
    }
  }

  return el('div', { class: 'tile wide steam-card', id: 'steam-card' },
    el('details', {
      open,
      ontoggle: (e) => {
        state.steamOpen = e.target.open;
        if (e.target.open && !state.steam) refreshSteam();
      },
    },
    el('summary', { class: 'tile-label' }, 'Steam account & launch options in Steam now'),
    body),
  );
}

// Options already in Steam that the app has no toggle for (e.g. +cl_is_softened_locale) are
// kept, so writing never silently removes something the player set up themselves.
function mergeWithSteam(line, acct) {
  const keep = acct ? importLaunchLine(acct.launchOptions || '').extra : '';
  const have = new Set(line.split(/\s+/));
  const extra = splitLaunchLine(keep).map((i) => [i.head, ...i.args].join(' ')).filter((t) => !have.has(t.split(' ')[0]));
  return [line, ...extra].join(' ').trim();
}

async function writeSteam(line) {
  state.confirm = null;
  const acct = state.steam && state.steam.accounts.find((a) => a.id === state.steamAccount);
  line = mergeWithSteam(line, acct);
  try {
    const res = await window.api.steamWrite(state.steamAccount, line);
    if (!res.ok) {
      toast(res.message, true);
    } else {
      toast(`Written to ${acct && acct.name ? acct.name : 'Steam'}. Start Steam and check Apex → Properties.`);
    }
  } catch (err) {
    toast(`Could not write to Steam: ${errorText(err)}`, true);
  }
  await refreshSteam();
}

// ---- view: Graphics & video -------------------------------------------------------------
// Resolution, display mode and quality live in videoconfig.txt; the few graphics toggles that
// live in settings.cfg are shown at the bottom.

const vKey = (name) => `video:${name}`;
const vCurrent = (name) => current(vKey(name));

// Several videoconfig values as ONE undo step (e.g. width + height, or a preset).
function setVideo(values) {
  const next = { ...changes() };
  for (const [name, value] of Object.entries(values)) {
    const key = vKey(name);
    if (value === original(key)) delete next[key];
    else next[key] = value;
  }
  commit(next, null);
}

function nativeRes() {
  const v = state.video.values;
  const w = Number(v['setting.last_display_width'] || v['setting.defaultres']);
  const h = Number(v['setting.last_display_height'] || v['setting.defaultresheight']);
  return { w, h };
}

function displayModeNow() {
  if (vCurrent('setting.fullscreen') === '1') return 'fullscreen';
  return vCurrent('setting.nowindowborder') === '1' ? 'borderless' : 'windowed';
}

function renderVideoSelect(item) {
  const key = vKey(item.key);
  const orig = original(key);
  if (orig === null) {
    return el('div', { class: 'tile missing' }, el('div', { class: 'tile-label' }, item.label), el('div', { class: 'tile-help' }, 'Not in your file'));
  }
  const cur = current(key);
  const options = item.options.some((o) => o[0] === cur) ? item.options : [...item.options, [cur, `Custom (${cur})`]];
  return el('div', { class: `tile row-card${key in changes() ? ' changed' : ''}`, dataset: { name: key } },
    el('div', {},
      el('div', { class: 'tile-label' }, item.label, item.verified ? null : el('span', { class: 'unverified', title: 'Value names come from community guides' }, '?')),
      el('div', { class: 'tile-help' }, item.help),
      el('code', { class: 'tile-cvar' }, `${item.key} · saved: ${formatValue(key, orig)}`)),
    el('select', { class: 'raw video-select', onchange: (e) => setChange(key, e.target.value) },
      options.map(([value, label]) => el('option', { value, selected: value === cur }, label))),
  );
}

function renderResolution() {
  const native = nativeRes();
  const w = Number(vCurrent('setting.defaultres'));
  const h = Number(vCurrent('setting.defaultresheight'));
  const changed = [vKey('setting.defaultres'), vKey('setting.defaultresheight')].some((k) => k in changes());
  const activePreset = STRETCH_PRESETS.find(([, , ratio]) => (ratio
    ? h === native.h && w === Math.round(native.h * ratio)
    : w === native.w && h === native.h));

  const sizeInput = (name, value) => el('input', {
    class: 'num res-input',
    value: String(value),
    onchange: (e) => {
      const n = Number(e.target.value);
      if (!Number.isInteger(n) || n < 480 || n > 7680) {
        e.target.value = String(value);
        return toast('Enter a whole number between 480 and 7680', true);
      }
      setVideo({ [name]: String(n) });
    },
  });

  // A long thin card: text on the left, the presets and width × height below them on the right.
  return el('div', { class: `tile row-card top${changed ? ' changed' : ''}` },
    el('div', {},
      el('div', { class: 'tile-label' }, 'Resolution'),
      el('div', { class: 'tile-help' }, `Your monitor: ${native.w} × ${native.h}. Pick a preset or type your own.`)),
    el('div', { class: 'row-controls' },
    el('div', { class: 'segmented small btn-grid cols-2' }, STRETCH_PRESETS.map(([id, label, ratio]) =>
      el('button', {
        class: activePreset && activePreset[0] === id ? 'active' : '',
        onclick: () => setVideo(ratio
          ? { 'setting.defaultres': String(Math.round(native.h * ratio)), 'setting.defaultresheight': String(native.h) }
          : { 'setting.defaultres': String(native.w), 'setting.defaultresheight': String(native.h) }),
      }, label))),
    el('div', { class: 'res-row' }, sizeInput('setting.defaultres', w), el('span', { class: 'dim' }, '×'), sizeInput('setting.defaultresheight', h))),
  );
}

function renderDisplayMode() {
  const mode = displayModeNow();
  const changed = [vKey('setting.fullscreen'), vKey('setting.nowindowborder')].some((k) => k in changes());
  const info = DISPLAY_MODES.find((m) => m[0] === mode);
  return el('div', { class: `tile row-card${changed ? ' changed' : ''}` },
    el('div', {},
      el('div', { class: 'tile-label' }, 'Display mode'),
      el('div', { class: 'tile-help' }, info ? info[3] : '')),
    el('div', { class: 'segmented small btn-grid cols-3' }, DISPLAY_MODES.map(([id, label, values]) =>
      el('button', { class: mode === id ? 'active' : '', onclick: () => setVideo(values) }, label))),
  );
}

function renderStretchGuide() {
  const native = nativeRes();
  const w = Number(vCurrent('setting.defaultres'));
  const h = Number(vCurrent('setting.defaultresheight'));
  if (!w || !h || Math.abs(w / h - native.w / native.h) < 0.01) return null;
  const guide = SCALING_GUIDES.find((g) => g[0] === state.scalingGuide);
  return el('div', { class: 'tile wide stretch-guide' },
    el('div', { class: 'tile-label' }, `Make ${w} × ${h} actually stretch`),
    el('div', { class: 'tile-help' }, 'The app sets the resolution, but your graphics card decides whether it stretches or shows black bars. Do this once in your GPU’s control panel:'),
    el('div', { class: 'segmented small' }, SCALING_GUIDES.map(([id, label]) =>
      el('button', { class: state.scalingGuide === id ? 'active' : '', onclick: () => { state.scalingGuide = id; renderView(); } }, label))),
    el('ol', { class: 'where-steps' }, guide[2].map((s) => el('li', {}, s))),
    el('div', { class: 'tile-help' }, displayModeNow() === 'fullscreen'
      ? 'Display mode is Full screen ✓ (stretching doesn’t work in borderless or windowed).'
      : el('span', { class: 'warn-text' }, '⚠ Switch Display mode to Full screen. Stretching doesn’t work in borderless or windowed.')),
  );
}

// Low / Medium / High in one click: every Quality card except the texture budget, which
// depends on how much video memory the GPU has, not on taste.
function qualityNow() {
  const hit = QUALITY_PRESETS.find(([, , values]) => Object.entries(values).every(([name, value]) => original(vKey(name)) === null || vCurrent(name) === value));
  return hit ? hit[0] : null;
}

function renderQualityPresets() {
  const now = qualityNow();
  const info = QUALITY_PRESETS.find((p) => p[0] === now);
  // Centred on purpose: it splits the list into display settings above and visual quality below.
  return el('div', { class: 'tile quality-divider' },
    el('div', {},
      el('div', { class: 'tile-label' }, 'Quality preset'),
      el('div', { class: 'tile-help' }, info ? info[3] : 'Your own mix right now. One click sets shadows, lighting, effects and detail below.')),
    el('div', { class: 'segmented small btn-grid cols-4' },
      QUALITY_PRESETS.map(([id, label, values]) =>
        el('button', {
          class: now === id ? 'active' : '',
          onclick: () => setVideo(Object.fromEntries(Object.entries(values).filter(([name]) => original(vKey(name)) !== null))),
        }, label)),
      // Custom = your own mix. Lit when no preset matches; clicking it puts back the values saved in your file.
      el('button', {
        class: now === null ? 'active' : '',
        title: 'Your own settings, as saved in your file',
        onclick: () => {
          const names = [...new Set(QUALITY_PRESETS.flatMap(([, , values]) => Object.keys(values)))];
          setVideo(Object.fromEntries(names.filter((name) => original(vKey(name)) !== null).map((name) => [name, original(vKey(name))])));
        },
      }, 'Custom')),
  );
}

// Performance mode: one card at the top of Performance, now → preset for every setting it
// touches, split into what Apex's video menu shows and what only exists in the file.
// Display mode is two values in the file, so it's shown as one row.
function renderPerformance({ full = false } = {}) {
  const entries = Object.entries(PERFORMANCE_PRESET).filter(([name]) => original(vKey(name)) !== null);
  const fovKey = 'profile:cl_fovScale';
  const hasFov = original(fovKey) !== null;
  const fovPending = hasFov && toFov(current(fovKey)) !== 110;
  const pending = entries.filter(([name, value]) => vCurrent(name) !== value);
  const total = pending.length + (fovPending ? 1 : 0);
  const apply = () => {
    const values = Object.fromEntries(pending.map(([name, value]) => [vKey(name), value]));
    if (fovPending) values[fovKey] = MAX_FOV_SCALE;
    setMany(values);
    toast(`Performance mode added ${total} change${total > 1 ? 's' : ''} to pending`);
  };
  const modeLabel = (id) => (DISPLAY_MODES.find((m) => m[0] === id) || [, id])[1];
  const diffRow = (label, now, to) => {
    const same = now === to;
    return el('div', { class: `wiz-diff-row${same ? ' same' : ''}` },
      el('span', {}, label),
      same ? el('span', { class: 'dim' }, now) : el('span', { class: 'old' }, now),
      el('span', { class: 'to' }, same ? '' : '→'),
      same ? el('span', { class: 'ok-text' }, '✓ already') : el('span', { class: 'new' }, to));
  };
  const isMode = (name) => name === 'setting.fullscreen' || name === 'setting.nowindowborder';
  const row = ([name, value]) => diffRow(labelFor(vKey(name)), formatValue(vKey(name), vCurrent(name)), formatValue(vKey(name), value));
  const inGame = [
    entries.some(([name]) => isMode(name)) ? diffRow('Display mode', modeLabel(displayModeNow()), modeLabel('fullscreen')) : null,
    ...entries.filter(([name]) => !isMode(name) && !CFG_ONLY.has(name)).map(row),
  ];
  const cfgOnly = entries.filter(([name]) => CFG_ONLY.has(name));
  // name | explanation | file value → preset | its own switch: on adds just this one change to
  // pending, off takes it back out. Already at the preset value = nothing to switch.
  const cfgOnlyRow = ([name, value]) => {
    const key = vKey(name);
    const was = original(key);
    const already = was === value;
    return el('div', { class: `wiz-diff-row with-help${already ? ' same' : ''}` },
      el('span', {}, labelFor(key)),
      el('span', { class: 'diff-help' }, CFG_ONLY_HELP[name] || ''),
      already ? el('span', { class: 'dim' }, formatValue(key, was)) : el('span', { class: 'old' }, formatValue(key, was)),
      el('span', { class: 'to' }, already ? '' : '→'),
      already ? el('span', { class: 'ok-text' }, '✓ already') : el('span', { class: 'new' }, formatValue(key, value)),
      el('input', {
        type: 'checkbox', class: 'switch', checked: already || vCurrent(name) === value, disabled: already,
        title: already ? 'Already at this value' : 'Add or remove just this change',
        onchange: (e) => setChange(key, e.target.checked ? value : was),
      }));
  };
  return el('div', { class: 'tile wide preset' },
    el('div', { class: 'preset-head' },
      el('div', {},
        el('div', { class: 'tile-label' }, 'Graphics performance mode'),
        el('div', { class: 'tile-help' }, 'Max FPS and the clearest view of enemies: shadows, fog, haze and clutter off, max FOV, no V-Sync. Textures stay sharp.'),
      ),
      total
        ? el('button', { class: 'btn primary', onclick: apply }, `Apply (${total} change${total > 1 ? 's' : ''})`)
        : el('span', { class: 'ok-text' }, '✓ Already applied'),
    ),
    (full ? (...kids) => el('div', {}, ...kids) : (...kids) => fadeBox('performance', ...kids))(
      hasFov ? el('div', { class: 'wiz-diff' }, diffRow('Field of view (max)', `${toFov(current(fovKey))}°`, '110°')) : null,
      cfgOnly.length ? el('h4', { class: 'diff-h' }, 'Config file only') : null,
      cfgOnly.length ? el('p', { class: 'diff-note' }, 'Keep files read-only, or Apex may reset these.') : null,
      cfgOnly.length ? el('div', { class: 'wiz-diff' }, cfgOnly.map(cfgOnlyRow)) : null,
      el('h4', { class: 'diff-h' }, 'In Apex’s video menu'),
      el('div', { class: 'wiz-diff' }, inGame)),
  );
}

// Graphics & video: ONE list of thin rows, most important for competitive players first.
// Strings are videoconfig keys; the special entries are drawn by their own functions.
const GRAPHICS_ORDER = [
  'fov', 'display', 'resolution', 'stretch',
  'quality-preset',
  'setting.mat_vsync_mode', 'setting.dvs_enable', 'setting.mat_antialias_mode', 'low-latency',
  'setting.volumetric_lighting', 'setting.csm_coverage', 'setting.csm_cascade_res', 'setting.shadow_enable',
  'setting.ssao_quality', 'setting.particle_cpu_level', 'setting.r_lod_switch_scale',
  'setting.stream_memory', 'setting.mat_forceaniso', 'setting.cl_ragdoll_maxcount',
];
const LOW_LATENCY = ['gfx_nvnUseLowLatency', 'gfx_nvnUseLowLatencyBoost', 'gfx_amdUseLowLatency'];

// NVIDIA Reflex is two switches in the file; players know it as one setting: Off / On / On + Boost.
const REFLEX_KEYS = ['gfx_nvnUseLowLatency', 'gfx_nvnUseLowLatencyBoost'];
const REFLEX_MODES = [['off', 'Off', ['0', '0']], ['on', 'On', ['1', '0']], ['boost', 'On + Boost', ['1', '1']]];

function renderReflex() {
  if (REFLEX_KEYS.some((k) => original(k) === null)) return null;
  const [on, boost] = REFLEX_KEYS.map((k) => current(k));
  const mode = on !== '1' ? 'off' : boost === '1' ? 'boost' : 'on';
  const changed = REFLEX_KEYS.some((k) => k in changes() && !quietKeys().has(k));
  return el('div', { class: `tile row-card${changed ? ' changed' : ''}` },
    el('div', {},
      el('div', { class: 'tile-label' }, 'NVIDIA Reflex', el('span', { class: 'unverified', title: 'Exact in-game effect not verified' }, '?')),
      el('div', { class: 'tile-help' }, 'Less input lag on NVIDIA GPUs. Boost cuts a little more, but the GPU uses more power.'),
      el('code', { class: 'tile-cvar' }, `${REFLEX_KEYS.join(' + ')} · saved: ${(REFLEX_MODES.find(([, , v]) => v[0] === (original(REFLEX_KEYS[0]) === '1' ? '1' : '0') && v[1] === (original(REFLEX_KEYS[0]) === '1' && original(REFLEX_KEYS[1]) === '1' ? '1' : '0')) || [, '?'])[1]}`)),
    el('div', { class: 'segmented small btn-grid cols-3' }, REFLEX_MODES.map(([id, label, values]) =>
      el('button', { class: mode === id ? 'active' : '', onclick: () => setMany({ [REFLEX_KEYS[0]]: values[0], [REFLEX_KEYS[1]]: values[1] }) }, label))),
  );
}

function renderGraphics() {
  const catalogItem = (name) => state.info.catalog.find((c) => c.name === name && matches(c.label, c.name, c.help));
  const fovItem = catalogItem('profile:cl_fovScale');
  const lowLatency = LOW_LATENCY.map(catalogItem).filter(Boolean);
  const otherItems = state.info.catalog.filter((c) => c.section === 'graphics' && c.name !== 'profile:cl_fovScale' && !LOW_LATENCY.includes(c.name) && matches(c.label, c.name, c.help));
  const other = otherItems.length ? [
    el('h3', { class: 'section-h' }, 'Other'),
    el('div', { class: 'grid' }, otherItems.map(renderControl)),
  ] : [];

  if (!state.video || !state.video.exists) {
    return el('div', {},
      el('div', { class: 'banner warn' }, 'videoconfig.txt wasn’t found next to your settings file, so resolution and quality can’t be changed. Launch Apex once so the game creates it.'),
      other);
  }

  const searching = Boolean(state.query);
  const build = (id) => {
    if (id === 'fov') return fovItem ? [(() => { const t = renderControl(fovItem); t.classList.add('inline-slider'); return t; })()] : [];
    if (id === 'display') return searching && !matches('Display mode full screen borderless windowed') ? [] : [renderDisplayMode()];
    if (id === 'resolution') return searching && !matches('Resolution stretched') ? [] : [renderResolution()];
    if (id === 'stretch') return [renderStretchGuide()].filter(Boolean);
    if (id === 'low-latency') {
      const reflex = searching && !matches('NVIDIA Reflex low latency boost') ? null : renderReflex();
      return [reflex, ...lowLatency.filter((c) => !REFLEX_KEYS.includes(c.name)).map(renderControl)].filter(Boolean);
    }
    if (id === 'quality-preset') return searching && !matches('Quality preset low medium high') ? [] : [renderQualityPresets()];
    const item = VIDEO_SETTINGS.find((v) => v.key === id);
    return item && matches(item.label, item.key, item.help) ? [renderVideoSelect(item)] : [];
  };
  // Above the quality preset: long thin rows. The preset itself: centred divider.
  // Below it: normal cards, two per row (the row layout is switched off for them).
  const cut = GRAPHICS_ORDER.indexOf('quality-preset');
  const top = GRAPHICS_ORDER.slice(0, cut).flatMap(build);
  const preset = build('quality-preset');
  const cards = GRAPHICS_ORDER.slice(cut + 1).flatMap(build);
  cards.forEach((c) => c.classList.remove('row-card'));

  return el('div', {},
    el('p', { class: 'note' }, 'Most important for competitive play first.'),
    el('div', { class: 'grid stacked' }, top),
    preset.length ? el('div', { class: 'grid stacked spaced' }, preset) : null,
    cards.length ? el('div', { class: 'grid two spaced' }, cards) : null,
    other,
    el('p', { class: 'note spaced' }, 'While your files are read-only, graphics changes made in Apex’s own menu won’t stick. Change them here instead.'),
  );
}

// ---- view: Controller (Advanced Look Controls) ---------------------------------------------
// Everything here lives in profile.cfg. The zero deadzone toggle needs ALC on too: Apex
// ignores the ALC deadzone while Custom Look Controls are off.

const ALC_KEY = 'profile:gamepad_custom_enabled';
const DEADZONE_KEY = 'profile:gamepad_custom_deadzone_in';
const PRO_PREV = 'ace.proPrev'; // localStorage: the player's own values from before a pro toggle

// Pro setups as profile.cfg values (deadzones and ramp-up times as 0–1, so 3% = '0.03').
// The non-ALC menu numbers were read from the file after picking them in game (Oct 2026):
// Look Sensitivity 4 (High) = aim_speed "3", ADS 3 (Default) = aim_speed_ads_0 "2",
// Linear = look_curve "4", Look Deadzone None = "0", Movement Deadzone Small = "1".
const PRO_PRESETS = [
  {
    name: 'ImperialHal',
    short: 'The classic “4-3 Linear”: no ALC, no look deadzone.',
    about: 'Apex’s simple look settings instead of ALC: Look Sensitivity 4, ADS 3, Linear curve, no look deadzone, small movement deadzone. He skips ALC because, in his words, there are too many settings to dial in, and 4-3 feels more consistent. Dezignful uses the same setup.',
    source: 'prosettings.net, updated Jun 8, 2026',
    values: {
      'profile:gamepad_custom_enabled': '0',
      'profile:gamepad_aim_speed': '3',
      'profile:gamepad_aim_speed_ads_0': '2',
      'profile:gamepad_look_curve': '4',
      'profile:gamepad_deadzone_index_look': '0',
      'profile:gamepad_deadzone_index_move': '1',
    },
    buttons: {
      source: 'prosettings.net, updated Jun 8, 2026 (only vibration is published)',
      options: [
      { label: 'Vibration', value: 'Off', key: 'profile:joy_rumble', verified: false },
      ],
    },
  },
  {
    name: 'Genburten',
    short: 'Very fast hipfire, slow ADS, zero deadzone.',
    about: 'Fast 500/500 hipfire for close fights, slow 130/130 ADS for steady long-range aim, no deadzone and a linear curve (0). A rare, very fast setup: expect it to feel twitchy at first.',
    source: 'prosettings.net, updated Jun 20, 2025',
    values: {
      'profile:gamepad_custom_enabled': '1',
      'profile:gamepad_custom_deadzone_in': '0',
      'profile:gamepad_custom_deadzone_out': '0.03',
      'profile:gamepad_custom_curve': '0',
      'profile:gamepad_custom_hip_yaw': '500',
      'profile:gamepad_custom_hip_pitch': '500',
      'profile:gamepad_custom_hip_turn_yaw': '10',
      'profile:gamepad_custom_hip_turn_pitch': '0',
      'profile:gamepad_custom_hip_turn_time': '0',
      'profile:gamepad_custom_hip_turn_delay': '0',
      'profile:gamepad_custom_ads_yaw': '130',
      'profile:gamepad_custom_ads_pitch': '130',
      'profile:gamepad_custom_ads_turn_yaw': '0',
      'profile:gamepad_custom_ads_turn_pitch': '0',
      'profile:gamepad_custom_ads_turn_time': '0',
      'profile:gamepad_custom_ads_turn_delay': '0',
    },
    buttons: {
      source: 'esports.net, May 26, 2025 (binds) and prosettings.net, Jun 20, 2025 (options). PlayStation buttons, Xbox in brackets',
      // His custom layout as profile.cfg stores it: slot = physical button, number = the action
      // that button has by default (see PAD_SLOTS). Ping, melee and sprint left where they fit.
      values: {
        'profile:gamepad_button_layout': '6',
        'profile:gamepad_custom_pilot': '0,9,2,3,6,5,4,7,8,1,10,11,12,13,14',
      },
      options: [
      { label: 'Button layout', value: 'Custom', layout: true },
      { label: 'Jump', value: 'X (A)', layout: true },
      { label: 'Crouch', value: 'R3 (RS)', layout: true },
      { label: 'Interact / reload', value: 'Square (X)', layout: true },
      { label: 'Cycle weapon / holster', value: 'Triangle (Y)', layout: true },
      { label: 'Tactical ability', value: 'L2 (LT)', layout: true },
      { label: 'Fire', value: 'R2 (RT)', layout: true },
      { label: 'Aim', value: 'L1 (LB)', layout: true },
      { label: 'Ultimate ability', value: 'L2 + R2', verified: false },
      { label: 'Health / shield kit', value: 'D-pad up', layout: true },
      { label: 'Fire mode', value: 'D-pad left', layout: true },
      { label: 'Grenade', value: 'D-pad right', layout: true },
      { label: 'Extra character action', value: 'D-pad down', layout: true },
      { label: 'Map', value: 'Share (View)', layout: true },
      { label: 'Interact / reload button', value: 'Tap to use and reload', key: 'profile:gamepad_use_type', verified: false },
      { label: 'Crouch button', value: 'Toggle', key: 'profile:gamepad_togglecrouch_hold', verified: false },
      { label: 'Aim button', value: 'Hold', key: 'profile:gamepad_toggle_ads', verified: false },
      { label: 'Survival slot button', value: 'On', key: 'profile:gamepad_toggle_survivalSlot_to_weaponInspect', verified: false },
      { label: 'Trigger deadzones', value: 'None', key: 'profile:gamepad_trigger_threshold', verified: false },
      { label: 'Vibration', value: 'Off', key: 'profile:joy_rumble', verified: false },
      ],
    },
  },
  {
    name: 'Extesyy',
    short: 'Buttons below; his sensitivity isn’t published as text yet.',
    about: 'His ALC numbers only appear as screenshots in a 2023 article, so they aren’t here yet.',
    source: null,
    values: {},
    buttons: {
      source: 'techynicky.com (from his YouTube), Sep 21, 2023',
      options: [
      { label: 'Button layout', value: 'Not published', verified: false },
      { label: 'Stick layout', value: 'Default', key: 'profile:gamepad_stick_layout', verified: false },
      { label: 'Interact / reload button', value: 'Tap to use and reload', key: 'profile:gamepad_use_type', verified: false },
      { label: 'Crouch button', value: 'Hold', key: 'profile:gamepad_togglecrouch_hold', verified: false },
      { label: 'Aim button', value: 'Hold', key: 'profile:gamepad_toggle_ads', verified: false },
      { label: 'Survival slot button', value: 'Off', key: 'profile:gamepad_toggle_survivalSlot_to_weaponInspect', verified: false },
      { label: 'Trigger deadzones', value: 'None', key: 'profile:gamepad_trigger_threshold', verified: false },
      { label: 'Vibration', value: 'Off', key: 'profile:joy_rumble', verified: false },
      ],
    },
  },
  {
    name: 'Gild',
    short: 'Nothing confirmed yet: sources disagree on 4-3 Linear vs 4-3 Classic.',
    about: 'All sources agree on Look Sensitivity 4, ADS 3, look deadzone None and movement deadzone Small. The curve (Linear or Classic) still needs checking.',
    source: null,
    values: {},
    buttons: { source: null, options: [] },
  },
  {
    name: 'Recommended competitive',
    short: 'What most roller pros land on: a balanced ALC starting point.',
    about: 'Zero deadzone and a linear curve for instant response, 400/250 hipfire (pros mostly sit around 350–400 yaw and 250–280 pitch), and a slower 130/85 ADS where the lower pitch helps hold vertical recoil. No turning boost or ramp-up, so the stick always feels the same. Start here, then change one thing at a time in the Firing Range.',
    source: 'the common ranges in pro settings lists and controller guides (setup.gg, prosettings.net)',
    values: {
      'profile:gamepad_custom_enabled': '1',
      'profile:gamepad_custom_deadzone_in': '0',
      'profile:gamepad_custom_deadzone_out': '0.02',
      'profile:gamepad_custom_curve': '0',
      'profile:gamepad_custom_hip_yaw': '400',
      'profile:gamepad_custom_hip_pitch': '250',
      'profile:gamepad_custom_hip_turn_yaw': '0',
      'profile:gamepad_custom_hip_turn_pitch': '0',
      'profile:gamepad_custom_hip_turn_time': '0',
      'profile:gamepad_custom_hip_turn_delay': '0',
      'profile:gamepad_custom_ads_yaw': '130',
      'profile:gamepad_custom_ads_pitch': '85',
      'profile:gamepad_custom_ads_turn_yaw': '0',
      'profile:gamepad_custom_ads_turn_pitch': '0',
      'profile:gamepad_custom_ads_turn_time': '0',
      'profile:gamepad_custom_ads_turn_delay': '0',
    },
  },
];

// Every setting any pro toggle touches: turning one off puts ALL of these back.
const PRO_KEYS = [...new Set(PRO_PRESETS.flatMap((p) => Object.keys(p.values)))];

// Several settings as ONE undo step. `quiet` = keys changed only as a side effect (not shown red).
function setMany(values, quiet = []) {
  const next = { ...changes() };
  const q = new Set(quietKeys());
  for (const [key, value] of Object.entries(values)) {
    if (value === original(key)) delete next[key];
    else next[key] = value;
    if (quiet.includes(key)) q.add(key);
    else q.delete(key);
  }
  commit(withQuiet(next, q), null);
}

// Same number = same value: "0", "0.0" and "0.00" all mean zero.
const sameNumber = (a, b) => a !== null && b !== null && Number(a) === Number(b);

// ---- pro toggles ----

const presetKeys = (preset) => Object.keys(preset.values).filter((key) => original(key) !== null);
const presetIsOn = (preset) => presetKeys(preset).length > 0 && presetKeys(preset).every((key) => sameNumber(current(key), preset.values[key]));

function loadProPrev() {
  try {
    const prev = JSON.parse(localStorage.getItem(PRO_PREV));
    return prev && typeof prev === 'object' ? prev : null;
  } catch {
    return null;
  }
}

// On = the player's own values for every pro key, then this pro's values on top, so only
// one pro is ever on. Off = the player's own values come back.
function setPreset(preset, on) {
  delete state.expanded[`pro:${preset.name}`]; // the card collapses again when its toggle is flipped
  const savedIsPro = PRO_PRESETS.some((p) => presetKeys(p).length > 0 && presetKeys(p).every((key) => sameNumber(original(key), p.values[key])));
  let prev = loadProPrev();
  if (!savedIsPro || !prev) {
    // The saved file is the player's own setup: remember it (it may have changed since last time).
    prev = Object.fromEntries(PRO_KEYS.filter((key) => original(key) !== null).map((key) => [key, original(key)]));
    if (!savedIsPro) {
      try {
        localStorage.setItem(PRO_PREV, JSON.stringify(prev));
      } catch {
        /* ignore: turning off then just drops the pending changes */
      }
    }
  }
  const own = Object.fromEntries(PRO_KEYS.filter((key) => original(key) !== null).map((key) => [key, prev[key] ?? original(key)]));
  if (on) {
    const values = { ...own };
    for (const key of presetKeys(preset)) values[key] = preset.values[key];
    setMany(values, PRO_KEYS.filter((key) => key !== DEADZONE_KEY));
    toast(`${preset.name}’s settings added to pending changes. Press Save… to apply.`);
  } else {
    setMany(own, PRO_KEYS.filter((key) => key !== DEADZONE_KEY));
    toast('Your own settings are back in pending changes. Press Save… to apply.');
  }
}

// One pro card: big name, then two tabs (Sensitivity | Button layout) that are always on screen,
// so the button part can't be missed further down. Each tab has its own switch.
function renderProPreset(preset) {
  const on = presetIsOn(preset);
  const pending = presetKeys(preset).some((key) => key in changes());
  // Red only when THIS pro was switched: on and not saved yet, or saved on and now switched off.
  const savedOn = presetKeys(preset).length > 0 && presetKeys(preset).every((key) => sameNumber(original(key), preset.values[key]));
  const red = pending && (on || savedOn);
  const hasSens = presetKeys(preset).length > 0;
  const status = !hasSens ? 'Not published yet'
    : on ? (pending ? 'On · not saved yet' : 'On · saved in your file')
      : (pending ? 'Off · not saved yet' : 'Off');
  const rows = presetKeys(preset).map((key) => {
    const value = preset.values[key];
    const same = sameNumber(current(key), value);
    const now = formatValue(key, current(key));
    return el('div', { class: `wiz-diff-row${same ? ' same' : ''}` },
      el('span', {}, labelFor(key)),
      same ? el('span', { class: 'dim' }, now) : el('span', { class: 'old' }, now),
      el('span', { class: 'to' }, same ? '' : '→'),
      same ? el('span', { class: 'ok-text' }, '✓ already') : el('span', { class: 'new' }, formatValue(key, value)));
  });

  const sensTab = () => el('div', {},
    el('label', { class: 'pro-switch-row' },
      el('div', {}, el('div', { class: 'adv-title' }, 'Use their sensitivity'), el('code', { class: 'tile-cvar' }, status)),
      el('input', { type: 'checkbox', class: 'switch', checked: on, disabled: !hasSens, onchange: (e) => setPreset(preset, e.target.checked) })),
    el('p', { class: 'tile-help' }, preset.about),
    hasSens ? fadeBox(`pro:${preset.name}`, el('div', { class: 'wiz-diff' }, rows)) : null,
    preset.source ? el('p', { class: 'tile-help dim' }, `Source: ${preset.source}. Pros change their settings often, so treat this as a starting point.`) : null,
  );

  // No button data (e.g. the Recommended card): just the sensitivity part, no tabs.
  if (!preset.buttons) {
    return el('div', { class: `tile pro${red ? ' changed' : ''}` },
      el('div', { class: 'pro-name' }, preset.name), el('div', { class: 'tile-help' }, preset.short), sensTab());
  }
  const btnOn = proButtonsOn(preset);
  const tab = state.proTab[preset.name] || (hasSens ? 'sens' : 'buttons');
  const tabBtn = (id, label, isOn) => el('button', {
    class: tab === id ? 'active' : '',
    onclick: () => { state.proTab[preset.name] = id; renderView(); },
  }, label, isOn ? el('span', { class: 'pro-tab-on' }, ' ● on') : null);
  return el('div', { class: `tile pro${red || proButtonsPending(preset) ? ' changed' : ''}` },
    el('div', { class: 'pro-name' }, preset.name),
    el('div', { class: 'tile-help' }, preset.short),
    el('div', { class: 'segmented small pro-tabs' }, tabBtn('sens', 'Sensitivity', on), tabBtn('buttons', 'Button layout', btnOn)),
    tab === 'sens' ? sensTab() : renderProButtons(preset),
  );
}

// Custom button layout (profile.cfg gamepad_custom_pilot): 15 comma-separated numbers, one per
// physical button in this order; each number is the action that button has by default. Worked
// out from Diego's own layout (Oct 2026): "2,10,1,0,4,…" = A interact, B heal, X crouch, Y jump.
// Default actions: 0 jump, 1 crouch, 2 interact, 3 cycle weapon, 4 aim, 5 fire, 6 tactical,
// 7 ping, 8 sprint, 9 melee, 10 heal, 11 extra character action, 12 fire mode, 13 grenade, 14 map.
// gamepad_button_layout "6" = Custom. Slots 11-13 (D-pad down/left/right order) are a guess:
// both Diego and Genburten keep those three on their defaults, so it hasn't mattered yet.
const PAD_SLOTS = ['A', 'B', 'X', 'Y', 'LT', 'RT', 'LB', 'RB', 'L3', 'R3', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'View'];

// The Button layout part of a pro card: what they pick in Apex's Controls menu, with its own switch.
// `key` = where profile.cfg probably keeps it; only `verified` rows (with a `set` value) are
// ever written, so the switch stays off until the mapping is checked in game.
const proButtonValues = (preset) => Object.fromEntries([
  ...Object.entries(preset.buttons.values || {}),
  ...preset.buttons.options.filter((o) => o.verified && o.key).map((o) => [o.key, o.set]),
].filter(([key]) => original(key) !== null));

const proButtonsOn = (preset) => {
  const values = proButtonValues(preset);
  const keys = Object.keys(values);
  return keys.length > 0 && keys.every((key) => current(key) === values[key]);
};
const proButtonsPending = (preset) => Object.keys(proButtonValues(preset)).some((key) => key in changes());

// Known rows first; options not checked in game yet fold into one line so the card stays readable.
function renderProButtons(preset) {
  const values = proButtonValues(preset);
  const keys = Object.keys(values);
  const on = proButtonsOn(preset);
  const toggle = (checked) => {
    setMany(checked ? values : Object.fromEntries(keys.map((key) => [key, original(key)])));
    toast(checked ? `${preset.name}’s button layout added to pending changes. Press Save… to apply.` : 'Your own button layout is back in pending changes.');
  };
  const { options, source } = preset.buttons;
  const known = options.filter((o) => o.layout || o.verified);
  const unchecked = options.filter((o) => !o.layout && !o.verified);
  const row = (o, mark) => el('div', { class: 'wiz-diff-row' },
    el('span', {}, o.label), el('span', { class: 'new' }, o.value), el('span', {}, ''), mark);
  return el('div', {},
    el('label', { class: 'pro-switch-row' },
      el('div', {},
        el('div', { class: 'adv-title' }, 'Use their button layout'),
        el('code', { class: 'tile-cvar' }, keys.length ? (on ? 'On' : 'Off') : 'Coming soon · needs an in-game check')),
      el('input', { type: 'checkbox', class: 'switch', checked: on, disabled: !keys.length, onchange: (e) => toggle(e.target.checked) })),
    known.length ? el('div', { class: 'wiz-diff' }, known.map((o) => row(o, el('span', { class: 'ok-text' }, '✓')))) : null,
    !options.length ? el('p', { class: 'tile-help dim' }, 'Not published yet.') : null,
    unchecked.length ? el('details', { class: 'pro-unchecked' },
      el('summary', {}, `${unchecked.length} more option${unchecked.length > 1 ? 's' : ''} not checked in game yet`),
      el('div', { class: 'wiz-diff' }, unchecked.map((o) => row(o, el('span', { class: 'dim' }, 'not checked'))))) : null,
    source ? el('p', { class: 'tile-help dim' }, `Source: ${source}.`) : null,
  );
}

const noControllerSettings = () => el('div', { class: 'banner warn' }, 'Your controller settings weren’t found in profile.cfg. Launch Apex once with a controller connected so the game writes them, then come back.');
const hasControllerSettings = () => state.profile && state.profile.exists && original(ALC_KEY) !== null;

function renderControllerPresets() {
  if (!hasControllerSettings()) return noControllerSettings();
  return el('div', {},
    el('h3', { class: 'section-h' }, 'Pro settings'),
    el('div', { class: 'grid stacked' }, PRO_PRESETS.map(renderProPreset)),
    el('p', { class: 'note spaced' }, 'Every value here can also be changed one by one in Controller, under Game settings.'),
  );
}

function renderController() {
  if (!hasControllerSettings()) return noControllerSettings();
  const alcItem = state.info.catalog.find((c) => c.name === ALC_KEY);
  const group = (id) => state.info.catalog.filter((c) => c.section === 'controller' && c.group === id && c.name !== DEADZONE_KEY && c.name !== ALC_KEY && matches(c.label, c.name, c.help));
  const block = (title, items) => (items.length ? [el('h3', { class: 'section-h' }, title), el('div', { class: 'grid' }, items.map(renderControl))] : []);
  const alcOff = current(ALC_KEY) !== '1';
  const deadzoneItem = state.info.catalog.find((c) => c.name === DEADZONE_KEY);
  return el('div', {},
    el('p', { class: 'note' }, 'One-click pro setups are in ', el('a', { href: '#', onclick: (e) => { e.preventDefault(); go('pros'); } }, 'Controller presets'), '.'),
    el('h3', { class: 'section-h' }, 'Deadzone'),
    el('div', { class: 'grid two' },
      renderControl(deadzoneItem),
      el('div', { class: 'banner warn drift' },
        el('div', {}, el('b', {}, 'Stick drift'),
          el('p', {}, 'With 0% the smallest touch moves your aim, but a worn stick can move your crosshair on its own. If it creeps in the Firing Range, raise the deadzone 1% at a time until it stops.')))),
    alcOff ? el('div', { class: 'adv-note spaced' }, el('b', {}, 'Heads up: '), 'Apex only uses this deadzone while Advanced Look Controls are on. ',
      el('button', { class: 'btn tiny', onclick: () => setChange(ALC_KEY, '1') }, 'Turn them on')) : null,
    el('h3', { class: 'section-h' }, 'Controller binds'),
    fadeBox('controller-binds', renderBinds('controller')),
    el('h3', { class: 'section-h' }, 'Advanced Look Controls'),
    el('div', { class: 'grid stacked' }, renderControl(alcItem)),
    alcOff
      ? el('p', { class: 'note spaced' }, 'Turn this on to see the turn speeds, curve and the rest.')
      : el('div', {},
        el('div', { class: 'grid spaced' }, group('alc').map(renderControl)),
        block('Hipfire (not aiming)', group('hip')),
        block('Aiming down sights', group('ads'))),
  );
}

// ---- views: settings sections / binds / all ---------------------------------------------

function renderSection(section) {
  const items = state.info.catalog.filter((c) => c.section === section && matches(c.label, c.name, c.help));
  if (!items.length) return el('p', { class: 'empty' }, 'No settings match your search.');
  // Some cards go first, full width; the rest follow in a grid
  // (Audio: two per row, so the volume sliders line up).
  const wideNames = SECTION_WIDE[section] || [];
  const wide = wideNames.map((name) => items.find((c) => c.name === name)).filter(Boolean);
  const rest = items.filter((c) => !wideNames.includes(c.name));
  return el('div', {},
    wide.length ? el('div', { class: 'grid stacked' }, wide.map(renderControl)) : null,
    rest.length ? el('div', { class: `grid${section === 'audio' ? ' two' : section === 'mouse' ? ' mouse-row' : ''}${wide.length ? ' spaced' : ''}` }, rest.map(renderControl)) : null,
  );
}

// Full-width cards at the top of a tab, in this order.
const SECTION_WIDE = {
  audio: ['video:setting.sound_volume', 'profile:miles_mix'],
  mouse: ['mouse_sensitivity'],
};

// Volumes: the file stores 0–1 ("0.246429"), the app shows whole percents (25%).
const toPercent = (value) => Math.round(Number(value) * 100);
// Field of view: the file stores FOV / 70 ("1.55" = 108.5, shown rounded).
const FOV_BASE = 70;
const toFov = (value) => Math.round(Number(value) * FOV_BASE);
const fromFov = (deg) => String(Number((deg / FOV_BASE).toFixed(6)));
const MAX_FOV_SCALE = fromFov(110);
const fromPercent = (pct) => String(Number((pct / 100).toFixed(2)));

// FOV slider in degrees (70–110); stores FOV / 70. Back on the saved degree = the exact saved value.
function renderFovControl(item, cls, header) {
  const deg = toFov(current(item.name));
  const valueFor = (n) => (n === toFov(original(item.name)) ? original(item.name) : fromFov(n));
  const num = el('input', { type: 'number', class: 'num pct-input', min: '70', max: '110', step: '1', value: String(deg) });
  const range = el('input', { type: 'range', min: '70', max: '110', step: '1', value: String(deg) });
  range.addEventListener('input', () => {
    num.value = range.value;
    setChange(item.name, valueFor(Number(range.value)));
  });
  num.addEventListener('change', () => {
    const n = Number(num.value);
    if (num.value === '' || !Number.isInteger(n) || n < 70 || n > 110) {
      num.value = String(toFov(current(item.name)));
      return toast('Field of view must be a whole number from 70 to 110', true);
    }
    range.value = num.value;
    setChange(item.name, valueFor(n));
  });
  return el('div', { class: `${cls} number`, dataset: { name: item.name } }, header,
    el('div', { class: 'slider-row' }, range, el('span', { class: 'pct-box' }, num, el('span', { class: 'dim' }, '°'))));
}

// ADS multiplier: the slider's middle is "Same" (1.0); left = slower, right = faster. The slider is
// logarithmic so 0.5× and 2× sit equally far from the middle; the box shows the exact number.
const ADS_MIN = 0.2;
const ADS_MAX = 5; // ADS_MIN × ADS_MAX = 1, so 1.0 lands in the middle
const adsToPos = (v) => Math.round((Math.log(Number(v)) / Math.log(ADS_MAX)) * 100);
const posToAds = (pos) => Number(Math.exp((pos / 100) * Math.log(ADS_MAX)).toFixed(2));

function renderAdsControl(item, cls, header) {
  const valueFor = (n) => (Number(original(item.name)) === n ? original(item.name) : String(n));
  const now = Number(current(item.name));
  const num = el('input', { type: 'number', class: 'num', min: String(ADS_MIN), max: String(ADS_MAX), step: '0.05', value: now.toFixed(2) });
  const range = el('input', { type: 'range', min: '-100', max: '100', step: '1', value: String(adsToPos(now)) });
  range.addEventListener('input', () => {
    // Snap to exactly 1.0 near the middle, so "Same" is easy to hit.
    const v = Math.abs(Number(range.value)) <= 3 ? 1 : posToAds(Number(range.value));
    num.value = v.toFixed(2);
    setChange(item.name, valueFor(v));
  });
  num.addEventListener('change', () => {
    const n = Number(num.value);
    if (num.value === '' || Number.isNaN(n) || n < ADS_MIN || n > ADS_MAX) {
      num.value = Number(current(item.name)).toFixed(2);
      return toast(`${item.label} must be between ${ADS_MIN} and ${ADS_MAX}`, true);
    }
    range.value = String(adsToPos(n));
    setChange(item.name, valueFor(Number(n.toFixed(2))));
  });
  return el('div', { class: `${cls} number`, dataset: { name: item.name } }, header,
    el('div', { class: 'slider-row' }, range, num),
    el('div', { class: 'ads-scale' }, el('span', {}, 'Slower'), el('span', {}, 'Same'), el('span', {}, 'Faster'), el('span', {})));
}

function renderPercentControl(item, cls, header) {
  const pct = toPercent(current(item.name));
  const lo = toPercent(item.min);
  const hi = toPercent(item.max);
  // Back on the saved percent = the exact saved value (0.246429), so it doesn't count as a change.
  const valueFor = (n) => (n === toPercent(original(item.name)) ? original(item.name) : fromPercent(n));
  const num = el('input', { type: 'number', class: 'num pct-input', min: String(lo), max: String(hi), step: '1', value: String(pct) });
  const range = el('input', { type: 'range', min: String(lo), max: String(hi), step: '1', value: String(pct) });
  range.addEventListener('input', () => {
    num.value = range.value;
    setChange(item.name, valueFor(Number(range.value)));
  });
  num.addEventListener('change', () => {
    const n = Number(num.value);
    if (num.value === '' || !Number.isInteger(n) || n < lo || n > hi) {
      num.value = String(toPercent(current(item.name)));
      return toast(`${item.label} must be a whole number from ${lo} to ${hi}`, true);
    }
    range.value = num.value;
    setChange(item.name, valueFor(n));
  });
  return el('div', { class: `${cls} number`, dataset: { name: item.name } }, header,
    el('div', { class: 'slider-row' }, range, el('span', { class: 'pct-box' }, num, el('span', { class: 'dim' }, '%'))));
}

function renderControl(item) {
  const orig = original(item.name);
  const cls = `tile${item.name in changes() && !quietKeys().has(item.name) ? ' changed' : ''}`;
  if (orig === null) {
    return el('div', { class: `${cls} missing` }, el('div', { class: 'tile-label' }, item.label), el('div', { class: 'tile-help' }, 'Not present in this file'));
  }
  const header = [
    el('div', { class: 'tile-label' }, item.label, item.verified ? null : el('span', { class: 'unverified', title: 'Exact in-game effect not verified' }, '?')),
    el('div', { class: 'tile-help' }, item.help),
    item.warn ? el('div', { class: 'tile-warn' }, `⚠ ${item.warn}`) : null,
    el('code', { class: 'tile-cvar' }, `${item.name}  ·  saved: ${item.percent ? `${toPercent(orig)}%` : `"${orig}"`}`),
  ];
  if (item.percent) return renderPercentControl(item, cls, header);
  if (item.fov) return renderFovControl(item, cls, header);
  if (item.ads) return renderAdsControl(item, cls, header);

  if (item.type === 'toggle') {
    return el('label', { class: `${cls} toggle`, dataset: { name: item.name } },
      el('div', {}, header),
      el('input', { type: 'checkbox', class: 'switch', checked: current(item.name) === '1', onchange: (e) => setChange(item.name, e.target.checked ? '1' : '0') }),
    );
  }

  const decimals = (String(item.step).split('.')[1] || '').length;
  const num = el('input', { type: 'number', class: 'num', min: String(item.min), max: String(item.max), step: String(item.step), value: current(item.name) });
  const range = el('input', { type: 'range', min: String(item.min), max: String(item.max), step: String(item.step), value: current(item.name) });
  range.addEventListener('input', () => {
    num.value = Number(range.value).toFixed(decimals);
    setChange(item.name, num.value);
  });
  num.addEventListener('change', () => {
    const n = Number(num.value);
    if (num.value === '' || Number.isNaN(n) || n < item.min || n > item.max) {
      num.value = current(item.name);
      return toast(`${item.label} must be between ${item.min} and ${item.max}`, true);
    }
    range.value = num.value;
    setChange(item.name, num.value);
  });
  return el('div', { class: `${cls} number`, dataset: { name: item.name } }, header, el('div', { class: 'slider-row' }, range, num));
}

function chainView(command) {
  const parts = command.split(';').map((c) => c.trim()).filter(Boolean).map((c) => el('span', { class: 'chip' }, c));
  return el('span', { class: 'chips' }, parts.flatMap((p, i) => (i ? [el('span', { class: 'arrow' }, '+'), p] : [p])));
}

// ★ badge on jump keys in Mouse & keyboard when "Jump and dash abilities on SPACE" is on; hover explains, click opens the tab.
function jumpStar(bind) {
  if (bind.held || !jumpIsOn()) return null;
  const plan = jumpPlan();
  let tip;
  if (bind.key === plan.ability.key) {
    tip = `Wall bounce & bunny hop fix: ON. ${keyName(bind.key)} jumps and activates jetpack, double jumps, dashes and mantle boost.`;
  } else if (plan.jumpOnly.some((r) => r.key === bind.key)) {
    tip = `Wall bounce & bunny hop fix: ON. ${keyName(bind.key)} only jumps, so it won\u2019t activate jetpack, double jumps, dashes or mantle boost.`;
  } else return null;
  return el('button', { class: 'jump-star', 'data-tip': tip, 'aria-label': tip, onclick: () => go('jump') }, '★');
}

// ---- bind editing: press a key to rebind --------------------------------------------------
// Apex key names as they appear in settings.cfg, from KeyboardEvent.code. Letters are lowercase
// in the file ("a"), most other keys are UPPERCASE names ("SPACE", "LSHIFT").
const CODE_TO_KEY = {
  Space: 'SPACE', Tab: 'TAB', CapsLock: 'CAPSLOCK', Enter: 'ENTER', Backspace: 'BACKSPACE',
  ShiftLeft: 'LSHIFT', ShiftRight: 'RSHIFT', ControlLeft: 'LCTRL', ControlRight: 'RCTRL', AltLeft: 'LALT', AltRight: 'RALT',
  ArrowUp: 'UPARROW', ArrowDown: 'DOWNARROW', ArrowLeft: 'LEFTARROW', ArrowRight: 'RIGHTARROW',
  Insert: 'INS', Delete: 'DEL', Home: 'HOME', End: 'END', PageUp: 'PGUP', PageDown: 'PGDN',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: 'SEMICOLON', Comma: ',', Period: '.', Slash: '/',
  Numpad0: 'KP_INS', Numpad1: 'KP_END', Numpad2: 'KP_DOWNARROW', Numpad3: 'KP_PGDN', Numpad4: 'KP_LEFTARROW',
  Numpad5: 'KP_5', Numpad6: 'KP_RIGHTARROW', Numpad7: 'KP_HOME', Numpad8: 'KP_UPARROW', Numpad9: 'KP_PGUP',
  NumpadDivide: 'KP_SLASH', NumpadMultiply: 'KP_MULTIPLY', NumpadSubtract: 'KP_MINUS', NumpadAdd: 'KP_PLUS',
  NumpadDecimal: 'KP_DEL', NumpadEnter: 'KP_ENTER',
};
const MOUSE_KEYS = ['MOUSE1', 'MOUSE3', 'MOUSE2', 'MOUSE4', 'MOUSE5']; // index = MouseEvent.button

function keyFromEvent(e) {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  if (/^F\d{1,2}$/.test(e.code)) return e.code;
  return CODE_TO_KEY[e.code] || null;
}

// Waits for ONE key, mouse button or wheel turn anywhere, then calls done(keyName).
// Esc cancels. Listens in the capture phase so nothing else (Ctrl+Z, buttons) reacts meanwhile.
function captureKey(what, done) {
  const overlay = el('div', { class: 'capture-overlay' },
    el('div', { class: 'capture-box' },
      el('div', { class: 'capture-title' }, 'Press a key or mouse button'),
      el('div', { class: 'tile-help' }, `for ${what}. Scroll the wheel for the wheel. Esc cancels.`)));
  const finish = (key) => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('mousedown', onMouse, true);
    window.removeEventListener('wheel', onWheel, true);
    window.removeEventListener('contextmenu', block, true);
    overlay.remove();
    if (key) done(key);
  };
  const block = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
  const onKey = (e) => {
    block(e);
    if (e.code === 'Escape') return finish(null);
    const key = keyFromEvent(e);
    if (key) finish(key);
    else toast('That key can’t be bound here. Try another one.', true);
  };
  const onMouse = (e) => { block(e); if (MOUSE_KEYS[e.button]) finish(MOUSE_KEYS[e.button]); };
  const onWheel = (e) => { block(e); finish(e.deltaY < 0 ? 'MWHEELUP' : 'MWHEELDOWN'); };
  document.body.append(overlay);
  // Start listening after the click that opened this, so that click isn't taken as MOUSE1.
  setTimeout(() => {
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('contextmenu', block, true);
  }, 0);
}

// The line a key would use for a tap/hold bind: the existing one (same slot if possible), else a new id.
function targetBindId(key, held, flag) {
  const same = state.file.lines.filter((l) => l.type === 'bind' && l.key === key && l.held === held);
  const exact = same.find((l) => (l.flag ?? '') === (flag ?? ''));
  return (exact || same[0] || { id: `bind:${held ? 'hold' : 'tap'}:${key}:${flag ?? '0'}` }).id;
}

const setBinds = (values) => setMany(values);

// Move `command` from bind `fromId` (null when adding) to key `key`. Asks first if the key is taken.
function placeBind(fromId, command, key, held, flag) {
  const toId = targetBindId(key, held, flag);
  if (toId === fromId) return;
  const taken = current(toId);
  if (taken && taken !== command) {
    state.bindConflict = { fromId, toId, key, command, taken };
    return renderView();
  }
  setBinds({ ...(fromId ? { [fromId]: '' } : {}), [toId]: command });
  toast(`${keyName(key)} now does: ${describeCommand(command)}. Press Save… to apply.`);
}

function resolveConflict(mode) {
  const c = state.bindConflict;
  state.bindConflict = null;
  if (mode === 'cancel') return renderView();
  const values = { [c.toId]: c.command };
  if (c.fromId) values[c.fromId] = mode === 'swap' ? c.taken : '';
  setBinds(values);
}

function renderBindConflict() {
  const c = state.bindConflict;
  if (!c) return null;
  return el('div', { class: 'banner warn bind-conflict' },
    el('div', {}, keyCap(c.key), ` is already ${describeCommand(c.taken)}. What should happen to it?`),
    el('div', { class: 'conflict-actions' },
      c.fromId ? el('button', { class: 'btn small', onclick: () => resolveConflict('swap') }, 'Swap the two keys') : null,
      el('button', { class: 'btn small primary', onclick: () => resolveConflict('replace') }, `Replace (${describeCommand(c.taken)} gets unbound)`),
      el('button', { class: 'btn small', onclick: () => resolveConflict('cancel') }, 'Cancel')));
}

function renderAddBind() {
  const actions = Object.entries(BIND_ACTIONS);
  const select = el('select', { class: 'raw add-bind-select' },
    el('option', { value: '' }, 'Choose an action…'),
    CORE_ORDER.map((cat) => {
      const opts = actions.filter(([, [, c]]) => c === cat);
      return opts.length ? el('optgroup', { label: cat }, opts.map(([cmd, [label]]) => el('option', { value: cmd }, label))) : null;
    }));
  return el('div', { class: 'add-bind' },
    el('span', { class: 'tile-label' }, 'Add a bind'),
    select,
    el('button', {
      class: 'btn small primary',
      onclick: () => {
        if (!select.value) return toast('Choose an action first', true);
        const label = BIND_ACTIONS[select.value][0];
        captureKey(label, (key) => placeBind(null, select.value, key, false, '0'));
      },
    }, 'Press a key…'));
}

// ---- bind glossary --------------------------------------------------------------------------

function renderBindGlossary() {
  const actions = Object.entries(BIND_ACTIONS);
  return el('div', { class: 'bind-glossary' },
    el('h3', { class: 'section-h' }, 'What every bind means'),
    el('div', { class: 'grid' },
      BIND_BASICS.map(([title, text]) => el('div', { class: 'tile' }, el('div', { class: 'tile-label' }, title), el('div', { class: 'tile-help' }, text)))),
    CORE_ORDER.filter((cat) => actions.some(([, [, c]]) => c === cat)).map((cat) =>
      el('div', { class: 'bind-group' },
        el('h3', {}, cat),
        el('table', { class: 'table glossary' }, el('tbody', {}, actions.filter(([, [, c]]) => c === cat).map(([cmd, [label]]) =>
          el('tr', {},
            el('td', { class: 'g-name' }, el('b', {}, label), el('code', { class: 'bind-raw' }, cmd)),
            el('td', { class: 'g-text' }, BIND_HELP[cmd] || '')))))),
    ),
  );
}

// mode 'keyboard' = Core / Misc with editing (Mouse & keyboard tab); 'controller' = gamepad
// buttons, view only (Controller tab).
function renderBinds(mode = 'keyboard') {
  if (mode === 'keyboard' && state.bindTab === 'controller') state.bindTab = 'core';
  const tab = mode === 'controller' ? 'controller' : state.bindTab;
  // Binds in the file plus new ones waiting to be saved (added by rebinding to a free key).
  const fileBinds = state.file.lines.filter((l) => l.type === 'bind');
  const newBinds = Object.keys(changes()).filter((id) => isBindKey(id) && !fileBinds.some((l) => l.id === id)).map((id) => {
    const [, kind, key, flag] = id.match(/^bind:(tap|hold):(.*):([^:]*)$/);
    return { id, key, held: kind === 'hold', flag: flag || null, command: null };
  });
  const binds = [...fileBinds, ...newBinds].map((b) => {
    const command = current(b.id) || '';
    const shown = { ...b, command, chain: chainOf(command) };
    // An unbound key stays in the group of what it used to do.
    const was = b.command ? { ...b, chain: chainOf(b.command) } : shown;
    return { bind: shown, info: classifyBind(command ? shown : was), changed: b.id in changes(), was: b.command };
  }).filter((b) => b.bind.command || b.changed);
  const counts = { core: 0, controller: 0, misc: 0 };
  binds.forEach((b) => counts[b.info.group]++);

  const tabs = [
    ['core', 'Core', 'Keyboard & mouse actions you use in a match'],
    ['misc', 'Misc', 'Spectator, observer, console and developer binds. Most players never need these.'],
  ];
  const seg = el('div', { class: 'segmented' }, tabs.map(([id, label]) =>
    el('button', { class: state.bindTab === id ? 'active' : '', onclick: () => { state.bindTab = id; renderView(); } }, `${label} `, el('span', { class: 'dim' }, counts[id]))));
  const caption = (tabs.find((t) => t[0] === tab) || [])[2];

  const visible = binds.filter((b) => b.info.group === tab
    && matches(b.bind.key, b.bind.command, b.info.label, b.info.category));

  const groups = new Map();
  const order = tab === 'core' ? CORE_ORDER : [...new Set(visible.map((b) => b.info.category))];
  order.forEach((c) => groups.set(c, []));
  visible.forEach((b) => {
    if (!groups.has(b.info.category)) groups.set(b.info.category, []);
    groups.get(b.info.category).push(b);
  });

  const sections = [...groups.entries()].filter(([, rows]) => rows.length).map(([cat, rows]) =>
    el('div', { class: 'bind-group' },
      el('h3', {}, cat),
      el('table', { class: 'table' },
        el('tbody', {}, rows.map(({ bind, info, changed, was }) =>
          el('tr', { class: changed ? 'changed' : null },
            el('td', { class: 'bind-key' }, keyCap(bind.key)),
            el('td', { class: 'bind-kind' }, bind.held ? el('span', { class: 'tag' }, 'hold') : el('span', { class: 'tag dim' }, 'tap')),
            bind.command
              ? el('td', {}, el('div', { class: 'bind-action' }, info.label || chainView(bind.command), bind.chain.length > 1 ? el('span', { class: 'tag chain' }, 'chain') : null, jumpStar(bind)),
                info.label ? el('code', { class: 'bind-raw' }, bind.command) : null)
              : el('td', { class: 'dim' }, `Unbound (was ${describeCommand(was)})`),
            info.group === 'controller' || !bind.command ? el('td', {}) : el('td', { class: 'bind-edit' },
              el('button', { class: 'btn tiny', onclick: () => captureKey(info.label || bind.command, (key) => placeBind(bind.id, bind.command, key, bind.held, bind.flag)) }, 'Change'),
              el('button', { class: 'btn tiny', title: 'Unbind this key', onclick: () => setBinds({ [bind.id]: '' }) }, '✕')),
          ),
        )),
      ),
    ));

  if (mode === 'controller') {
    return el('div', {},
      el('p', { class: 'note' }, 'Controller buttons can’t be pressed in here, so these are view only. Change them in Apex’s own Controls menu.'),
      sections.length ? sections : el('p', { class: 'empty' }, 'No controller binds match.'));
  }
  return el('div', {},
    el('p', { class: 'note' }, 'Click Change, then press the new key or mouse button. For jump keys, ', el('a', { href: '#', onclick: (e) => { e.preventDefault(); go('jump'); } }, '★ Dash, jetpack and double jump fix'), ' is easier.'),
    renderBindConflict(),
    seg,
    el('p', { class: 'note' }, caption),
    renderAddBind(),
    sections.length ? sections : el('p', { class: 'empty' }, 'No binds match.'),
    renderBindGlossary(),
  );
}

// Plain-language notes for the All settings table. Settings that have their own card use
// that card's text instead (catalog). "Unclear" ones say so rather than guess.
const SETTING_HELP = {
  cc_linger_time: 'How long subtitles stay on screen after a line ends, in seconds.',
  cc_predisplay_time: 'How early subtitles appear before a line is spoken, in seconds.',
  func_break_max_pieces: 'How many pieces breakable objects shatter into. Lower is a tiny bit lighter on the PC.',
  hdr_screenshot_directory: 'Folder for HDR screenshots. Empty = the game’s default folder.',
  mouse_use_per_scope_sensitivity_scalars: 'Separate ADS sensitivity per scope (uses the optic slots below). Off = one ADS multiplier for every scope.',
  lookspring: 'Old Source-engine setting (re-centers the view when moving). No known effect in Apex.',
  lookstrafe: 'Old Source-engine mouse setting (mouse moves you sideways). No known effect in Apex.',
  m_clamp_to_window: 'Keeps the mouse cursor inside the game window, useful in windowed mode with two monitors.',
  miles_channels: 'Speaker channel setup for the game’s audio engine (Miles). 0 = automatic.',
  miles_dumpuploadtime: 'Audio-engine debug option for developers. Leave it as is.',
  miles_output_device: 'Which audio device the game plays through. Empty = the Windows default.',
  name: 'A local copy of your player name. Your real name comes from your EA account; changing this does nothing useful.',
  sound_num_speakers: 'Speaker setup: 2 = stereo or headphones.',
  sv_specaccelerate: 'Spectator camera acceleration. Only used when free-flying as a spectator.',
  sv_specnoclip: 'Lets the spectator camera fly through walls. Only used when spectating.',
  sv_specspeed: 'Spectator camera speed. Only used when spectating.',
  ui_layout_mode: 'Interface layout option set by the game. Exact effect unclear; leave it as is.',
  voice_forcemicrecord: 'Keeps the microphone open for recording, so open mic can detect your voice.',
  voice_input_device: 'Which microphone the game uses. Empty = the Windows default.',
  voice_mixer_boost: 'Microphone boost. 1 = louder mic (and more background noise).',
  voice_modenable: 'Turns the voice system on. Leave it on.',
  voice_scale: 'Overall scale for incoming voice chat volume.',
  VoiceChatMode: 'Voice chat mode the game picked from its Audio menu. Exact values unclear; change it in Apex instead.',
};

// On/off settings in All settings: shown as a switch (only while the value really is 0 or 1).
const ON_OFF = new Set(['lookstrafe', 'm_clamp_to_window', 'sv_specnoclip', 'voice_forcemicrecord', 'voice_mixer_boost', 'voice_modenable']);
function isOnOff(name) {
  const v = current(name);
  if (v !== '0' && v !== '1') return false;
  return ON_OFF.has(name) || state.info.catalog.some((c) => c.name === name && c.type === 'toggle');
}

function settingHelp(name) {
  const listed = state.info.catalog.find((c) => c.name === name);
  if (listed) return { label: listed.label, help: listed.help };
  const scope = name.match(/^mouse_zoomed_sensitivity_scalar_(\d)$/);
  if (scope) return { label: `ADS multiplier, optic slot ${scope[1]}`, help: 'Sensitivity multiplier for one optic, used only when Per-optic ADS sensitivity is on. Slots go from the lowest zoom up. 1.0 = no change.' };
  return { label: null, help: SETTING_HELP[name] || null };
}

function renderAllSettings() {
  const cvars = state.file.lines.filter((l) => l.type === 'cvar' && matches(l.name, l.value, settingHelp(l.name).label, settingHelp(l.name).help));
  return el('div', {},
    el('p', { class: 'note' }, 'Advanced: every plain setting in the file. Only change what you understand. Every change can be undone.'),
    el('table', { class: 'table' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Line'), el('th', {}, 'Setting'), el('th', {}, 'Value'))),
      el('tbody', {}, cvars.map((l) =>
        el('tr', { dataset: { name: l.name }, class: l.name in changes() ? 'changed' : null },
          el('td', { class: 'dim' }, l.lineNumber),
          el('td', { class: 'all-name' }, ...(() => {
            const h = settingHelp(l.name);
            return [
              h.label ? el('div', { class: 'all-label' }, h.label) : null,
              el('code', {}, l.name),
              el('div', { class: 'all-help' }, h.help || 'No description yet.'),
            ];
          })()),
          el('td', {}, isOnOff(l.name)
            ? el('label', { class: 'onoff' },
              el('input', { type: 'checkbox', class: 'switch', checked: current(l.name) === '1', onchange: (e) => setChange(l.name, e.target.checked ? '1' : '0') }),
              el('span', {}, current(l.name) === '1' ? 'On' : 'Off'))
            : el('input', {
              class: 'raw',
              value: current(l.name),
              onchange: (e) => {
                if (e.target.value.includes('"')) { e.target.value = current(l.name); return toast('Quotes are not allowed in values', true); }
                setChange(l.name, e.target.value);
              },
            })),
        ),
      )),
    ),
  );
}

// ---- view: backups & restore ------------------------------------------------------------

function confirmButton(id, label, confirmLabel, action, { primary = false, disabled = false } = {}) {
  if (state.confirm === id) {
    return el('span', { class: 'confirm' },
      el('button', { class: 'btn small', onclick: () => { state.confirm = null; renderView(); } }, 'Cancel'),
      el('button', { class: 'btn small primary', disabled, onclick: action }, confirmLabel));
  }
  return el('button', { class: `btn small${primary ? ' primary' : ''}`, disabled, onclick: () => { state.confirm = id; renderView(); } }, label);
}

// The files the app manages, each with its own backups.
function backupTargets() {
  const targets = [{ id: 'cfg', title: 'Settings & binds', fileName: 'settings.cfg', filePath: state.file.filePath, backups: state.backups }];
  if (state.video && state.video.exists) {
    targets.push({ id: 'video', title: 'Graphics & video', fileName: 'videoconfig.txt', filePath: state.video.filePath, backups: state.videoBackups });
  }
  if (state.profile && state.profile.exists) {
    targets.push({ id: 'profile', title: 'Audio mix & profile', fileName: 'profile.cfg', filePath: state.profile.filePath, backups: state.profileBackups });
  }
  return targets;
}

function originalBackups() {
  return backupTargets()
    .map((t) => ({ filePath: t.filePath, backup: t.backups.find((b) => b.isOriginal) }))
    .filter((o) => o.backup);
}

// Every save backs up each file it touches a moment apart, so backups made within a minute of
// each other are ONE version. Newest first; the untouched originals are the last entry.
function backupVersions() {
  const all = backupTargets()
    .flatMap((t) => t.backups.filter((b) => !b.isOriginal).map((b) => ({ target: t, backup: b })))
    .sort((x, y) => y.backup.mtimeMs - x.backup.mtimeMs);
  const versions = [];
  for (const item of all) {
    const v = versions[versions.length - 1];
    const sameSave = v && v.time - item.backup.mtimeMs < 60000 && !v.items.some((i) => i.target.id === item.target.id);
    if (sameSave) v.items.push(item);
    else versions.push({ time: item.backup.mtimeMs, items: [item] });
  }
  const originals = backupTargets().filter((t) => t.backups.some((b) => b.isOriginal))
    .map((t) => ({ target: t, backup: t.backups.find((b) => b.isOriginal) }));
  if (originals.length) versions.push({ time: Math.min(...originals.map((o) => o.backup.mtimeMs)), items: originals, original: true });
  return versions;
}

// One row per difference across all files of a version: what you have now → what a restore brings back.
function diffRows(item) {
  const cmp = state.compare[item.backup.path];
  if (!cmp) return [];
  return cmp.diffs.map((d) => {
    const key = d.type === 'bind' ? 'bind:' : item.target.id === 'profile' ? `profile:${d.name}` : d.name;
    const label = d.type === 'bind' ? `${d.bindKey} key${d.held ? ' (hold)' : ''}` : labelFor(key);
    const fmt = (v) => (v == null ? '(not in file)' : formatValue(key, v));
    return el('tr', {},
      el('td', {}, label, el('span', { class: 'file-tag' }, item.target.fileName)),
      el('td', { class: 'now' }, fmt(d.current)),
      el('td', { class: 'after' }, fmt(d.backup)));
  });
}

function renderVersion(v) {
  for (const i of v.items) if (!(i.backup.path in state.compare)) loadCompare(i.target.filePath, i.backup.path);
  const loading = v.items.some((i) => !state.compare[i.backup.path]);
  const rows = v.items.flatMap(diffRows);
  const same = !loading && rows.length === 0;
  const id = v.items[0].backup.path;
  const restoreItems = v.items.map((i) => ({ filePath: i.target.filePath, backupPath: i.backup.path }));
  const summary = loading ? '…' : same ? 'Same as your files now' : `${rows.length} difference${rows.length === 1 ? '' : 's'} from your files now`;
  return el('div', { class: `backup${v.original ? ' original' : ''}` },
    el('div', { class: 'backup-main' },
      el('div', {},
        el('div', { class: 'backup-name' }, v.original ? 'Original files (before this app changed anything)' : `Version from ${fmtTime(v.time)}`),
        el('div', { class: 'dim' }, v.items.map((i) => i.target.fileName).join(' · '), ' — ', summary),
      ),
      el('div', { class: 'backup-actions' },
        confirmButton(`restore:${id}`, 'Restore', 'Yes, restore (your current files are saved first)', () => restoreMany(restoreItems), { disabled: state.apexRunning || same }),
        v.original ? null : confirmButton(`delete:${id}`, 'Delete', 'Yes, delete it', () => deleteMany(v.items)),
      ),
    ),
    rows.length ? fadeBox(`bk:${id}`,
      el('table', { class: 'table compact' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Setting'), el('th', {}, 'Now'), el('th', {}, 'After restore'))),
        el('tbody', {}, rows))) : null,
  );
}

function renderBackups() {
  const originals = originalBackups();

  const safety = el('div', { class: 'safe-hero' },
    el('div', { class: 'safe-icon' }, '🛡'),
    el('div', {},
      el('h2', {}, 'Your original files are safe'),
      el('p', {}, `When you first opened them, the app saved untouched copies on your Desktop, in "Apex Config Editor backups"${originals.length ? ` (${fmtTime(originals[0].backup.mtimeMs)})` : ''}. They are never overwritten, so you can always go back to exactly how things were.`),
      el('div', { class: 'safe-actions' },
        confirmButton('revert-all', '⟲ Revert everything to original', 'Yes, revert (your current files are saved first)',
          () => restoreMany(originals.map((o) => ({ filePath: o.filePath, backupPath: o.backup.path })), 'Everything is back to your original files.'),
          { primary: true, disabled: state.apexRunning || !originals.length }),
        el('button', { class: 'btn small', onclick: () => window.api.openBackupFolder(state.file.filePath) }, '📂 Open backups folder'),
      ),
      state.apexRunning ? el('p', { class: 'warn-text' }, 'Close Apex before restoring.') : null,
    ));

  const versions = backupVersions();
  return el('div', { class: 'backups' }, safety,
    el('h3', { class: 'section-h' }, 'Versions'),
    el('p', { class: 'note' }, 'Newest first. Before every save or restore, your current files are copied here first, so nothing is ever lost and every restore can be undone.'),
    el('div', { class: 'backup-list' }, versions.map(renderVersion)));
}

// Deletes every file of one version, then reloads the list once.
async function deleteMany(items) {
  state.confirm = null;
  try {
    for (const i of items) {
      await window.api.deleteBackup(i.target.filePath, i.backup.path);
      delete state.compare[i.backup.path];
    }
    await loadFile(state.file.filePath, { keepHistory: true });
    toast('Version deleted');
  } catch (err) {
    toast(`Couldn’t delete it: ${errorText(err)}`, true);
  }
}

async function loadCompare(filePath, path) {
  state.compare[path] = null; // mark as loading so we don't fire twice
  try {
    state.compare[path] = await window.api.compareBackup(filePath, path);
  } catch {
    delete state.compare[path];
    return;
  }
  if (state.view === 'backups') renderView();
}

// ---- pending changes panel ------------------------------------------------------------

function renderChanges() {
  const names = Object.keys(changes());
  $('#change-count').textContent = names.length;
  $('#change-count').classList.toggle('zero', names.length === 0);
  $('#save-btn').disabled = names.length === 0;
  $('#discard-btn').disabled = names.length === 0;
  $('#undo-btn').disabled = history.index === 0;
  $('#redo-btn').disabled = history.index >= history.stack.length - 1;

  if (!names.length) {
    $('#change-list').replaceChildren(el('p', { class: 'empty' }, 'No changes yet. Flip a toggle, drag a slider, or try ★ Dash, jetpack and double jump fix.'));
  } else {
    $('#change-list').replaceChildren(...names.map((key) => {
      const value = changes()[key];
      const old = original(key);
      const bind = isBindKey(key);
      return el('div', { class: 'change' },
        el('div', { class: 'change-head' },
          el('span', { class: 'change-label' }, labelFor(key)),
          el('button', { class: 'btn tiny', title: 'Undo this change', onclick: () => removeChange(key) }, '↶ Undo'),
        ),
        el('div', { class: 'change-values' },
          el('span', { class: 'old' }, formatValue(key, old)),
          el('span', { class: 'to' }, '→'),
          el('span', { class: 'new' }, formatValue(key, value)),
        ),
        bind && old == null ? el('div', { class: 'dim small' }, 'New line will be added') : null,
      );
    }));
  }
}

// ---- setup: find the settings file -----------------------------------------------------
// Shown on first run (nothing remembered yet) and from "Change file…".

const SETUP_HINT = '%USERPROFILE%\\Saved Games\\Respawn\\Apex\\local';

async function openSetup(required) {
  state.setup = { required, found: null, selected: state.file ? state.file.filePath : null, input: '', message: null };
  renderSetup();
  if (!$('#setup').open) $('#setup').showModal();
  state.setup.found = await window.api.findConfigs();
  if (!state.setup.selected && state.setup.found.length) {
    state.setup.selected = (state.setup.found.find((f) => f.kind === 'game' && f.valid) || state.setup.found[0]).path;
  }
  renderSetup();
}

function addSetupCandidate(res) {
  const s = state.setup;
  if (!res.ok) {
    s.message = { error: true, text: res.message };
  } else {
    s.found = s.found || [];
    if (!s.found.some((f) => f.path.toLowerCase() === res.path.toLowerCase())) s.found.push(res);
    s.selected = res.path;
    s.message = { error: false, text: 'Found it. Press \u201cUse this file\u201d to continue.' };
  }
  renderSetup();
}

async function confirmSetup() {
  const res = await window.api.chooseConfig(state.setup.selected);
  if (!res.ok) return addSetupCandidate(res);
  $('#setup').close();
  await loadFile(res.path);
}

function renderSetup() {
  const s = state.setup;
  const list = s.found === null
    ? el('p', { class: 'dim' }, 'Searching this PC…')
    : s.found.length
      ? el('div', { class: 'setup-list' }, s.found.map((f) =>
        el('label', { class: `setup-option${s.selected === f.path ? ' selected' : ''}` },
          el('input', { type: 'radio', name: 'cfg', checked: s.selected === f.path, onchange: () => { s.selected = f.path; renderSetup(); } }),
          el('div', {},
            el('div', { class: 'setup-title' },
              f.kind === 'game' ? 'Apex settings file' : 'Test copy on Desktop',
              f.kind === 'game' ? el('span', { class: 'tier tier-recommended' }, 'Your real file') : el('span', { class: 'tier tier-myth' }, 'For trying the app safely')),
            el('code', { class: 'setup-path' }, f.path),
            el('div', { class: 'dim' }, `Last changed ${fmtTime(f.mtimeMs)}${f.readOnly ? ' · read-only' : ''}`),
          ))))
      : el('div', { class: 'banner warn' },
        'We couldn\u2019t find it automatically. If you\u2019ve never played Apex on this PC, launch the game once and come back. The game creates this file the first time it runs.');

  setChildren($('#setup'), ...dialogLayout([
    el('h2', {}, 'Find your Apex settings file'),
    el('p', { class: 'dim' }, 'The app edits Apex\u2019s settings.cfg (and videoconfig.txt next to it, for graphics). Pick it once and the app remembers it.'),
    el('div', { class: 'setup-safe' }, '🛡 Before changing anything, the app saves a copy of your original files on your Desktop, in "Apex Config Editor backups". The Restore button brings them back anytime.'),

    el('h3', { class: 'section-h' }, 'Found on this PC'),
    list,

    el('h3', { class: 'section-h' }, 'Not listed? Find the folder'),
    el('div', { class: 'setup-help' },
      'Press ', keyCap('Windows'), ' + ', keyCap('R'), ', paste this and press Enter:',
      el('div', { class: 'line-row' },
        el('code', { class: 'launch-line small' }, SETUP_HINT),
        el('button', { class: 'btn small primary', onclick: () => copyText(SETUP_HINT, 'Folder path copied') }, 'Copy')),
      'A folder opens. Click its address bar, copy the path, and paste it below.'),

    el('h3', { class: 'section-h' }, 'Paste the folder path'),
    el('div', { class: 'line-row' },
      el('input', {
        class: 'raw', placeholder: 'e.g. C:\\Users\\you\\Saved Games\\Respawn\\Apex\\local', value: s.input,
        oninput: (e) => { s.input = e.target.value; },
        onkeydown: async (e) => { if (e.key === 'Enter') addSetupCandidate(await window.api.resolveConfig(s.input)); },
      }),
      el('button', { class: 'btn', onclick: async () => addSetupCandidate(await window.api.resolveConfig(s.input)) }, 'Check'),
      el('button', {
        class: 'btn primary',
        onclick: async () => {
          const picked = await window.api.pickFile();
          if (picked) addSetupCandidate(await window.api.resolveConfig(picked));
        },
      }, 'Browse…'),
    ),
    s.message ? el('p', { class: s.message.error ? 'warn-text' : 'ok-text' }, s.message.text) : null,
  ], [
    s.required ? null : el('button', { class: 'btn', onclick: () => $('#setup').close() }, 'Cancel'),
    el('button', { class: 'btn primary', disabled: !s.selected, onclick: confirmSetup }, 'Use this file'),
  ]));
}

// Dialog = scrolling body + action buttons pinned at the bottom (always visible).
function dialogLayout(body, actions) {
  return [el('div', { class: 'dlg-body' }, body), el('div', { class: 'wiz-actions' }, actions)];
}

// ---- guided save wizard -----------------------------------------------------------------

function splitChanges() {
  const cfg = {};
  const video = {};
  const profile = {};
  for (const [k, v] of Object.entries(changes())) {
    if (isVideoKey(k)) video[videoName(k)] = v;
    else if (isProfileKey(k)) profile[profileName(k)] = v;
    else cfg[k] = v;
  }
  return { cfg, video, profile };
}

async function openWizard() {
  if (!Object.keys(changes()).length) return;
  try {
    const split = splitChanges();
    const diff = [];
    if (Object.keys(split.cfg).length) diff.push(...(await window.api.preview(state.file.filePath, split.cfg)).diff);
    if (Object.keys(split.video).length) diff.push(...(await window.api.previewVideo(state.video.filePath, split.video)).diff);
    if (Object.keys(split.profile).length) {
      const res = await window.api.preview(state.profile.filePath, split.profile);
      diff.push(...res.diff.map((d) => ({ ...d, name: `profile:${d.name}` })));
    }
    state.wizard = { phase: 'check', preview: { diff }, split, relock: true, results: null, error: null };
  } catch (err) {
    return toast(errorText(err), true);
  }
  renderWizard();
  $('#wizard').showModal();
  pollApex();
}

function renderWizard() {
  const w = state.wizard;
  if (!w) return;
  const d = $('#wizard');
  const close = () => d.close();

  if (w.phase === 'done') {
    const results = w.results;
    const total = results.reduce((n, r) => n + r.diff.length, 0);
    const relocked = results.every((r) => r.readOnlyAfter);
    setChildren(d, ...dialogLayout([
      el('div', { class: 'wiz-done-icon' }, '✓'),
      el('h2', { class: 'center' }, 'Your changes are saved'),
      el('ul', { class: 'wiz-results' },
        el('li', {}, `✓ ${total} change${total > 1 ? 's' : ''} written and double-checked`),
        el('li', {}, '✓ Backup saved first (Desktop → Apex Config Editor backups)'),
        relocked
          ? el('li', {}, '✓ Read-only, so Apex can’t reset your changes')
          : el('li', { class: 'warn-text' }, '⚠ Left editable (not read-only). Apex may reset these changes when it starts.'),
      ),
      el('p', { class: 'center dim' }, 'Start Apex. Your new settings load automatically.'),
    ], [
      el('button', { class: 'btn', onclick: () => { close(); restoreMany(results.map((r) => ({ filePath: r.filePath, backupPath: r.backup.snapshot })), 'Save undone. Your files are back to how they were.'); } }, '↶ Undo this save'),
      el('button', { class: 'btn primary', onclick: close }, 'Done'),
    ]));
    return;
  }

  const n = w.preview.diff.length;
  const apexOk = !state.apexRunning;
  const canSave = apexOk && !state.stale && w.phase !== 'saving';

  setChildren(d, ...dialogLayout([
    el('h2', {}, 'Save your changes'),

    apexOk
      ? el('div', { class: 'wiz-check ok' }, '✓ Apex is closed. Keep it closed until you’ve saved.')
      : el('div', { class: 'banner warn' },
        el('span', {}, 'Before saving, make sure Apex is closed. The game rewrites this file when it exits and would erase your changes.'),
        el('button', { class: 'btn small', onclick: pollApex }, 'Check again')),

    el('h3', { class: 'section-h' }, `What will change (${n})`),
    el('div', { class: 'wiz-diff' }, w.preview.diff.map((x) => el('div', { class: 'wiz-diff-row' },
      el('span', {}, labelFor(x.name)),
      el('span', { class: 'old' }, formatValue(x.name, x.oldValue)),
      el('span', { class: 'to' }, '→'),
      el('span', { class: 'new' }, formatValue(x.name, x.newValue))))),
    el('p', { class: 'dim small' }, 'Everything else stays exactly the same. A backup is saved to your Desktop first.'),

    el('label', { class: 'opt' },
      el('input', { type: 'checkbox', checked: w.relock, onchange: (e) => { w.relock = e.target.checked; renderWizard(); } }),
      el('span', {}, el('b', {}, 'Make files read-only after saving'), ' (recommended), so Apex can’t reset them')),
    w.relock ? null : el('p', { class: 'warn-text' }, '⚠ Not read-only, so Apex may reset these changes when it starts.'),

    state.stale ? el('div', { class: 'banner error' }, 'The file changed on disk since you opened it. Close this and press "Reload file" first.') : null,
    w.error ? el('div', { class: 'banner error' }, w.error) : null,
  ], [
    el('button', { class: 'btn', onclick: close }, 'Cancel'),
    el('button', { class: 'btn primary', disabled: !canSave, onclick: doSave },
      w.phase === 'saving' ? 'Saving…' : apexOk ? `Save ${n} change${n > 1 ? 's' : ''}` : 'Close Apex to continue'),
  ]));
}

async function doSave() {
  const w = state.wizard;
  w.phase = 'saving';
  w.error = null;
  renderWizard();
  state.saving = true;
  const results = [];
  const jobs = [];
  if (Object.keys(w.split.cfg).length) {
    jobs.push({ fileName: 'settings.cfg', filePath: state.file.filePath, run: () => window.api.save(state.file.filePath, w.split.cfg, { expectedMtimeMs: state.file.mtimeMs, reapplyReadOnly: w.relock }) });
  }
  if (Object.keys(w.split.video).length) {
    jobs.push({ fileName: 'videoconfig.txt', filePath: state.video.filePath, run: () => window.api.saveVideo(state.video.filePath, w.split.video, { expectedMtimeMs: state.video.mtimeMs, reapplyReadOnly: w.relock }) });
  }
  // profile.cfg holds many in-game menu settings, so it keeps whatever lock state it had (no forced lock).
  if (Object.keys(w.split.profile).length) {
    jobs.push({ fileName: 'profile.cfg', filePath: state.profile.filePath, run: () => window.api.save(state.profile.filePath, w.split.profile, { expectedMtimeMs: state.profile.mtimeMs }) });
  }
  try {
    for (const job of jobs) {
      const res = await job.run();
      if (!res.ok && res.reason === 'nochanges') continue;
      if (!res.ok) {
        if (res.reason === 'stale') state.stale = true;
        throw new Error(res.message);
      }
      results.push({ ...res, fileName: job.fileName, filePath: job.filePath });
    }
    await loadFile(state.file.filePath);
    w.phase = 'done';
    state.showLaunch = true;
    renderLaunchFab();
    w.results = results;
    renderWizard();
  } catch (err) {
    w.phase = 'check';
    const saved = results.map((r) => r.fileName).join(' and ');
    w.error = saved
      ? `${saved} was saved, but the next file failed: ${errorText(err)}. Nothing else changed.`
      : `Save failed: ${errorText(err)}. Your files were not changed.`;
    renderBanners();
    renderWizard();
  } finally {
    state.saving = false;
  }
}

// ---- floating "Launch Apex" button (after a save) ------------------------------------

function renderLaunchFab() {
  const fab = $('#launch-fab');
  fab.hidden = !state.showLaunch || state.apexRunning;
  if (fab.hidden) return;
  setChildren(fab,
    el('button', { class: 'btn primary fab-main', onclick: launchApex }, '▶ Launch Apex'),
    el('button', { class: 'fab-close', 'aria-label': 'Hide', title: 'Hide', onclick: () => { state.showLaunch = false; renderLaunchFab(); } }, '×'),
  );
}

async function launchApex() {
  try {
    await window.api.launchApex();
    state.showLaunch = false;
    renderLaunchFab();
    toast('Starting Apex through Steam…');
  } catch (err) {
    toast(`Couldn’t start Apex: ${errorText(err)}. Start it from your launcher.`, true);
  }
}

// Deletes one timestamped backup (never the ORIGINAL), then refreshes the lists. Pending edits are kept.
// Restores one or more files from backups (each restore backs up the current file first).
async function restoreMany(items, message = 'Restored. The version you had before was backed up too.') {
  if (state.apexRunning) return toast('Close Apex before restoring.', true);
  state.saving = true;
  try {
    for (const { filePath, backupPath } of items) {
      await window.api.restoreBackup(filePath, backupPath, { reapplyReadOnly: true });
    }
    await loadFile(state.file.filePath);
    toast(message);
  } catch (err) {
    toast(`Restore failed: ${errorText(err)}`, true);
  } finally {
    state.saving = false;
  }
}

let toastTimer;
function toast(message, isError = false) {
  const t = $('#toast');
  t.textContent = message;
  t.className = `toast${isError ? ' error' : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4000);
}

init();
