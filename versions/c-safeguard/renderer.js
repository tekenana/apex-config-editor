// Version C renderer: every write is gated by checks (game closed, file not stale,
// live-file acknowledgement) and shows a full-file diff with context first.
const SECTIONS = [
  { id: 'graphics', title: 'Graphics' },
  { id: 'gameplay', title: 'Gameplay' },
  { id: 'audio', title: 'Audio & voice' },
];
const CONTEXT = 2; // unchanged lines shown around each change

const state = {
  info: null,
  file: null,
  changes: {},
  preview: null,
  apexRunning: false,
  stale: false,
  saving: false,
  liveAck: false,
  relock: true,
  tab: 'review',
  backups: [],
  confirmRestore: null,
};
const $ = (sel) => document.querySelector(sel);

async function init() {
  state.info = await window.api.info();
  $('#open-btn').addEventListener('click', async () => {
    const picked = await window.api.pickFile();
    if (picked) await loadFile(picked);
  });
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

  window.api.onChangedOnDisk(({ mtimeMs }) => {
    if (state.saving || Math.abs(mtimeMs - state.file.mtimeMs) <= 1) return;
    state.stale = true;
    renderChrome();
    renderReview();
  });

  await loadFile(state.info.defaultPath);
  await pollApex();
  setInterval(pollApex, 5000);
}

async function loadFile(filePath) {
  try {
    state.file = await window.api.load(filePath);
  } catch (err) {
    return banner(`Could not open file: ${errorText(err)}`, 'error');
  }
  state.changes = {};
  state.preview = null;
  state.stale = false;
  state.liveAck = false;
  state.relock = state.file.readOnly;
  state.confirmRestore = null;
  await window.api.watch(filePath);
  state.backups = await window.api.listBackups(filePath);
  renderAll();
}

async function pollApex() {
  const running = await window.api.isApexRunning();
  if (running !== state.apexRunning) {
    state.apexRunning = running;
    renderChrome();
    renderReview();
  }
}

// ---- changes ------------------------------------------------------------------

async function setChange(name, value) {
  const line = findCvar(state.file.lines, name);
  if (value === line.value) delete state.changes[name];
  else state.changes[name] = value;
  await refreshPreview();
  renderSettings();
  renderReview();
}

async function refreshPreview() {
  state.preview = Object.keys(state.changes).length
    ? await window.api.preview(state.file.filePath, state.changes)
    : null;
  renderSteps();
}

function blockers() {
  const list = [];
  if (!Object.keys(state.changes).length) list.push('No changes to write yet.');
  if (state.apexRunning) list.push('Apex Legends is running. Close it first so it does not overwrite the file.');
  if (state.stale) list.push('The file changed on disk since it was loaded. Reload first.');
  if (state.file.isRealFile && !state.liveAck) list.push('Confirm you want to edit the live game file.');
  if (!state.file.roundTripOk) list.push('Parser round-trip check failed for this file. Writing is disabled.');
  return list;
}

// ---- rendering -----------------------------------------------------------------

function renderAll() {
  renderChrome();
  renderSettings();
  renderReview();
  renderBackups();
  renderSteps();
}

function check(ok, label, detail) {
  return el('div', { class: `check ${ok ? 'ok' : 'bad'}`, title: detail || '' }, el('span', { class: 'pip' }), label);
}

function renderChrome() {
  const f = state.file;
  $('#file-path').textContent = f.filePath;
  $('#checks').replaceChildren(
    check(!f.isRealFile, f.isRealFile ? 'Live game file' : 'Test copy'),
    check(true, f.readOnly ? 'Read-only on disk' : 'Writable', 'Read-only is cleared only during the write'),
    check(f.roundTripOk, f.roundTripOk ? 'Round-trip OK' : 'Round-trip FAILED', 'parse → serialize reproduces the file byte for byte'),
    check(!state.apexRunning, state.apexRunning ? 'Apex running' : 'Apex closed'),
    check(!state.stale, state.stale ? 'Changed on disk' : 'In sync', `Loaded ${fmtTime(f.mtimeMs)}`),
  );

  const banners = [];
  if (f.isRealFile) {
    banners.push(el('div', { class: 'banner warn' }, '⚠ You are editing the LIVE Apex settings file. A backup is made before every write.'));
  }
  if (state.stale) {
    banners.push(el('div', { class: 'banner error' },
      'The file was changed by something else (maybe the game) after you opened it.',
      el('button', { class: 'btn small', onclick: () => loadFile(f.filePath) }, 'Reload (discards your edits)'),
    ));
  }
  $('#banners').replaceChildren(...banners);
}

