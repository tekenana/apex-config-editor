// Version D — Guided: Explorer's dark UI + guided save, undo/redo, backups & restore, grouped binds.
const path = require('path');
const { startApp } = require('../../shared/create-window');

startApp({
  htmlPath: path.join(__dirname, 'index.html'),
  width: 1260,
  height: 820,
  title: 'Apex Config Editor',
  backgroundColor: '#14161a',
});
