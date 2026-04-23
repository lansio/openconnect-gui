const { app } = require('electron');
const path = require('path');

console.log('[test-path] app.isPackaged:', app.isPackaged);
console.log('[test-path] __dirname:', __dirname);
console.log('[test-path] app.getAppPath():', app.getAppPath());

const distPagesPath = path.join(app.getAppPath(), 'dist', 'pages');
console.log('[test-path] distPagesPath:', distPagesPath);

const indexPath = path.join(distPagesPath, 'index.html');
console.log('[test-path] indexPath:', indexPath);

module.exports = { distPagesPath, indexPath };
