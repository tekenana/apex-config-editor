// Graphics settings stored in videoconfig.txt (renderer-side catalog).
// `verified: false` = value meanings come from community guides, not confirmed by Respawn.

const VIDEO_SETTINGS = [
  // Performance
  { key: 'setting.mat_vsync_mode', section: 'performance', label: 'V-Sync', help: 'Off gives the lowest input lag. Most competitive players keep it off.', options: [['0', 'Off'], ['1', 'Double buffered'], ['2', 'Triple buffered'], ['3', 'Adaptive']], verified: false },
  { key: 'setting.dvs_enable', section: 'performance', label: 'Adaptive resolution', help: 'Lowers your resolution on the fly to hold your FPS. It can make the game blurry in fights; most competitive players turn it off.', options: [['0', 'Off'], ['1', 'On']], verified: true },
  { key: 'setting.mat_antialias_mode', section: 'performance', label: 'Anti-aliasing', help: 'TSAA smooths jagged edges but adds slight blur. Off is sharper, with more jagged edges.', options: [['0', 'Off'], ['12', 'TSAA']], verified: true },

  // Quality
  { key: 'setting.stream_memory', section: 'quality', label: 'Texture streaming budget', help: 'How much video memory textures may use. Match it to your GPU’s VRAM; too high causes stutter.', options: [['0', 'None'], ['160000', 'Very low (2 GB)'], ['300000', 'Low (2-3 GB)'], ['600000', 'Medium (3 GB)'], ['1000000', 'High (4 GB)'], ['2000000', 'Very high (6 GB)'], ['3000000', 'Insane (8 GB)']], verified: false },
  { key: 'setting.mat_forceaniso', section: 'quality', label: 'Texture filtering', help: 'Keeps textures sharp at an angle. Cheap on modern GPUs.', options: [['1', 'Bilinear'], ['2', 'Anisotropic 2x'], ['4', 'Anisotropic 4x'], ['8', 'Anisotropic 8x'], ['16', 'Anisotropic 16x']], verified: false },
  { key: 'setting.ssao_quality', section: 'quality', label: 'Ambient occlusion', help: 'Soft shadows in corners. Looks nice, costs FPS.', options: [['0', 'Off'], ['1', 'Low'], ['2', 'Medium'], ['3', 'High'], ['4', 'Very high']], verified: false },
  { key: 'setting.csm_coverage', section: 'quality', label: 'Sun shadow coverage', help: 'How far sun shadows are drawn.', options: [['1', 'Low'], ['2', 'High']], verified: false },
  { key: 'setting.csm_cascade_res', section: 'quality', label: 'Sun shadow detail', help: 'Sharpness of sun shadows.', options: [['512', 'Low'], ['1024', 'High']], verified: false },
  { key: 'setting.shadow_enable', section: 'quality', label: 'Spot shadows', help: 'Shadows from lamps and other light sources.', options: [['0', 'Off'], ['1', 'On']], verified: true },
  { key: 'setting.volumetric_lighting', section: 'quality', label: 'Volumetric lighting', help: 'Light beams and haze. Pretty, but can make enemies harder to see.', options: [['0', 'Off'], ['1', 'On']], verified: true },
  { key: 'setting.r_lod_switch_scale', section: 'quality', label: 'Model detail', help: 'How detailed objects look at a distance.', options: [['0.2', 'Lowest'], ['0.6', 'Low'], ['0.8', 'Medium'], ['1', 'High']], verified: false },
  { key: 'setting.particle_cpu_level', section: 'quality', label: 'Effects detail', help: 'Smoke, sparks and explosions. Lower helps FPS in big fights.', options: [['0', 'Low'], ['1', 'Medium'], ['2', 'High']], verified: false },
  { key: 'setting.cl_ragdoll_maxcount', section: 'quality', label: 'Ragdolls', help: 'How many knocked-down bodies get physics at once.', options: [['0', 'Low'], ['4', 'Medium'], ['8', 'High']], verified: false },
];

// Display mode is two values in the file.
const DISPLAY_MODES = [
  ['fullscreen', 'Full screen', { 'setting.fullscreen': '1', 'setting.nowindowborder': '1' }, 'Best input lag and the only mode where stretched resolution works.'],
  ['borderless', 'Borderless window', { 'setting.fullscreen': '0', 'setting.nowindowborder': '1' }, 'Alt-tab is instant, but it can add a little input lag.'],
  ['windowed', 'Windowed', { 'setting.fullscreen': '0', 'setting.nowindowborder': '0' }, 'A normal window with a border.'],
];

// Settings the Performance mode card changes that Apex's own video menu doesn't show:
// they only exist in videoconfig.txt.
const CFG_ONLY = new Set([
  'setting.mat_backbuffer_count', 'setting.csm_enabled', 'setting.shadow_depth_dimen_min', 'setting.shadow_depth_upres_factor_max',
  'setting.volumetric_fog', 'setting.map_detail_level', 'setting.cl_particle_fallback_base', 'setting.cl_particle_fallback_multiplier',
  'setting.cl_gib_allow', 'setting.cl_ragdoll_self_collision', 'setting.r_createmodeldecals', 'setting.mat_mip_linear',
]);

