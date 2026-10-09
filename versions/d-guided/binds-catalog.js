// Friendly names + categories for bind commands (renderer-side, display only).
// Anything spectator / observer / console / developer goes to "Misc".

const BIND_ACTIONS = {
  // Movement
  '+forward': ['Move forward', 'Movement'],
  '+backward': ['Move back', 'Movement'],
  '+moveleft': ['Move left', 'Movement'],
  '+moveright': ['Move right', 'Movement'],
  '+jump': ['Jump', 'Movement'],
  '+dodge': ['Dodge', 'Movement'],
  '+duck': ['Crouch (hold)', 'Movement'],
  '+toggle_duck': ['Crouch (toggle)', 'Movement'],
  '+speed': ['Sprint', 'Movement'],
  '+strafe': ['Strafe', 'Movement'],

  // Combat
  '+attack': ['Fire', 'Combat'],
  '+zoom': ['Aim down sights', 'Combat'],
  '+reload': ['Reload', 'Combat'],
  '+melee': ['Melee', 'Combat'],
  '+weaponCycle': ['Switch weapon', 'Combat'],
  'weaponSelectPrimary0': ['Weapon 1', 'Combat'],
  'weaponSelectPrimary1': ['Weapon 2', 'Combat'],
  'weaponSelectPrimary2': ['Holster / fists', 'Combat'],
  'weaponSelectOrdnance': ['Grenade', 'Combat'],
  'weapon_inspect': ['Inspect weapon', 'Combat'],

  // Abilities & items
  '+offhand1': ['Tactical ability', 'Abilities & items'],
  '+offhand4': ['Ultimate ability', 'Abilities & items'],
  '+use': ['Interact / pick up', 'Abilities & items'],
  '+use_long': ['Interact (hold)', 'Abilities & items'],
  '+use_alt': ['Alternate interact', 'Abilities & items'],
  'use_consumable SHIELD_SMALL': ['Shield cell', 'Abilities & items'],
  'use_consumable HEALTH_SMALL': ['Syringe', 'Abilities & items'],
  'use_consumable SHIELD_LARGE': ['Shield battery', 'Abilities & items'],
  'use_consumable HEALTH_LARGE': ['Med kit', 'Abilities & items'],
  'use_consumable PHOENIX_KIT': ['Phoenix kit', 'Abilities & items'],
  // Apex's internal "scriptCommand" actions, named from the in-game Controls menu.
  '+scriptCommand4': ['Use selected healing item', 'Abilities & items'],
  '+scriptCommand2': ['Healing item wheel', 'Abilities & items'],
  '+scriptCommand5': ['Legend action', 'Abilities & items'],
  '+scriptCommand6': ['Survival item', 'Abilities & items'],
  '+scriptCommand3': ['Change fire mode', 'Combat'],

  // Communication
  '+ping': ['Ping', 'Communication'],
  'ping_specific_type ENEMY': ['Ping enemy', 'Communication'],
  '+pushtotalk': ['Push to talk', 'Communication'],
  'say_team': ['Team chat', 'Communication'],
  'chat_wheel': ['Chat wheel', 'Communication'],

  // Menus & interface
  'toggle_inventory': ['Inventory', 'Menus'],
  'toggle_map': ['Map', 'Menus'],
  'ingamemenu_activate': ['Game menu', 'Menus'],
};

const CORE_ORDER = ['Movement', 'Combat', 'Abilities & items', 'Communication', 'Menus', 'Other'];

const MISC_PATTERNS = [
  [/^in_spec_/i, 'Spectator'],
  [/^toggle_obs_/i, 'Observer'],
  [/^toggleconsole$/i, 'Console'],
  [/^miles_/i, 'Developer'],
  [/^screenshotDevNet/i, 'Developer'],
];

const CONTROLLER_KEYS = new Set([
  'A_BUTTON', 'B_BUTTON', 'X_BUTTON', 'Y_BUTTON', 'L_SHOULDER', 'R_SHOULDER', 'L_TRIGGER', 'R_TRIGGER',
  'BACK', 'START', 'STICK1', 'STICK2', 'UP', 'DOWN', 'LEFT', 'RIGHT',
]);

// Apex isn't consistent with capitals ("+scriptcommand3" vs "+scriptCommand3"), so look up both.
const BIND_ACTIONS_LC = Object.fromEntries(Object.entries(BIND_ACTIONS).map(([k, v]) => [k.toLowerCase(), v]));
const actionInfo = (part) => BIND_ACTIONS[part] || BIND_ACTIONS_LC[(part || '').toLowerCase()] || null;

function friendlyPart(part) {
  const info = actionInfo(part);
  return info ? info[0] : null;
}

