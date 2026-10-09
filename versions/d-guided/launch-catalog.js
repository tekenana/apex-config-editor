// Known Apex launch options (renderer-side). `tier` drives the label:
//   recommended = useful for most players, situational = only if you need it,
//   myth = popular online but outdated or no real effect (based on community testing).
// `arg` = fixed argument; `input` = user-editable argument.

const LAUNCH_TIERS = [
  ['recommended', 'Recommended', 'Useful for most players.'],
  ['situational', 'Situational', 'Only turn these on if you need them.'],
  ['myth', 'Not worth it', 'Popular in old guides, but they do nothing useful in Apex today, or can cause problems. Shown so you know what they are.'],
];

const LAUNCH_OPTIONS = [
  { id: 'novid', head: '-novid', tier: 'recommended', label: 'Skip intro video', help: 'Skips the EA / Respawn intro videos, so the game gets to the menu faster.' },
  { id: 'showpos', head: '+cl_showpos', arg: '1', tier: 'recommended', label: 'Show position & velocity', help: 'Shows your position, view angle and speed (velocity) in the corner of the screen. Great for practicing movement tech.' },
  { id: 'fpsmax', head: '+fps_max', input: { default: '144', label: 'FPS', pattern: /^\d{1,4}$/, slider: { min: 0, max: 400, zero: 'Unlimited' } }, tier: 'recommended', label: 'FPS cap', help: 'Limits your frame rate. 0 = unlimited. A cap a few FPS below your monitor’s refresh rate often feels smoother.' },
  { id: 'showfps', head: '+cl_showfps', arg: '1', tier: 'recommended', label: 'Show FPS counter', help: 'Shows an FPS counter in-game. Steam and GPU overlays can do this too.' },

  { id: 'fullscreen', head: '-fullscreen', tier: 'situational', label: 'Start in fullscreen', help: 'Forces fullscreen at launch. Use it if the game keeps opening in a window.' },
  { id: 'refresh', head: '-refresh', input: { default: '144', label: 'Hz', pattern: /^\d{2,3}$/ }, tier: 'situational', label: 'Force refresh rate', help: 'Forces your monitor’s refresh rate in fullscreen. Only needed if the game picks the wrong one.' },
  { id: 'dx12', head: '-eac_launcher_settings', arg: 'SettingsDX12.json', tier: 'situational', label: 'DirectX 12 mode', help: 'Starts Apex with DirectX 12 instead of 11. It can help or hurt performance depending on your PC, so test both.' },

  { id: 'high', head: '-high', tier: 'myth', label: 'High CPU priority', help: 'Meant to give Apex more CPU time. Little to no gain, and it can make Discord or streaming stutter.' },
  { id: 'dev', head: '-dev', tier: 'myth', label: 'Developer mode (old intro skip)', help: 'The old way to skip the intro. Use “Skip intro video” instead.' },
  { id: 'preload', head: '-preload', tier: 'myth', label: 'Preload', help: 'A leftover from older Source games. Widely reported to do nothing in Apex.' },
  { id: 'rawinput', head: '+m_rawinput', arg: '1', tier: 'myth', label: 'Raw mouse input', help: 'Apex already uses raw mouse input by default, so this changes nothing.' },
  { id: 'queue', head: '+mat_queue_mode', arg: '2', tier: 'myth', label: 'Multicore rendering', help: 'An old Source engine tweak. Apex handles this itself.' },
  { id: 'threads', head: '-threads', input: { default: '8', label: 'threads', pattern: /^\d{1,2}$/ }, tier: 'myth', label: 'Force CPU threads', help: 'The game picks thread counts itself. Forcing a number can cause stutter or crashes.' },
  { id: 'novsync', head: '-forcenovsync', tier: 'myth', label: 'Force V-Sync off', help: 'Outdated. Turn V-Sync off in the in-game video settings instead.' },
];

// Where to paste the line by hand: Steam, with the EA app's equivalent in brackets.
const PASTE_STEPS = [
  'Open your Steam Library (or your Library in the EA app).',
  'Right-click Apex Legends → Properties (EA app: click ⋯ → View properties).',
  'Paste it into Launch Options (EA app: Advanced launch options) and close or save.',
];

// "-novid +fps_max 144 +foo bar" -> [{ head: '-novid', args: [] }, { head: '+fps_max', args: ['144'] }, ...]
function splitLaunchLine(line) {
  const items = [];
  for (const tok of line.trim().split(/\s+/).filter(Boolean)) {
    if (/^[-+][^\d]/.test(tok) || !items.length) items.push({ head: tok, args: [] });
    else items[items.length - 1].args.push(tok);
  }
  return items;
}

function launchItemText(opt, value) {
  const arg = opt.input ? value : opt.arg;
  return arg ? `${opt.head} ${arg}` : opt.head;
}

// Recognized options become toggles; anything else is kept verbatim in `extra`.
function importLaunchLine(line) {
  const on = {};
  const extra = [];
  for (const item of splitLaunchLine(line)) {
    const opt = LAUNCH_OPTIONS.find((o) => o.head.toLowerCase() === item.head.toLowerCase());
    const argText = item.args.join(' ');
    if (opt && opt.input && item.args.length === 1 && opt.input.pattern.test(argText)) on[opt.id] = argText;
    else if (opt && !opt.input && (opt.arg || '') === argText) on[opt.id] = true;
    else extra.push([item.head, ...item.args].join(' '));
  }
  return { on, extra: extra.join(' ') };
}
