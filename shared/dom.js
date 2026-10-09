// Tiny DOM helpers shared by all three renderers (plain browser JS, no Node).
// Building nodes with textContent (never innerHTML) means values from the
// cfg file can't inject HTML into the page.

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (typeof value !== 'string' && key in node) node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

// replaceChildren, but skips null/false so conditional children don't print "null".
function setChildren(node, ...children) {
  node.replaceChildren(...children.flat().filter((c) => c != null && c !== false));
}

// Last occurrence wins, like the game reading the file top to bottom.
function findCvar(lines, name) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].type === 'cvar' && lines[i].name === name) return lines[i];
  }
  return null;
}

// Date and time without seconds, e.g. "Oct 5, 2026, 12:47 AM".
function fmtTime(ms) {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function errorText(err) {
  return String(err && err.message ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
