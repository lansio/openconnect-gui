const { BrowserWindow } = require('electron');
const path = require('path');
const { app } = require('electron');

// Determine if running in development mode (exported from here for use in main.js)
const isDev = !app.isPackaged;

let mainWindow;
let splashWindow;
let installerWindow;
let preinstallWindow;

// Helper to get path to pages directory
function getPagesPath() {
  // In production: app.asar is at /path/to/OpenConnect VPN.app/Contents/Resources/app.asar
  // In dev: __dirname points to src/modules (from where require is called)

  let baseDir;
  if (app.isPackaged) {
    // In packaged app, files are inside app.asar
    // app.getAppPath() returns /path/to/OpenConnect VPN.app/Contents/Resources/app.asar
    // We need to add dist/pages to it
    baseDir = app.getAppPath();
  } else {
    // In dev, __dirname is src/modules, so go up two levels to project root
    baseDir = path.join(__dirname, '..', '..');
  }
  return path.join(baseDir, 'dist', 'pages');
}

// Helper to get preload path
function getPreloadPath() {
  let baseDir;
  if (app.isPackaged) {
    // In packaged app, preload.js is inside app.asar
    baseDir = app.getAppPath();
  } else {
    // In dev, __dirname is src/modules, so go up two levels to project root
    baseDir = path.join(__dirname, '..', '..');
  }
  return path.join(baseDir, 'preload.js');
}

// Create splash window
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 600,
    height: 700,
    frame: false,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });

  // Load the splash screen - in dev mode, load from vite server; in production, load from dist
  if (isDev) {
    splashWindow.loadURL('http://localhost:5173/pages/splash.html');
  } else {
    const pagesPath = getPagesPath();
    const splashHtmlPath = path.join(pagesPath, 'splash.html');
    console.log('[windowManager] Loading splash from:', splashHtmlPath);
    // Use file:// protocol for asar archives
    const url = `file://${splashHtmlPath}`;
    console.log('[windowManager] Loading splash URL:', url);
    splashWindow.loadURL(url);
  }

  splashWindow.center();

  // Handle splash window events
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

// Create main window
function createMainWindow() {
  const preloadPath = getPreloadPath();

  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false, // Don't show immediately
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 10, y: 10 },
  });

  // Load the app - in dev mode, load from vite server; in production, load from dist
  if (isDev) {
    // Development mode - load from Vite dev server
    window.loadURL('http://localhost:5173/pages/index.html');
  } else {
    // Production mode - load from built files
    const pagesPath = getPagesPath();
    const indexHtmlPath = path.join(pagesPath, 'index.html');
    console.log('[windowManager] Loading main from:', indexHtmlPath);
    // Use file:// protocol for asar archives
    const url = `file://${indexHtmlPath}`;
    console.log('[windowManager] Loading main URL:', url);
    window.loadURL(url);
  }

  // Prevent window close, minimize to tray instead (unless quitting)
  window.on('close', (event) => {
    // Check if user is quitting the app
    const isQuitting = global.isQuitting || process.argv.includes('--quit');
    
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });

  // Show the window when ready - but only if user explicitly requested it
  window.once('ready-to-show', () => {
    console.log('[windowManager] Window ready to show, NOT showing automatically (user must click tray icon)');
    // Do not show window automatically - user should click tray to show
  });

  return window;
}

// Create installer helper window
function createInstallerWindow() {
  if (installerWindow) {
    installerWindow.focus();
    return;
  }

  installerWindow = new BrowserWindow({
    width: 700,
    height: 650,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 10, y: 10 },
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true
  });

  // Load the installer helper - in dev mode, load from vite server; in production, load from dist
  if (isDev) {
    installerWindow.loadURL('http://localhost:5173/pages/installer-helper.html');
  } else {
    const pagesPath = getPagesPath();
    const installerHtmlPath = path.join(pagesPath, 'installer-helper.html');
    console.log('[windowManager] Loading installer from:', installerHtmlPath);
    // Use file:// protocol for asar archives
    const url = `file://${installerHtmlPath}`;
    console.log('[windowManager] Loading installer URL:', url);
    installerWindow.loadURL(url);
  }

  installerWindow.on('closed', () => {
    installerWindow = null;
  });
}

// Create preinstall window (system checks/setup)
function createPreinstallWindow() {
  if (preinstallWindow) {
    preinstallWindow.focus();
    return;
  }

  const preloadPath = getPreloadPath();

  preinstallWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 10, y: 10 },
    minimizable: false,
    maximizable: false,
  });

  // Load the preinstall page - in dev mode, load from vite server; in production, load from dist
  if (isDev) {
    preinstallWindow.loadURL('http://localhost:5173/pages/preinstall.html');
  } else {
    const pagesPath = getPagesPath();
    const preinstallHtmlPath = path.join(pagesPath, 'preinstall.html');
    console.log('[windowManager] Loading preinstall from:', preinstallHtmlPath);
    // Use file:// protocol for asar archives
    const url = `file://${preinstallHtmlPath}`;
    console.log('[windowManager] Loading preinstall URL:', url);
    preinstallWindow.loadURL(url);
  }

  preinstallWindow.on('closed', () => {
    preinstallWindow = null;
  });
}

// Window management functions
function getMainWindow() {
  return mainWindow;
}

function getSplashWindow() {
  return splashWindow;
}

function getInstallerWindow() {
  return installerWindow;
}

function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
  }
}

function closeAllWindows() {
  if (splashWindow) {
    splashWindow.close();
    splashWindow = null;
  }
  if (mainWindow) {
    mainWindow.close();
    mainWindow = null;
  }
  if (installerWindow) {
    installerWindow.close();
    installerWindow = null;
  }
}

function getPreinstallWindow() {
  return preinstallWindow;
}

module.exports = {
  createSplashWindow,
  createMainWindow,
  createInstallerWindow,
  createPreinstallWindow,
  getMainWindow,
  getSplashWindow,
  getInstallerWindow,
  getPreinstallWindow,
  showMainWindow,
  closeAllWindows,
  isDev
};
