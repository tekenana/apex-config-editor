// Minimal Valve KeyValues ("VDF") text parser that remembers text positions, so we can
// change ONE value and leave every other byte of the file untouched.
// Used for Steam's localconfig.vdf and Apex's videoconfig.txt.

function parseVdf(text) {
  let i = 0;
  const skip = () => {
    for (;;) {
      // Apex ends videoconfig.txt with a NUL byte; treat it like whitespace (and keep it).
      while (i < text.length && /[\s\0]/.test(text[i])) i++;
      if (text.startsWith('//', i)) {
        while (i < text.length && text[i] !== '\n') i++;
      } else return;
    }
  };
  const readString = () => {
    const start = i;
    i++; // opening quote
    let value = '';
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\' && i + 1 < text.length) {
        value += text[i + 1];
        i += 2;
      } else value += text[i++];
    }
    i++; // closing quote
    return { value, start, end: i };
  };
  const readBlock = (open) => {
    const children = [];
    for (;;) {
      skip();
      if (i >= text.length) return { children, open, close: i };
      if (text[i] === '}') return { children, open, close: i++ };
      if (text[i] !== '"') throw new Error(`Unexpected character at ${i}`);
      const key = readString();
      skip();
      if (text[i] === '{') {
        const open2 = i++;
        children.push({ key: key.value, keyStart: key.start, ...readBlock(open2) });
      } else if (text[i] === '"') {
        const val = readString();
        children.push({ key: key.value, keyStart: key.start, value: val.value, valueStart: val.start, valueEnd: val.end });
      } else throw new Error(`Unexpected character at ${i}`);
    }
  };
  return readBlock(-1);
}

function child(node, key) {
  return node && node.children ? node.children.find((c) => c.key.toLowerCase() === key.toLowerCase()) : undefined;
}

function find(root, keys) {
  let node = root;
  for (const k of keys) {
    node = child(node, k);
    if (!node) return undefined;
  }
  return node;
}

const escapeVdf = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

function indentAt(text, pos) {
  const lineStart = text.lastIndexOf('\n', pos) + 1;
  return text.slice(lineStart, pos).match(/^[\t ]*/)[0];
}

// { key: value } of the plain string values inside the block at `blockPath`.
function readValues(text, blockPath) {
  const block = find(parseVdf(text), blockPath);
  const out = {};
  for (const c of (block && block.children) || []) if ('value' in c) out[c.key] = c.value;
  return out;
}

// Sets string values inside the block at `blockPath`: existing values are swapped in place,
// missing ones are added as a new line just before the block's closing brace.
function setValues(text, blockPath, values) {
  let out = text;
  for (const [key, value] of Object.entries(values)) {
    const block = find(parseVdf(out), blockPath);
    if (!block || !block.children) throw new Error(`Section "${blockPath.join(' > ')}" not found`);
    const existing = child(block, key);
    const quoted = `"${escapeVdf(value)}"`;
    if (existing && 'value' in existing) {
      out = out.slice(0, existing.valueStart) + quoted + out.slice(existing.valueEnd);
    } else {
      const nl = out.includes('\r\n') ? '\r\n' : '\n';
      const sample = block.children[0];
      const ind = sample ? indentAt(out, sample.keyStart) : `${indentAt(out, block.open)}\t`;
      const lineStart = out.lastIndexOf('\n', block.close) + 1; // insert before the line holding "}"
      out = `${out.slice(0, lineStart)}${ind}"${escapeVdf(key)}"\t\t${quoted}${nl}${out.slice(lineStart)}`;
    }
  }
  return out;
}

module.exports = { parseVdf, child, find, escapeVdf, indentAt, readValues, setValues };
