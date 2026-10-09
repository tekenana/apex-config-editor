// Version B renderer: views per section, search, sliders, raw editor, live diff side panel.
const VIEWS = [
  { id: 'graphics', title: 'Graphics', icon: '◧' },
  { id: 'gameplay', title: 'Gameplay', icon: '◎' },
  { id: 'audio', title: 'Audio & voice', icon: '♪' },
  { id: 'binds', title: 'Binds', icon: '⌨' },
  { id: 'all', title: 'All settings', icon: '≡' },
];

const state = { info: null, file: null, changes: {}, view: 'graphics', query: '', chainsOnly: false };
const $ = (sel) => document.querySelector(sel);

async function init() {
  state.info = await window.api.info();
  await loadFile(state.info.defaultPath);

  $('#search').addEventListener('input', (e) => {
    state.query = e.target.value.trim().toLowerCase();
    renderView();
  });
  $('#open-btn').addEventListener('click', async () => {
    const picked = await window.api.pickFile();
    if (picked) await loadFile(picked);
  });
  $('#discard-btn').addEventListener('click', () => {
    state.changes = {};
    renderAll();
  });
  $('#save-btn').addEventListener('click', save);
}

async function loadFile(filePath) {
  try {
    state.file = await window.api.load(filePath);
    state.changes = {};
    $('#relock').checked = state.file.readOnly;
    renderAll();
  } catch (err) {
    status(`Could not open: ${errorText(err)}`, 'error');
  }
}

// ---- change tracking --------------------------------------------------------

function original(name) {
  const line = findCvar(state.file.lines, name);
  return line ? line.value : null;
}

function current(name) {
  return state.changes[name] ?? original(name);
}

function setChange(name, value) {
  if (value === original(name)) delete state.changes[name];
  else state.changes[name] = value;
  document.querySelectorAll(`[data-name="${CSS.escape(name)}"]`).forEach((row) => row.classList.toggle('changed', name in state.changes));
  renderChanges();
  renderNav();
}

function matches(...texts) {
  return !state.query || texts.some((t) => t && t.toLowerCase().includes(state.query));
}

// ---- rendering ----------------------------------------------------------------

function renderAll() {
  const f = state.file;
  $('#file-name').textContent = f.fileName;
  $('#file-name').title = f.filePath;
  $('#file-badges').replaceChildren(el('span', {},
    f.isRealFile ? el('span', { class: 'badge danger' }, 'LIVE') : el('span', { class: 'badge' }, 'TEST COPY'),
    f.readOnly ? el('span', { class: 'badge' }, 'READ-ONLY') : null,
  ));
  renderNav();
  renderView();
  renderChanges();
}

function renderNav() {
  const changedIn = (id) => {
    const names = Object.keys(state.changes);
    if (id === 'all') return names.length;
    return names.filter((n) => state.info.catalog.some((c) => c.name === n && c.section === id)).length;
  };
  $('#nav').replaceChildren(...VIEWS.map((v) => {
    const n = changedIn(v.id);
    return el('button', {
      class: `nav-item${state.view === v.id ? ' active' : ''}`,
      onclick: () => { state.view = v.id; renderNav(); renderView(); },
    }, el('span', { class: 'icon' }, v.icon), v.title, n ? el('span', { class: 'count' }, n) : null);
  }));
}

function renderView() {
  const view = VIEWS.find((v) => v.id === state.view);
  $('#view-title').textContent = view.title;
  let body;
  if (state.view === 'binds') body = renderBinds();
  else if (state.view === 'all') body = renderAllSettings();
  else body = renderSection(state.view);
  $('#view').replaceChildren(body);
}

function renderSection(section) {
  const items = state.info.catalog.filter((c) => c.section === section && matches(c.label, c.name, c.help));
  if (!items.length) return el('p', { class: 'empty' }, 'No settings match your search.');
  return el('div', { class: 'grid' }, items.map(renderControl));
}

function renderControl(item) {
  const orig = original(item.name);
  const cls = `tile${item.name in state.changes ? ' changed' : ''}`;
  if (orig === null) {
    return el('div', { class: `${cls} missing` }, el('div', { class: 'tile-label' }, item.label), el('div', { class: 'tile-help' }, 'Not present in this file'));
  }
  const header = [
    el('div', { class: 'tile-label' }, item.label, item.verified ? null : el('span', { class: 'unverified', title: 'Effect not verified' }, '?')),
    el('div', { class: 'tile-help' }, item.help),
    el('code', { class: 'tile-cvar' }, `${item.name}  ·  file: "${orig}"`),
  ];

  if (item.type === 'toggle') {
    return el('label', { class: `${cls} toggle`, dataset: { name: item.name } },
      el('div', {}, header),
      el('input', { type: 'checkbox', class: 'switch', checked: current(item.name) === '1', onchange: (e) => setChange(item.name, e.target.checked ? '1' : '0') }),
    );
  }

  // number: slider + exact input, kept in sync without re-rendering (so dragging stays smooth)
  const decimals = (String(item.step).split('.')[1] || '').length;
  const num = el('input', { type: 'number', class: 'num', min: String(item.min), max: String(item.max), step: String(item.step), value: current(item.name) });
  const range = el('input', { type: 'range', min: String(item.min), max: String(item.max), step: String(item.step), value: current(item.name) });
  range.addEventListener('input', () => {
    num.value = Number(range.value).toFixed(decimals);
    setChange(item.name, num.value);
  });
  num.addEventListener('change', () => {
    if (num.value === '' || Number.isNaN(Number(num.value))) num.value = current(item.name);
    range.value = num.value;
    setChange(item.name, num.value);
  });
  return el('div', { class: `${cls} number`, dataset: { name: item.name } }, header, el('div', { class: 'slider-row' }, range, num));
}