// -> { group: 'core'|'controller'|'misc', category, label }
function classifyBind(bind) {
  if (CONTROLLER_KEYS.has(bind.key)) {
    return { group: 'controller', category: 'Controller', label: bind.command };
  }
  for (const [re, category] of MISC_PATTERNS) {
    if (bind.chain.some((c) => re.test(c))) return { group: 'misc', category, label: bind.command };
  }
  const names = bind.chain.map(friendlyPart);
  const first = actionInfo(bind.chain[0]);
  return {
    group: 'core',
    category: first ? first[1] : 'Other',
    label: names.every(Boolean) ? names.join(' + ') : null,
  };
}

// What each action does, in plain words (Mouse & keyboard tab → "What every bind means").
const BIND_HELP = {
  '+forward': 'Walk forward while held.',
  '+backward': 'Walk backward while held.',
  '+moveleft': 'Step left while held.',
  '+moveright': 'Step right while held.',
  '+jump': 'Jump. Also climbs ledges (mantle) and, if Mantle boost is set to Jump, can trigger it.',
  '+dodge': 'Your Movement Ability: Valkyrie’s jetpack, Ash’s dash, Sparrow’s double jump and similar. Legends without one ignore it.',
  '+duck': 'Crouch while held. Sliding = crouch while sprinting.',
  '+toggle_duck': 'Press once to crouch, again to stand.',
  '+speed': 'Sprint. With auto-sprint on, this mostly matters for stopping and starting.',
  '+strafe': 'Hold to walk and keep your aim steady (no sprint), for quiet movement.',
  '+attack': 'Fire your weapon or throw a grenade.',
  '+zoom': 'Aim down sights (ADS).',
  '+reload': 'Reload. Holding it on some setups also opens the interact menu.',
  '+melee': 'Punch or hit with your heirloom.',
  '+weaponCycle': 'Switch between your two weapons.',
  weaponSelectPrimary0: 'Pull out weapon 1.',
  weaponSelectPrimary1: 'Pull out weapon 2.',
  weaponSelectPrimary2: 'Holster your weapons and use your fists (faster running).',
  weaponSelectOrdnance: 'Equip a grenade. Press again to cycle grenade types.',
  weapon_inspect: 'Show off your weapon (cosmetic).',
  '+offhand1': 'Tactical ability (the short-cooldown one, usually Q).',
  '+offhand4': 'Ultimate ability (usually Z).',
  '+use': 'Interact: open doors, pick up loot, revive, open death boxes.',
  '+use_long': 'Interact by holding, for things that need a hold (like some doors and banners).',
  '+use_alt': 'Alternate interact: e.g. pick up an item without swapping, or the second option on a prompt.',
  'use_consumable SHIELD_SMALL': 'Use a shield cell (small shield heal).',
  'use_consumable HEALTH_SMALL': 'Use a syringe (small health heal).',
  'use_consumable SHIELD_LARGE': 'Use a shield battery (full shield).',
  'use_consumable HEALTH_LARGE': 'Use a med kit (full health).',
  'use_consumable PHOENIX_KIT': 'Use a Phoenix kit (full health and shield).',
  '+ping': 'Ping what you’re looking at. Double-tap on an enemy to mark it as an enemy.',
  'ping_specific_type ENEMY': 'Ping straight away as an enemy, no double-tap needed.',
  '+pushtotalk': 'Talk on voice chat while held.',
  say_team: 'Open the team text chat.',
  chat_wheel: 'Open the ping / quip wheel.',
  toggle_inventory: 'Open or close your inventory.',
  toggle_map: 'Open or close the full map.',
  ingamemenu_activate: 'Open the game menu (Esc).',
  '+scriptCommand4': 'Use the healing item picked in the wheel (tap). Same key held opens the wheel.',
  '+scriptCommand2': 'Hold to open the healing wheel and pick meds, batteries or cells.',
  '+scriptCommand5': 'A legend-specific action, e.g. Vantage recalling Echo.',
  '+scriptCommand6': 'Use your survival item, e.g. an Evac Tower.',
  '+scriptCommand3': 'Switch the weapon’s fire mode (single, burst, auto).',
};

// The ideas behind every row, shown above the per-action list.
const BIND_BASICS = [
  ['Tap vs hold', 'A “tap” bind runs when you press the key. A “hold” bind runs when you keep the key down a moment, so one key can do two things (e.g. tap G = grenade, hold G = strafe).'],
  ['Chains (;)', 'A semicolon runs several commands from one key at once: "+jump;+dodge" jumps and uses your Movement Ability together.'],
  ['The + sign', 'Commands starting with + are “while held”: the action starts when you press the key and stops when you let go (+forward walks only while held).'],
  ['Primary and alternate', 'Each action has two slots in Apex’s menu. The 0 or 1 at the end of a bind line is that slot; the app keeps it when you move a bind.'],
  ['scriptCommand and ability N', 'Apex-internal commands. The known ones are named above (e.g. +scriptCommand3 = change fire mode); others, like controller “+ability 3”, are shown as-is. Apex’s Controls menu shows what each one does.'],
];
