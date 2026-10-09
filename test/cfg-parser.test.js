const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parse, serialize, applyChanges } = require('../shared/cfg-parser');
const service = require('../shared/config-service');

const SAMPLE =
  'bind_US_standard "SPACE" "+jump;+dodge" 1\r\n' +
  'bind_US_standard "MWHEELUP" "+jump" 1\r\n' +
  'bind_US_standard "c" "+use; +use_long" 0\r\n' +
  'bind_held_US_standard "f" "+scriptCommand2" 0\r\n' +
  'm_acceleration "0"\r\n' +
  'mouse_sensitivity "1.6"\r\n';

test('round trip of the sample is byte-identical', () => {
  assert.strictEqual(serialize(parse(SAMPLE)), SAMPLE);
});

test('chained bind command stays ONE unit', () => {
  const [space, wheel] = parse(SAMPLE);
  assert.strictEqual(space.type, 'bind');
  assert.strictEqual(space.command, '+jump;+dodge');
  assert.deepStrictEqual(space.chain, ['+jump', '+dodge']);
  assert.strictEqual(wheel.command, '+jump');
});

test('held binds are detected', () => {
  assert.strictEqual(parse(SAMPLE)[3].held, true);
});

test('mixed line endings and no final newline survive', () => {
  const text = 'a "1"\nb "2"\r\nweird line here\n\nc "3"';
  assert.strictEqual(serialize(parse(text)), text);
});

test('applyChanges edits only the targeted value', () => {
  const lines = parse(SAMPLE);
  const { lines: next, diff } = applyChanges(lines, { m_acceleration: '1' });
  const out = serialize(next);
  assert.strictEqual(out, SAMPLE.replace('m_acceleration "0"', 'm_acceleration "1"'));
  assert.strictEqual(diff.length, 1);
  assert.strictEqual(diff[0].oldValue, '0');
  assert.strictEqual(diff[0].newValue, '1');
  assert.strictEqual(serialize(lines), SAMPLE, 'input lines must not be mutated');
});

test('bind change swaps only the command, keeps the flag and line ending', () => {
  const lines = parse(SAMPLE);
  const { lines: next, diff } = applyChanges(lines, { 'bind:tap:MWHEELUP:1': '+jump;+dodge' });
  assert.strictEqual(serialize(next), SAMPLE.replace('"MWHEELUP" "+jump" 1', '"MWHEELUP" "+jump;+dodge" 1'));
  assert.strictEqual(diff[0].oldValue, '+jump');
});

test('missing bind is added after the last bind; later line numbers shift', () => {
  const { lines: next, diff } = applyChanges(parse(SAMPLE), {
    'bind:tap:MWHEELDOWN:1': '+jump',
    m_acceleration: '1',
  });
  const out = serialize(next).split('\r\n');
  assert.strictEqual(out[4], 'bind_US_standard "MWHEELDOWN" "+jump" 1');
  assert.strictEqual(out[5], 'm_acceleration "1"');
  const accel = diff.find((d) => d.name === 'm_acceleration');
  assert.strictEqual(accel.lineNumber, 6);
  assert.strictEqual(diff.find((d) => d.added).lineNumber, 5);
});

test('values with quotes are rejected', () => {
  assert.throws(() => applyChanges(parse(SAMPLE), { mouse_sensitivity: '1"' }));
});

test('real Desktop test copy round-trips byte-identical (if present)', { skip: !fs.existsSync(service.TEST_PATH) }, () => {
  const text = fs.readFileSync(service.TEST_PATH, 'utf8');
  assert.strictEqual(serialize(parse(text)), text);
  const space = parse(text).find((l) => l.type === 'bind' && l.key === 'SPACE');
  assert.strictEqual(space.command, '+jump;+dodge');
});

test('resolveConfigInput finds settings.cfg from a pasted folder, file, quotes or %VAR%', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-find-'));
  const local = path.join(root, 'Respawn', 'Apex', 'local');
  fs.mkdirSync(local, { recursive: true });
  fs.writeFileSync(path.join(local, 'settings.cfg'), SAMPLE);
  process.env.ACE_TEST_ROOT = root;
  for (const input of [root, path.join(root, 'Respawn'), local, `"${local}"`, path.join(local, 'settings.cfg'), '%ACE_TEST_ROOT%\\Respawn\\Apex']) {
    const res = service.resolveConfigInput(input);
    assert.strictEqual(res.ok, true, `should resolve: ${input}`);
    assert.strictEqual(res.path, path.join(local, 'settings.cfg'));
  }
  assert.strictEqual(service.resolveConfigInput(path.join(root, 'nope')).ok, false);
  fs.writeFileSync(path.join(root, 'settings.cfg'), 'not a config at all {');
  assert.strictEqual(service.resolveConfigInput(path.join(root, 'settings.cfg')).ok, false);
  fs.rmSync(root, { recursive: true, force: true });
});