function chainView(bind) {
  if (!bind) return el('span', { class: 'none' }, '—');
  const parts = bind.chain.map((c) => el('span', { class: 'chip' }, c));
  const joined = parts.flatMap((p, i) => (i ? [el('span', { class: 'arrow' }, '+'), p] : [p]));
  return el('span', { class: 'chips', title: `Raw: "${bind.command}"` }, joined);
}

function renderBinds() {
  const byKey = new Map();
  for (const b of state.file.lines.filter((l) => l.type === 'bind')) {
    if (!byKey.has(b.key)) byKey.set(b.key, { tap: [], held: [] });
    byKey.get(b.key)[b.held ? 'held' : 'tap'].push(b);
  }
  const rows = [...byKey.entries()].filter(([key, v]) => {
    const all = [...v.tap, ...v.held];
    if (state.chainsOnly && !all.some((b) => b.chain.length > 1)) return false;
    return matches(key, ...all.map((b) => b.command));
  });

  const filter = el('label', { class: 'opt inline' },
    el('input', { type: 'checkbox', checked: state.chainsOnly, onchange: (e) => { state.chainsOnly = e.target.checked; renderView(); } }),
    ' Only show chained commands (e.g. +jump;+dodge)');

  return el('div', {},
    el('p', { class: 'note' }, 'Read-only in v1. Key remapping is planned for v2.'),
    filter,
    el('table', { class: 'table' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Key'), el('th', {}, 'Tap'), el('th', {}, 'Hold'))),
      el('tbody', {}, rows.map(([key, v]) =>
        el('tr', {},
          el('td', {}, el('kbd', {}, key)),
          el('td', {}, v.tap.length ? v.tap.map((b) => el('div', {}, chainView(b))) : chainView(null)),
          el('td', {}, v.held.length ? v.held.map((b) => el('div', {}, chainView(b))) : chainView(null)),
        ),
      )),
    ),
    rows.length ? null : el('p', { class: 'empty' }, 'No binds match.'),
  );
}

function renderAllSettings() {
  const cvars = state.file.lines.filter((l) => l.type === 'cvar' && matches(l.name, l.value));
  return el('div', {},
    el('p', { class: 'note' }, 'Raw editor for every plain setting in the file. Changes appear in the panel on the right.'),
    el('table', { class: 'table' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Line'), el('th', {}, 'Setting'), el('th', {}, 'Value'))),
      el('tbody', {}, cvars.map((l) =>
        el('tr', { dataset: { name: l.name }, class: l.name in state.changes ? 'changed' : null },
          el('td', { class: 'dim' }, l.lineNumber),
          el('td', {}, el('code', {}, l.name)),
          el('td', {}, el('input', {
            class: 'raw',
            value: current(l.name),
            onchange: (e) => {
              if (e.target.value.includes('"')) { e.target.value = current(l.name); return status('Quotes are not allowed in values', 'error'); }
              setChange(l.name, e.target.value);
            },
          })),
        ),
      )),
    ),
  );
}

function renderChanges() {
  const names = Object.keys(state.changes);
  $('#change-count').textContent = names.length;
  $('#save-btn').disabled = names.length === 0;
  $('#discard-btn').disabled = names.length === 0;
  if (!names.length) {
    $('#change-list').replaceChildren(el('p', { class: 'empty' }, 'Nothing changed yet. Flip a toggle or drag a slider.'));
    return;
  }
  $('#change-list').replaceChildren(...names.map((name) => {
    const line = findCvar(state.file.lines, name);
    return el('div', { class: 'change' },
      el('div', { class: 'change-head' },
        el('code', {}, name),
        el('button', { class: 'undo', title: 'Undo this change', onclick: () => { delete state.changes[name]; renderAll(); } }, '×'),
      ),
      el('div', { class: 'd del' }, `- ${line.raw}`),
      el('div', { class: 'd add' }, `+ ${line.before}${state.changes[name]}${line.after}`),
    );
  }));
}

async function save() {
  const running = await window.api.isApexRunning();
  if (running) return status('Apex is running. Close the game first, or it may overwrite your changes.', 'error');
  try {
    const res = await window.api.save(state.file.filePath, state.changes, {
      expectedMtimeMs: state.file.mtimeMs,
      reapplyReadOnly: $('#relock').checked,
    });
    if (!res.ok) return status(res.message, 'error');
    await loadFile(state.file.filePath);
    status(`Saved ${res.diff.length} change(s). Backup in ${res.backup.snapshot.split(/[\\/]/).slice(-2).join('/')}`, 'ok');
  } catch (err) {
    status(`Save failed: ${errorText(err)}`, 'error');
  }
}

function status(msg, kind) {
  $('#status').textContent = msg;
  $('#status').className = `status ${kind}`;
}

init();