function renderSteps() {
  const has = Object.keys(state.changes).length > 0;
  $('#step-1').className = `step ${has ? 'done' : 'current'}`;
  $('#step-2').className = `step ${has ? 'current' : ''}`;
  $('#step-3').className = `step ${has && blockers().length === 0 ? 'ready' : ''}`;
}

function renderSettings() {
  const groups = SECTIONS.map((s) => {
    const items = state.info.catalog.filter((c) => c.section === s.id);
    return el('div', { class: 'group' }, el('h2', {}, s.title), items.map(renderSetting));
  });
  $('#settings-list').replaceChildren(...groups);
}

function renderSetting(item) {
  const line = findCvar(state.file.lines, item.name);
  if (!line) return el('div', { class: 'setting missing' }, el('span', {}, item.label), el('span', { class: 'dim' }, 'not in file'));
  const changed = item.name in state.changes;
  const value = state.changes[item.name] ?? line.value;
  const control = item.type === 'toggle'
    ? el('input', { type: 'checkbox', class: 'switch', checked: value === '1', 'aria-label': item.label, onchange: (e) => setChange(item.name, e.target.checked ? '1' : '0') })
    : el('input', {
      type: 'number', class: 'num', min: String(item.min), max: String(item.max), step: String(item.step), value, 'aria-label': item.label,
      onchange: (e) => {
        const n = Number(e.target.value);
        if (e.target.value === '' || Number.isNaN(n) || n < item.min || n > item.max) {
          e.target.value = value;
          return banner(`${item.label} must be between ${item.min} and ${item.max}`, 'error', 4000);
        }
        setChange(item.name, e.target.value);
      },
    });
  return el('div', { class: `setting${changed ? ' changed' : ''}` },
    el('div', { class: 'setting-text' },
      el('div', { class: 'setting-label' }, item.label, item.verified ? null : el('span', { class: 'tag' }, 'unverified')),
      el('div', { class: 'dim' }, item.help),
      changed ? el('div', { class: 'was' }, `was "${line.value}"`) : null,
    ),
    control,
  );
}

// Build hunks of changed lines with a little context, like `git diff`.
function buildHunks(before, after) {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const changed = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed.push(i);
  const hunks = [];
  for (const i of changed) {
    const start = Math.max(0, i - CONTEXT);
    const end = Math.min(a.length - 1, i + CONTEXT);
    const last = hunks[hunks.length - 1];
    if (last && start <= last.end + 1) last.end = end;
    else hunks.push({ start, end });
  }
  return hunks.map((h) => {
    const rows = [];
    for (let i = h.start; i <= h.end; i++) {
      if (a[i] === b[i]) rows.push({ n: i + 1, kind: 'ctx', text: a[i] });
      else {
        rows.push({ n: i + 1, kind: 'del', text: a[i] });
        rows.push({ n: i + 1, kind: 'add', text: b[i] });
      }
    }
    return rows;
  });
}

