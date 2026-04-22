const { BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;
let splashWindow;
let installerWindow;

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
  const isDev = process.env.NODE_ENV === 'development' || !process.argv.includes('--production');

  if (isDev) {
    splashWindow.loadURL('http://localhost:5173/pages/splash.html');
  } else {
    splashWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'pages', 'splash.html'));
  }

  splashWindow.center();

  // Handle splash window events
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

// Create main window
function createMainWindow() {
  const isDev = process.env.NODE_ENV === 'development' || !process.argv.includes('--production');
  const preloadPath = isDev
    ? path.join(__dirname, '..', '..', 'preload.js')
    : path.join(__dirname, '..', '..', 'dist', 'preload.js');

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
    trafficLightPosition: { x: 10, y: 10 }
  });

  // Load the app - in dev mode, load from vite server; in production, load from dist
  if (isDev) {
    // Development mode - load from Vite dev server
    window.loadURL('http://localhost:5173/pages/index.html');
  } else {
    // Production mode - load from built files
    window.loadFile(path.join(__dirname, '..', '..', 'dist', 'pages', 'index.html'));
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

  // Show the window when ready
  window.once('ready-to-show', () => {
    console.log('[windowManager] Window ready to show, showing...');
    window.show();
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
  const isDev = process.env.NODE_ENV === 'development' || !process.argv.includes('--production');

  if (isDev) {
    installerWindow.loadURL('http://localhost:5173/pages/installer-helper.html');
  } else {
    installerWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'pages', 'installer-helper.html'));
  }

  installerWindow.on('closed', () => {
    installerWindow = null;
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

module.exports = {
  createSplashWindow,
  createMainWindow,
  createInstallerWindow,
  getMainWindow,
  getSplashWindow,
  getInstallerWindow,
  showMainWindow,
  closeAllWindows
};
