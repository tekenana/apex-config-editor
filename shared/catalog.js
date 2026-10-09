// The curated settings the app offers as named controls.
// Everything NOT listed here is still preserved untouched on save.
// `verified: false` = the label is our best guess at what the cvar does.

module.exports = [
  // Graphics / performance
  { name: 'gfx_amdUseLowLatency', section: 'graphics', type: 'toggle', label: 'AMD low-latency mode', help: 'Reduces input lag on AMD GPUs.', verified: false },
  { name: 'gfx_nvnUseLowLatency', section: 'graphics', type: 'toggle', label: 'NVIDIA low-latency mode', help: 'NVIDIA’s low-latency mode (Reflex): less input lag on NVIDIA GPUs.', verified: false },
  { name: 'gfx_nvnUseLowLatencyBoost', section: 'graphics', type: 'toggle', label: 'NVIDIA low-latency boost', help: 'Reflex boost: a little less lag again, but the GPU uses more power.', verified: false },
  { name: 'chroma_enable', section: 'graphics', type: 'toggle', label: 'Razer Chroma lighting', help: 'RGB lighting effects on Razer devices.', verified: true },

  // Mouse (shown in Mouse & keyboard, above the binds)
  // cl_fovScale = in-game FOV / 70 (110 = 1.571429). Above 110 is only possible in the file and is
  // reported as a ban risk, so the app stops at the menu's 110.
  { name: 'profile:cl_fovScale', section: 'graphics', type: 'number', fov: true, min: 70, max: 110, step: 1, label: 'Field of view', help: 'How wide you see. Higher shows more around you (110 is the most Apex allows); lower zooms in a little. Most competitive players use 104–110.', verified: true },
  { name: 'mouse_sensitivity', section: 'mouse', type: 'number', min: 0.1, max: 10, step: 0.1, label: 'Mouse sensitivity', help: 'Base hip-fire sensitivity.', verified: true },
  { name: 'mouse_zoomed_sensitivity_scalar_0', section: 'mouse', type: 'number', ads: true, min: 0.2, max: 5, step: 0.05, label: 'ADS multiplier', help: 'Sensitivity while aiming down sights, compared to your normal sensitivity.', verified: true },
  { name: 'm_acceleration', section: 'mouse', type: 'toggle', label: 'Mouse acceleration', help: 'Fast swipes move further than slow ones, which breaks muscle memory.', warn: 'Keep it off.', verified: true },

  // Audio / voice — shown top to bottom in this order.
  // `percent: true` = shown as 0–100% in the app, stored as 0–1 in the file.
  // Prefixes: "video:" = stored in local/videoconfig.txt, "profile:" = stored in profile/profile.cfg.
  { name: 'video:setting.sound_volume', section: 'audio', type: 'number', min: 0, max: 1, step: 0.05, percent: true, label: 'Master volume', help: 'Overall game volume. 100% = full volume.', verified: true },
  // miles_mix: 1 = "Focused" (confirmed in-game), 0 = "Original".
  { name: 'profile:miles_mix', section: 'audio', type: 'toggle', label: 'Improved audio mix', help: 'On = Apex’s “Focused” mix, the default since Season 27: your own weapons and abilities are quieter, squadmate footsteps are removed, and enemy footsteps are louder and more consistent. Off = the “Original” mix.', verified: true },
  { name: 'profile:sound_volume_sfx', section: 'audio', type: 'number', min: 0, max: 1, step: 0.05, percent: true, label: 'Sound effects volume', help: 'Guns, footsteps, abilities and the world around you.', verified: true },
  { name: 'profile:sound_volume_dialogue', section: 'audio', type: 'number', min: 0, max: 1, step: 0.05, percent: true, label: 'Dialogue volume', help: 'Legend voice lines and announcer.', verified: true },
  { name: 'profile:sound_volume_music_game', section: 'audio', type: 'number', min: 0, max: 1, step: 0.05, percent: true, label: 'Music volume (in match)', help: 'Music during a match, like the drop and the final circles.', verified: true },
  { name: 'profile:sound_volume_music_lobby', section: 'audio', type: 'number', min: 0, max: 1, step: 0.05, percent: true, label: 'Lobby music volume', help: 'Music in the menus and lobby.', verified: true },
  { name: 'sv_voiceenable', section: 'audio', type: 'toggle', label: 'Voice chat', help: 'Enables voice chat entirely.', verified: true },
  { name: 'sound_volume_voice', section: 'audio', type: 'number', min: 0, max: 1, step: 0.05, percent: true, label: 'Incoming voice chat volume', help: 'How loud your teammates are. 100% = full volume.', verified: false },
  { name: 'voice_vox', section: 'audio', type: 'toggle', label: 'Open mic (voice activation)', help: 'Transmits whenever you speak, no push-to-talk.', verified: true },
  // Source-engine "voice_mixer_*" cvars control your microphone's mixer, not what you hear.
  { name: 'voice_mixer_volume', section: 'audio', type: 'number', min: 0, max: 1, step: 0.05, percent: true, label: 'Microphone level', help: 'Your mic input level (how loud you are to others).', verified: false },
  { name: 'voice_mixer_mute', section: 'audio', type: 'toggle', label: 'Mute microphone mixer', help: 'Mutes your mic input. Not the same as muting teammates.', verified: false },

  // Controller: Apex's Advanced Look Controls (ALC), all in profile.cfg.
  // `group` = which block of the Controller tab the card sits in. Deadzones and ramp-up
  // times are stored as 0–1 and shown as % (outer 0.02 = the 2% Apex shows).
  { name: 'profile:gamepad_custom_enabled', section: 'controller', group: 'alc', type: 'toggle', menu: { 0: 'Off', 1: 'On' }, label: 'Advanced Look Controls (ALC)', help: 'Apex’s “Custom Look Controls”. Every setting below only does something while this is on.', verified: true },
  { name: 'profile:gamepad_custom_deadzone_in', section: 'controller', group: 'alc', type: 'number', min: 0, max: 0.3, step: 0.01, percent: true, label: 'Deadzone', help: 'How far the right stick must move before the camera turns. 0% = the smallest touch moves your aim. Raise it 1% at a time if your crosshair drifts on its own.', verified: false },
  { name: 'profile:gamepad_custom_deadzone_out', section: 'controller', group: 'alc', type: 'number', min: 0, max: 0.3, step: 0.01, percent: true, label: 'Outer threshold', help: 'How close to the edge the stick counts as fully pushed. Higher = full turn speed sooner.', verified: false },
  { name: 'profile:gamepad_custom_curve', section: 'controller', group: 'alc', type: 'number', min: 0, max: 30, step: 1, label: 'Response curve', help: '0 = linear: stick position maps straight to turn speed. Higher = slower near the centre for fine aim, faster at the edge.', verified: false },
  { name: 'profile:gamepad_custom_hip_yaw', section: 'controller', group: 'hip', type: 'number', min: 0, max: 500, step: 1, label: 'Yaw speed', help: 'Left/right turn speed when not aiming down sights (degrees per second).', verified: false },
  { name: 'profile:gamepad_custom_hip_pitch', section: 'controller', group: 'hip', type: 'number', min: 0, max: 500, step: 1, label: 'Pitch speed', help: 'Up/down turn speed when not aiming down sights.', verified: false },
  { name: 'profile:gamepad_custom_hip_turn_yaw', section: 'controller', group: 'hip', type: 'number', min: 0, max: 500, step: 1, label: 'Turning extra yaw', help: 'Extra left/right speed added when the stick is pushed all the way.', verified: false },
  { name: 'profile:gamepad_custom_hip_turn_pitch', section: 'controller', group: 'hip', type: 'number', min: 0, max: 500, step: 1, label: 'Turning extra pitch', help: 'Extra up/down speed added when the stick is pushed all the way.', verified: false },
  { name: 'profile:gamepad_custom_hip_turn_time', section: 'controller', group: 'hip', type: 'number', min: 0, max: 1, step: 0.01, percent: true, label: 'Turning ramp-up time', help: 'How long the extra speed takes to fully kick in. 0% = instantly.', verified: false },
  { name: 'profile:gamepad_custom_hip_turn_delay', section: 'controller', group: 'hip', type: 'number', min: 0, max: 1, step: 0.01, percent: true, label: 'Turning ramp-up delay', help: 'Wait before the extra speed starts. 0% = no wait.', verified: false },
  { name: 'profile:gamepad_custom_ads_yaw', section: 'controller', group: 'ads', type: 'number', min: 0, max: 500, step: 1, label: 'ADS yaw speed', help: 'Left/right turn speed while aiming down sights.', verified: false },
  { name: 'profile:gamepad_custom_ads_pitch', section: 'controller', group: 'ads', type: 'number', min: 0, max: 500, step: 1, label: 'ADS pitch speed', help: 'Up/down turn speed while aiming down sights. Lower helps control vertical recoil.', verified: false },
  { name: 'profile:gamepad_custom_ads_turn_yaw', section: 'controller', group: 'ads', type: 'number', min: 0, max: 500, step: 1, label: 'ADS turning extra yaw', help: 'Extra left/right speed while aiming, stick fully pushed.', verified: false },
  { name: 'profile:gamepad_custom_ads_turn_pitch', section: 'controller', group: 'ads', type: 'number', min: 0, max: 500, step: 1, label: 'ADS turning extra pitch', help: 'Extra up/down speed while aiming, stick fully pushed.', verified: false },
  { name: 'profile:gamepad_custom_ads_turn_time', section: 'controller', group: 'ads', type: 'number', min: 0, max: 1, step: 0.01, percent: true, label: 'ADS turning ramp-up time', help: 'How long the extra ADS speed takes to kick in.', verified: false },
  { name: 'profile:gamepad_custom_ads_turn_delay', section: 'controller', group: 'ads', type: 'number', min: 0, max: 1, step: 0.01, percent: true, label: 'ADS turning ramp-up delay', help: 'Wait before the extra ADS speed starts.', verified: false },
  // Apex's normal look settings (used while ALC is off). `menu` = what each stored number shows
  // in game. Confirmed in game (Oct 2026): sensitivities count from 0, so menu 4 (High) = "3";
  // Linear = 4; Look Deadzone None = 0; Movement Deadzone Small = 1. Other numbers unconfirmed.
  { name: 'profile:gamepad_aim_speed', section: 'controller', group: 'standard', type: 'menu', menu: { 0: '1', 1: '2', 2: '3 (Default)', 3: '4 (High)', 4: '5', 5: '6', 6: '7' }, label: 'Look sensitivity', help: 'Turn speed while not aiming (ALC off).', verified: true },
  { name: 'profile:gamepad_aim_speed_ads_0', section: 'controller', group: 'standard', type: 'menu', menu: { '-1': 'Same as Look sensitivity', 0: '1', 1: '2', 2: '3 (Default)', 3: '4 (High)', 4: '5', 5: '6', 6: '7' }, label: 'Look sensitivity (ADS)', help: 'Turn speed while aiming (ALC off).', verified: true },
  { name: 'profile:gamepad_look_curve', section: 'controller', group: 'standard', type: 'menu', menu: { 4: 'Linear' }, label: 'Response curve', help: 'How stick distance turns into speed (ALC off).', verified: true },
  { name: 'profile:gamepad_deadzone_index_look', section: 'controller', group: 'standard', type: 'menu', menu: { 0: 'None' }, label: 'Look deadzone', help: 'Right stick dead spot (ALC off).', verified: true },
  { name: 'profile:gamepad_deadzone_index_move', section: 'controller', group: 'standard', type: 'menu', menu: { 1: 'Small' }, label: 'Movement deadzone', help: 'Left stick dead spot.', verified: true },
];