function renderReview() {
  const body = $('#tab-review');
  if (!state.preview) {
    body.replaceChildren(el('div', { class: 'empty' },
      el('p', {}, 'No changes yet.'),
      el('p', { class: 'dim' }, `Edit a setting on the left. Every change shows up here as a diff against ${state.file.fileName} before anything is written.`),
    ));
    return;
  }
  const hunks = buildHunks(state.preview.before, state.preview.after);
  const total = state.file.lines.length;
  const diffEl = el('div', { class: 'diff' }, hunks.map((rows, i) =>
    el('div', { class: 'hunk' },
      i === 0 && rows[0].n > 1 ? el('div', { class: 'gap' }, `··· ${rows[0].n - 1} unchanged lines`) : null,
      rows.map((r) => el('div', { class: `dl ${r.kind}` },
        el('span', { class: 'ln' }, r.n),
        el('span', { class: 'sign' }, r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ' '),
        el('span', { class: 'code' }, r.text),
      )),
      el('div', { class: 'gap' }, i < hunks.length - 1 ? '···' : `··· through line ${total}`),
    ),
  ));

  const blocked = blockers();
  const summary = `${state.preview.diff.length} line(s) of ${total} will change. ${total - state.preview.diff.length} stay byte-for-byte identical.`;

  body.replaceChildren(
    el('p', { class: 'summary' }, summary),
    diffEl,
    el('div', { class: 'write-box' },
      el('label', { class: 'opt' },
        el('input', { type: 'checkbox', checked: state.relock, onchange: (e) => { state.relock = e.target.checked; } }),
        'Set the file back to read-only after writing'),
      state.file.isRealFile ? el('label', { class: 'opt strong' },
        el('input', { type: 'checkbox', checked: state.liveAck, onchange: (e) => { state.liveAck = e.target.checked; renderReview(); renderSteps(); } }),
        'I understand this edits my live Apex settings file') : null,
      blocked.length ? el('ul', { class: 'blockers' }, blocked.map((b) => el('li', {}, b))) : null,
      el('div', { class: 'write-actions' },
        el('button', { class: 'btn', onclick: () => { state.changes = {}; refreshPreview().then(renderAll); } }, 'Discard changes'),
        el('button', { class: 'btn primary', disabled: blocked.length > 0, onclick: write }, 'Back up & write to disk'),
      ),
    ),
  );
}

function renderBackups() {
  const body = $('#tab-backups');
  if (!state.backups.length) {
    body.replaceChildren(el('div', { class: 'empty' },
      el('p', {}, 'No backups yet.'),
      el('p', { class: 'dim' }, 'The first write saves a permanent ORIGINAL copy that is never overwritten, plus a timestamped copy for every write.'),
    ));
    return;
  }
  body.replaceChildren(
    el('p', { class: 'dim' }, 'Restoring also backs up the current file first, so a restore can be undone too.'),
    el('div', { class: 'backup-list' }, state.backups.map((b) => {
      const confirming = state.confirmRestore === b.path;
      return el('div', { class: `backup${b.isOriginal ? ' original' : ''}` },
        el('div', {},
          el('div', { class: 'backup-name' }, b.isOriginal ? '📌 ORIGINAL (before first edit)' : b.file),
          el('div', { class: 'dim' }, `${fmtTime(b.mtimeMs)} · ${b.size} bytes`),
        ),
        confirming
          ? el('div', { class: 'confirm' },
            el('button', { class: 'btn small', onclick: () => { state.confirmRestore = null; renderBackups(); } }, 'Cancel'),
            el('button', { class: 'btn small primary', disabled: state.apexRunning, onclick: () => restore(b.path) }, 'Yes, restore'))
          : el('button', { class: 'btn small', onclick: () => { state.confirmRestore = b.path; renderBackups(); } }, 'Restore…'),
      );
    })),
  );
}

function showTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  $('#tab-review').hidden = tab !== 'review';
  $('#tab-backups').hidden = tab !== 'backups';
}

// ---- actions ---------------------------------------------------------------------

async function write() {
  if (blockers().length) return;
  state.saving = true;
  try {
    const res = await window.api.save(state.file.filePath, state.changes, {
      expectedMtimeMs: state.file.mtimeMs,
      reapplyReadOnly: state.relock,
    });
    if (!res.ok) {
      if (res.reason === 'stale') state.stale = true;
      renderAll();
      return banner(res.message, 'error', 6000);
    }
    await loadFile(state.file.filePath);
    banner(`✔ Wrote ${res.diff.length} change(s) and verified the file on disk. Backup: ${res.backup.snapshot.split(/[\\/]/).pop()}`, 'ok', 6000);
  } catch (err) {
    banner(`Write failed: ${errorText(err)}`, 'error');
  } finally {
    state.saving = false;
  }
}

async function restore(backupPath) {
  state.saving = true;
  try {
    await window.api.restoreBackup(state.file.filePath, backupPath, { reapplyReadOnly: state.file.readOnly });
    await loadFile(state.file.filePath);
    showTab('backups');
    banner('✔ Backup restored. The previous state was backed up too.', 'ok', 6000);
  } catch (err) {
    banner(`Restore failed: ${errorText(err)}`, 'error');
  } finally {
    state.saving = false;
  }
}

function banner(message, kind, timeout) {
  const b = el('div', { class: `banner ${kind}` }, message);
  $('#banners').append(b);
  if (timeout) setTimeout(() => b.remove(), timeout);
}

init();
