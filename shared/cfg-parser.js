// Parses an Apex Legends settings.cfg into a line-by-line model and back.
// Rule #1: an unmodified line is written back EXACTLY as it was read
// (same spacing, same quotes, same line ending), so a parse -> serialize
// round trip is byte-identical.

// bind_US_standard "SPACE" "+jump;+dodge" 1
const BIND_RE = /^(\s*)(bind\w*)(\s+)"([^"]*)"(\s+)"([^"]*)"(?:(\s+)(\S+))?(\s*)$/;
// mouse_sensitivity "1.6"
const CVAR_RE = /^(\s*)([A-Za-z_][\w.]*)(\s+)"([^"]*)"(\s*)$/;

// A bind is identified by tap/hold + key + slot flag, e.g. "bind:tap:SPACE:1".
// (cvar names never contain ":", so the two kinds of change keys can't collide.)
function bindId(held, key, flag) {
  return `bind:${held ? 'hold' : 'tap'}:${key}:${flag ?? ''}`;
}

function splitChain(command) {
  return command.split(';').map((c) => c.trim()).filter(Boolean);
}

// Split text into lines, remembering each line's own ending ("\r\n", "\n" or "").
function splitLines(text) {
  const lines = [];
  let start = 0;
  while (start < text.length) {
    const nl = text.indexOf('\n', start);
    if (nl === -1) {
      lines.push({ body: text.slice(start), eol: '' });
      break;
    }
    let body = text.slice(start, nl);
    let eol = '\n';
    if (body.endsWith('\r')) {
      body = body.slice(0, -1);
      eol = '\r\n';
    }
    lines.push({ body, eol });
    start = nl + 1;
  }
  return lines;
}

function parseLine(body, eol, index) {
  const base = { index, lineNumber: index + 1, raw: body, eol };

  const bind = body.match(BIND_RE);
  if (bind) {
    const command = bind[6];
    const held = bind[2].includes('_held');
    const flag = bind[8] ?? null;
    return {
      ...base,
      type: 'bind',
      id: bindId(held, bind[4], flag),
      prefix: bind[2],
      held,
      key: bind[4],
      // The command is ONE opaque string, e.g. "+jump;+dodge".
      // `chain` is only a display helper; it is never written back.
      command,
      chain: splitChain(command),
      flag,
      // Everything around the command, so we can swap ONLY the command later.
      before: bind[1] + bind[2] + bind[3] + '"' + bind[4] + '"' + bind[5] + '"',
      after: '"' + (bind[7] ?? '') + (bind[8] ?? '') + bind[9],
    };
  }

  const cvar = body.match(CVAR_RE);
  if (cvar) {
    return {
      ...base,
      type: 'cvar',
      name: cvar[2],
      value: cvar[4],
      // Everything around the value, so we can swap ONLY the value later.
      before: cvar[1] + cvar[2] + cvar[3] + '"',
      after: '"' + cvar[5],
    };
  }

  if (body.trim() === '') return { ...base, type: 'blank' };
  return { ...base, type: 'unknown' };
}

function parse(text) {
  return splitLines(text).map((l, i) => parseLine(l.body, l.eol, i));
}

function serialize(lines) {
  return lines.map((l) => l.raw + l.eol).join('');
}

function checkValue(key, value) {
  if (value.includes('"') || /[\r\n]/.test(value)) {
    throw new Error(`Invalid value for ${key}: quotes and line breaks are not allowed`);
  }
}

// changes = { cvarName: newValue, "bind:tap:SPACE:1": newCommand }.
// Returns new lines + a diff; never mutates the input.
// A bind change whose key isn't in the file yet is ADDED after the last bind line.
function applyChanges(lines, changes) {
  const diff = [];
  const seen = new Set();
  let next = lines.map((line) => {
    const key = line.type === 'cvar' ? line.name : line.type === 'bind' ? line.id : null;
    if (key === null || !(key in changes)) return line;
    seen.add(key);
    const newValue = String(changes[key]);
    checkValue(key, newValue);
    const oldValue = line.type === 'cvar' ? line.value : line.command;
    if (newValue === oldValue) return line;
    const raw = line.before + newValue + line.after;
    diff.push({ lineNumber: line.lineNumber, name: key, oldValue, newValue, oldRaw: line.raw, newRaw: raw });
    return line.type === 'cvar'
      ? { ...line, value: newValue, raw }
      : { ...line, command: newValue, chain: splitChain(newValue), raw };
  });

  const missingBinds = Object.keys(changes).filter((k) => k.startsWith('bind:') && !seen.has(k));
  if (missingBinds.length) {
    const lastBind = next.reduce((idx, l, i) => (l.type === 'bind' ? i : idx), -1);
    const template = next[lastBind] || { eol: '\r\n', prefix: 'bind_US_standard' };
    const tapPrefix = (next.find((l) => l.type === 'bind' && !l.held) || {}).prefix || 'bind_US_standard';
    const added = missingBinds.map((id) => {
      const [, kind, key, flag] = id.match(/^bind:(tap|hold):(.*):([^:]*)$/);
      const command = String(changes[id]);
      checkValue(id, command);
      const prefix = kind === 'hold' ? tapPrefix.replace('bind_', 'bind_held_') : tapPrefix;
      const body = `${prefix} "${key}" "${command}"${flag ? ` ${flag}` : ''}`;
      seen.add(id);
      return parseLine(body, template.eol || '\r\n', -1);
    });
    // Lines after the insertion point move down; renumber them (as copies, input stays untouched).
    const shift = added.length;
    for (const d of diff) if (d.lineNumber > lastBind + 1) d.lineNumber += shift;
    next = [...next.slice(0, lastBind + 1), ...added, ...next.slice(lastBind + 1)]
      .map((l, i) => (l.index === i ? l : { ...l, index: i, lineNumber: i + 1 }));
    for (const [j, l] of added.entries()) {
      diff.push({ lineNumber: lastBind + 2 + j, name: l.id, oldValue: null, newValue: l.command, oldRaw: null, newRaw: l.raw, added: true });
    }
  }

  const missing = Object.keys(changes).filter((k) => !seen.has(k));
  return { lines: next, diff, missing };
}

module.exports = { parse, serialize, applyChanges, splitLines, bindId };
