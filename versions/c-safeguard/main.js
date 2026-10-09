// Version C — Safeguard: safety-first workflow (status checks, full diff review, backup manager, live-file guard).
const path = require('path');
const { startApp } = require('../../shared/create-window');

startApp({
  htmlPath: path.join(__dirname, 'index.html'),
  width: 1180,
  height: 820,
  title: 'Apex Config Editor — Safeguard',
  backgroundColor: '#eef1f5',
});
