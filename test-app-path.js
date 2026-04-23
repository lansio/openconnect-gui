const { app, BrowserWindow } = require('electron');

app.whenReady().then(() => {
  console.log('[TEST] app.isPackaged:', app.isPackaged);
  console.log('[TEST] __dirname:', __dirname);
  console.log('[TEST] app.getAppPath():', app.getAppPath());
  console.log('[TEST] path.dirname(app.getAppPath()):', require('path').dirname(app.getAppPath()));
  console.log('[TEST] process.cwd():', process.cwd());
  
  // Create a window to show
  const win = new BrowserWindow({
    width: 400,
    height: 300
  });
  
  win.loadURL('http://localhost:5173/pages/splash.html');
});
