// Version B — Explorer: sidebar navigation, search, sliders, raw "all settings" editor, live diff panel.
const path = require('path');
const { startApp } = require('../../shared/create-window');

startApp({
  htmlPath: path.join(__dirname, 'index.html'),
  width: 1240,
  height: 800,
  title: 'Apex Config Editor — Explorer',
  backgroundColor: '#14161a',
});
