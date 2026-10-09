// Small Windows helpers shared by the main-process services.
const { execFile } = require('child_process');

// Reads one registry value, e.g. regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath').
function regQuery(key, name) {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', name], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      const escaped = name.replace(/[{}]/g, '\\$&');
      const m = stdout.match(new RegExp(`${escaped}\\s+REG_\\w+\\s+(.+)`));
      resolve(m ? m[1].trim() : null);
    });
  });
}

// "%USERPROFILE%\\Saved Games" -> "C:\\Users\\me\\Saved Games"
function expandEnv(p) {
  return p.replace(/%([^%]+)%/g, (whole, name) => process.env[name] ?? whole);
}

module.exports = { regQuery, expandEnv };
