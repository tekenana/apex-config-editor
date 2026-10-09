// Version A renderer: stacked sections, on/off switches only, preview dialog before save.
const SECTIONS = [
  { id: 'graphics', title: 'Graphics' },
  { id: 'gameplay', title: 'Gameplay' },
  { id: 'audio', title: 'Audio & voice' },
];

const state = { info: null, file: null, changes: {} };
const $ = (sel) => document.querySelector(sel);

async function init() {
  state.info = await window.api.info();
  await loadFile(state.info.defaultPath);

  $('#open-btn').addEventListener('click', async () => {
    const picked = await window.api.pickFile();
    if (picked) await loadFile(picked);
  });
  $('#reset-btn').addEventListener('click', () => {
    state.changes = {};
    render();
  });
  $('#preview-btn').addEventListener('click', openPreview);
  $('#cancel-btn').addEventListener('click', () => $('#preview-dialog').close());
  $('#confirm-save-btn').addEventListener('click', confirmSave);
}

async function loadFile(filePath) {
  try {
    state.file = await window.api.load(filePath);
    state.changes = {};
    render();
  } catch (err) {
    toast(`Could not open file: ${errorText(err)}`, true);
  }
}

function setToggle(name, on, originalValue) {
  const value = on ? '1' : '0';
  if (value === originalValue) delete state.changes[name];
  else state.changes[name] = value;
  render();
}

function render() {
  const { file } = state;
  $('#file-name').textContent = file.fileName;
  $('#file-name').title = file.filePath;
  $('#file-badges').replaceChildren(el('span', {},
    file.isRealFile ? el('span', { class: 'badge danger' }, 'LIVE GAME FILE') : el('span', { class: 'badge' }, 'test copy'),
    file.readOnly ? el('span', { class: 'badge' }, 'read-only') : null,
  ));

  const toggles = state.info.catalog.filter((c) => c.type === 'toggle');
  const cards = SECTIONS.map((section) =>
    el('section', { class: 'card' },
      el('h2', {}, section.title),
      toggles.filter((c) => c.section === section.id).map(renderToggle),
    ),
  );
  cards.push(renderBinds());
  $('#sections').replaceChildren(...cards);

  const count = Object.keys(state.changes).length;
  $('#change-count').textContent = count === 0 ? 'No changes' : `${count} change${count > 1 ? 's' : ''} pending`;
  $('#reset-btn').disabled = count === 0;
  $('#preview-btn').disabled = count === 0;
}

function renderToggle(item) {
  const line = findCvar(state.file.lines, item.name);
  if (!line) {
    return el('div', { class: 'row disabled' },
      el('div', {}, el('div', { class: 'label' }, item.label), el('div', { class: 'help' }, 'Not in this file')),
    );
  }
  const current = state.changes[item.name] ?? line.value;
  const changed = item.name in state.changes;
  const id = `t-${item.name}`;
  return el('div', { class: `row${changed ? ' changed' : ''}` },
    el('label', { for: id },
      el('div', { class: 'label' }, item.label, changed ? el('span', { class: 'dot', title: 'Changed' }) : null),
      el('div', { class: 'help' }, item.help, item.verified ? null : ' (unverified)'),
      el('code', { class: 'cvar' }, item.name),
    ),
    el('input', {
      id,
      type: 'checkbox',
      class: 'switch',
      checked: current === '1',
      onchange: (e) => setToggle(item.name, e.target.checked, line.value),
    }),
  );
}

function renderBinds() {
  const binds = state.file.lines.filter((l) => l.type === 'bind');
  return el('section', { class: 'card' },
    el('details', { open: state.bindsOpen, ontoggle: (e) => (state.bindsOpen = e.target.open) },
      el('summary', {}, el('h2', {}, `Binds `, el('span', { class: 'muted small' }, `${binds.length} · read-only`))),
      el('table', { class: 'binds' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Key'), el('th', {}, 'Type'), el('th', {}, 'Command'))),
        el('tbody', {}, binds.map((b) =>
          el('tr', {},
            el('td', {}, el('kbd', {}, b.key)),
            el('td', { class: 'muted' }, b.held ? 'hold' : 'tap'),
            el('td', {}, el('code', {}, b.command), b.chain.length > 1 ? el('span', { class: 'badge chain' }, 'chain') : null),
          ),
        )),
      ),
    ),
  );
}

async function openPreview() {
  try {
    const result = await window.api.preview(state.file.filePath, state.changes);
    $('#diff-list').replaceChildren(...result.diff.map((d) =>
      el('div', { class: 'diff-item' },
        el('div', { class: 'diff-line del' }, `- ${d.oldRaw}`),
        el('div', { class: 'diff-line add' }, `+ ${d.newRaw}`),
        el('div', { class: 'muted small' }, `line ${d.lineNumber}`),
      ),
    ));
    $('#backup-note').textContent = state.file.readOnly
      ? 'A backup is made first. The read-only flag is cleared to write, then put back.'
      : 'A backup is made first.';
    $('#preview-dialog').showModal();
  } catch (err) {
    toast(errorText(err), true);
  }
}

async function confirmSave() {
  $('#preview-dialog').close();
  try {
    const res = await window.api.save(state.file.filePath, state.changes, { expectedMtimeMs: state.file.mtimeMs });
    if (!res.ok) return toast(res.message, true);
    toast(`Saved ${res.diff.length} change(s). Backup: ${res.backup.snapshot.split(/[\\/]/).pop()}`);
    await loadFile(state.file.filePath);
  } catch (err) {
    toast(`Save failed: ${errorText(err)}`, true);
  }
}

let toastTimer;
function toast(message, isError = false) {
  const t = $('#toast');
  t.textContent = message;
  t.className = `toast${isError ? ' error' : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 5000);
}

init();