// What each config-file-only setting does (shown under its name in Performance mode).
const CFG_ONLY_HELP = {
  'setting.mat_backbuffer_count': 'Frames queued before they reach the screen. 0 can cut input lag a little.',
  'setting.csm_enabled': 'Master switch for sun shadows. Off is the single biggest FPS gain.',
  'setting.shadow_depth_dimen_min': 'Smallest size of shadow maps. 0 = least GPU work for shadows.',
  'setting.shadow_depth_upres_factor_max': 'How much shadows are sharpened up close. 0 = not at all.',
  'setting.volumetric_fog': 'Fog that light shines through. Off = a clearer view across the map.',
  'setting.map_detail_level': 'Small map clutter like debris and props. Lower = fewer objects to draw.',
  'setting.cl_particle_fallback_base': 'When effects switch to their cheap version. Very high = always cheap, steadier FPS in fights.',
  'setting.cl_particle_fallback_multiplier': 'Scales the line above. Very high keeps effects on the cheap version.',
  'setting.cl_gib_allow': 'Body chunks from explosive knocks. Off = less clutter on screen.',
  'setting.cl_ragdoll_self_collision': 'Physics between a ragdoll’s own limbs. Off = cheaper ragdolls.',
  'setting.r_createmodeldecals': 'Blood and bullet marks on characters. Off = less to draw.',
  'setting.mat_mip_linear': 'Smooth blending between texture detail levels. Off is a bit faster; distant textures can look slightly rougher.',
};

// Performance mode: the competitive setup (full screen, max FPS, clear visibility) plus every
// other FPS cost off, from the community's max-FPS videoconfigs. Textures are left alone:
// they cost video memory, not visibility (and mat_picmip only makes them blurry).
const PERFORMANCE_PRESET = {
  'setting.fullscreen': '1',
  'setting.nowindowborder': '1',
  'setting.mat_vsync_mode': '0',
  'setting.dvs_enable': '0',
  'setting.mat_antialias_mode': '0',
  'setting.mat_backbuffer_count': '0',
  'setting.ssao_quality': '0',
  'setting.csm_enabled': '0',
  'setting.csm_coverage': '1',
  'setting.csm_cascade_res': '512',
  'setting.shadow_enable': '0',
  'setting.shadow_maxdynamic': '0',
  'setting.shadow_depth_dimen_min': '0',
  'setting.shadow_depth_upres_factor_max': '0',
  'setting.volumetric_lighting': '0',
  'setting.volumetric_fog': '0',
  'setting.r_lod_switch_scale': '0.2',
  'setting.map_detail_level': '1',
  'setting.particle_cpu_level': '0',
  'setting.cl_particle_fallback_base': '999999',
  'setting.cl_particle_fallback_multiplier': '999999',
  'setting.cl_gib_allow': '0',
  'setting.cl_ragdoll_maxcount': '0',
  'setting.cl_ragdoll_self_collision': '0',
  'setting.r_decals': '0',
  'setting.r_createmodeldecals': '0',
  'setting.mat_mip_linear': '0',
};

// Quality presets: [id, button label, values, description]. Texture budget is left out on purpose.
const QUALITY_PRESETS = [
  ['low', 'Performance', {
    'setting.mat_forceaniso': '2', 'setting.ssao_quality': '0', 'setting.csm_coverage': '1', 'setting.csm_cascade_res': '512',
    'setting.shadow_enable': '0', 'setting.volumetric_lighting': '0', 'setting.r_lod_switch_scale': '0.6', 'setting.particle_cpu_level': '0', 'setting.cl_ragdoll_maxcount': '0',
  }, 'Max FPS and the clearest view: shadows and haze off, lowest detail.'],
  ['medium', 'Medium', {
    'setting.mat_forceaniso': '8', 'setting.ssao_quality': '2', 'setting.csm_coverage': '1', 'setting.csm_cascade_res': '1024',
    'setting.shadow_enable': '1', 'setting.volumetric_lighting': '0', 'setting.r_lod_switch_scale': '0.8', 'setting.particle_cpu_level': '1', 'setting.cl_ragdoll_maxcount': '4',
  }, 'Balanced: medium shadows, no haze to hide enemies.'],
  ['high', 'High', {
    'setting.mat_forceaniso': '16', 'setting.ssao_quality': '3', 'setting.csm_coverage': '2', 'setting.csm_cascade_res': '1024',
    'setting.shadow_enable': '1', 'setting.volumetric_lighting': '1', 'setting.r_lod_switch_scale': '1', 'setting.particle_cpu_level': '2', 'setting.cl_ragdoll_maxcount': '8',
  }, 'Best looks, most FPS cost. Haze can hide enemies.'],
];

// Aspect ratios for "stretched": width = native height × ratio.
const STRETCH_PRESETS = [
  ['native', 'Native', null],
  ['16:10', '16:10 (slight stretch)', 16 / 10],
  ['4:3', '4:3 (classic stretched)', 4 / 3],
  ['5:4', '5:4 (most stretched)', 5 / 4],
];

const SCALING_GUIDES = [
  ['nvidia', 'NVIDIA', [
    'Right-click the desktop → NVIDIA Control Panel.',
    'Display → Change resolution → Customize → Create Custom Resolution. Enter the width × height above with your normal refresh rate → Test → Yes → OK.',
    'Display → Adjust desktop size and position: Scaling = Full-screen, Perform scaling on = GPU, tick “Override the scaling mode set by games and programs” → Apply.',
  ]],
  ['amd', 'AMD', [
    'Open AMD Software (Adrenalin) → Settings (gear) → Display.',
    'Turn GPU Scaling ON and set Scaling Mode to Full panel.',
    'Under Custom Resolutions, create the width × height above with your normal refresh rate and save it.',
  ]],
];
