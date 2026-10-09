// Version A — Essentials: exactly the locked v1 scope (view, toggle, preview, save).
const path = require('path');
const { startApp } = require('../../shared/create-window');

startApp({
  htmlPath: path.join(__dirname, 'index.html'),
  width: 900,
  height: 820,
  title: 'Apex Config Editor — Essentials',
  backgroundColor: '#f6f5f2',
});