const VIDEO = '"VideoConfig"\n{\n\t"setting.defaultres"\t\t"1920"\n\t"setting.defaultresheight"\t\t"1080"\n\t"setting.fullscreen"\t\t"1"\n}\n\0';

test('videoconfig: edit + add values, keep NUL byte, backup, relock', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-video-'));
  const cfg = path.join(dir, 'settings.cfg');
  const file = path.join(dir, 'videoconfig.txt');
  fs.writeFileSync(cfg, SAMPLE);
  fs.writeFileSync(file, VIDEO);
  fs.chmodSync(file, 0o444);

  const v = service.loadVideo(cfg);
  assert.strictEqual(v.values['setting.defaultres'], '1920');
  const res = service.saveVideo(file, { 'setting.defaultres': '1728', 'setting.dvs_enable': '0' }, { expectedMtimeMs: v.mtimeMs });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.readOnlyAfter, true);
  const out = fs.readFileSync(file, 'utf8');
  assert.strictEqual(out, VIDEO.replace('"1920"', '"1728"').replace('\n}\n', '\n\t"setting.dvs_enable"\t\t"0"\n}\n'));
  assert.strictEqual(service.compareWithBackup(file, res.backup.original).diffs.length, 2);
  fs.chmodSync(file, 0o666);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('backup folders never collide between same-named files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-bk-'));
  const a = path.join(root, 'a', 'settings.cfg');
  const b = path.join(root, 'b', 'settings.cfg');
  for (const f of [a, b]) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, f === a ? SAMPLE : SAMPLE.replace('"1.6"', '"2.0"'));
  }
  service.setBackupRoot(path.join(root, 'backups'));
  try {
    const oa = service.ensureOriginal(a);
    const ob = service.ensureOriginal(b);
    assert.notStrictEqual(path.dirname(oa), path.dirname(ob));
    assert.throws(() => service.restoreBackup(a, ob), /Not a backup of this file/);
  } finally {
    service.setBackupRoot(null);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('save: backs up, keeps ORIGINAL, respects read-only, detects stale', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-'));
  const file = path.join(dir, 'settings.cfg');
  fs.writeFileSync(file, SAMPLE);
  fs.chmodSync(file, 0o444); // read-only like the real file

  const loaded = service.load(file);
  assert.strictEqual(loaded.readOnly, true);

  const r1 = service.save(file, { m_acceleration: '1' }, { expectedMtimeMs: loaded.mtimeMs });
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.readOnlyAfter, true);
  assert.strictEqual(service.load(file).readOnly, true);

  service.save(file, { mouse_sensitivity: '2.0' });
  const backups = service.listBackups(file);
  const original = backups.find((b) => b.isOriginal);
  assert.strictEqual(fs.readFileSync(original.path, 'utf8'), SAMPLE, 'ORIGINAL is never overwritten');

  const stale = service.save(file, { m_acceleration: '0' }, { expectedMtimeMs: 1 });
  assert.strictEqual(stale.reason, 'stale');

  service.restoreBackup(file, original.path);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), SAMPLE);

  fs.chmodSync(file, 0o666);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('restore saves the current file first, even twice in the same second', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-'));
  const file = path.join(dir, 'settings.cfg');
  fs.writeFileSync(file, SAMPLE);
  service.save(file, { mouse_sensitivity: '2.5' });
  const original = service.listBackups(file).find((b) => b.isOriginal);

  // Two restores right after a save: every state before each write must survive in a backup.
  service.restoreBackup(file, original.path);
  service.save(file, { mouse_sensitivity: '3.0' });
  service.restoreBackup(file, original.path);

  const kept = service.listBackups(file).filter((b) => !b.isOriginal).map((b) => fs.readFileSync(b.path, 'utf8'));
  assert.ok(kept.some((t) => t.includes('mouse_sensitivity "2.5"')), 'the 2.5 version was backed up before the first restore');
  assert.ok(kept.some((t) => t.includes('mouse_sensitivity "3.0"')), 'the 3.0 version was backed up before the second restore');
  assert.strictEqual(new Set(service.listBackups(file).map((b) => b.file)).size, service.listBackups(file).length, 'no backup name used twice');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('deleteBackup: removes one backup, refuses the ORIGINAL and outside files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-'));
  const file = path.join(dir, 'settings.cfg');
  fs.writeFileSync(file, SAMPLE);
  service.save(file, { m_acceleration: '1' });

  const before = service.listBackups(file);
  const original = before.find((b) => b.isOriginal);
  const snapshot = before.find((b) => !b.isOriginal);

  assert.throws(() => service.deleteBackup(file, original.path), /ORIGINAL/);
  assert.throws(() => service.deleteBackup(file, file), /not one of/);

  service.deleteBackup(file, snapshot.path);
  const after = service.listBackups(file);
  assert.strictEqual(after.length, before.length - 1);
  assert.ok(after.some((b) => b.isOriginal), 'ORIGINAL is still there');

  fs.rmSync(dir, { recursive: true, force: true });
});
