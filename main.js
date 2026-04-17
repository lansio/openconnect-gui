const { app } = require('electron');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// Import modules
const { createSplashWindow, createMainWindow, createInstallerWindow } = require('./src/modules/windowManager');
const {
  checkOpenConnect,
  checkSudoAccess,
  getOpenConnectPath,
  getVpncScriptPath,
  showSudoersNotice,
  markSetupComplete,
  checkSetupComplete,
  performSystemChecks
} = require('./src/modules/systemChecks');

// Import utils
const { saveProfiles, loadProfiles, getProfilesFile } = require('./src/utils/utils');

// Global state
let tray;
let openconnectProcess = null;
let connectionStatus = 'disconnected';
let mainWindow;

// Setup complete file path
const SETUP_COMPLETE_FILE = path.join(app.getPath('userData'), 'SETUP_COMPLETE');

// Status management
function updateStatus(status) {
  connectionStatus = status;
  if (tray) {
    tray.setToolTip(`OpenConnect VPN - ${connectionStatus}`);
  }
}

// Send log to renderer
function sendLog(message, level = 'info') {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log-message', { level, message });
  }
  console.log(message);
}

// Create system tray
function createTray() {
  const { Tray, Menu } = require('electron');
  tray = new Tray(path.join(__dirname, 'assets', 'tray-icon.png'));
  updateTrayMenu();

  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });
}

function updateTrayMenu() {
  if (!tray) return;

  const { Menu } = require('electron');
  const contextMenu = Menu.buildFromTemplate([
    {
      label: `Status: ${connectionStatus}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Show Window',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
        }
      }
    },
    {
      label: connectionStatus === 'connected' ? 'Disconnect' : 'Connect',
      enabled: false,
      click: () => {
        // Quick connect with last profile could be implemented here
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

// Handle VPN connection
async function connectVPN(config) {
  if (openconnectProcess) {
    return { success: false, error: 'Already connected or connecting' };
  }

  try {
    updateStatus('connecting');

    let waitingForUsername = true;
    let waitingForPassword = false;
    let waitingForTwoFactorPin = false;

    const openconnectPath = await getOpenConnectPath();
    const vpncScriptPath = getVpncScriptPath();

    const args = [];

    if (vpncScriptPath && vpncScriptPath !== 'vpnc-script') {
      args.push('-s', vpncScriptPath);
    }

    const protocol = config.protocol || 'anyconnect';
    args.push(`--protocol=${protocol}`);

    let serverUrl = config.server;
    if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
      serverUrl = `https://${serverUrl}`;
    }
    args.push(`--server=${serverUrl}`);

    if (config.serverCert) {
      args.push('--servercert', config.serverCert);
    }

    if (config.authgroup) {
      args.push(`--authgroup=${config.authgroup}`);
    }

    args.push('--reconnect-timeout', '60');
    args.push('--dtls-ciphers', 'DEFAULT');
    args.push('--verbose');

    sendLog(`Executing: sudo -A openconnect ${args.join(' ')}`, 'info');

    const sudoProcess = spawn('sudo', ['-A', openconnectPath, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, {
        SUDO_ASKPASS: '/bin/echo'
      })
    });

    openconnectProcess = sudoProcess;

    // Handle stdout
    sudoProcess.stdout.on('data', (data) => {
      const output = data.toString();
      sendLog(output);

      if (waitingForUsername && (output.includes('Username') || output.includes('login:'))) {
        sendLog('[DEBUG] Username prompt detected, sending username...', 'info');
        sudoProcess.stdin.write(config.username.trim() + '\n');
        waitingForUsername = false;
        waitingForPassword = true;
        return;
      }

      if (waitingForPassword && (output.includes('Password') || output.includes('password:') || output.includes('Enter password'))) {
        sendLog('[DEBUG] Password prompt detected, sending password...', 'info');
        sudoProcess.stdin.write(config.password.trim() + '\n');
        waitingForPassword = false;
        return;
      }

      // Handle 2FA prompts
      if ((output.includes('Response:') || output.includes('Enter 2FA code') ||
           output.includes('verification code') || output.includes('Two-Factor Password') ||
           output.includes('one-time password')) && !waitingForPassword) {
        handleTwoFactorPrompt(sudoProcess);
      }

      // Handle second Password prompt for 2FA
      if (output.includes('Password') && !waitingForPassword && !waitingForTwoFactorPin) {
        sendLog('[INFO] Second Password prompt detected (likely 2FA)', 'info');
        handleTwoFactorPrompt(sudoProcess);
      }

      if (output.includes('CONNECTED') || output.includes('Established') || output.includes('Configured as')) {
        updateStatus('connected');
        sendLog('Connection established successfully!', 'info');
      }
    });

    // Handle stderr
    sudoProcess.stderr.on('data', (data) => {
      const output = data.toString();
      sendLog('[STDERR] ' + output);

      if (waitingForUsername && (output.includes('Username') || output.includes('login:'))) {
        sendLog('[DEBUG] Username prompt on stderr, sending username...', 'info');
        sudoProcess.stdin.write(config.username.trim() + '\n');
        waitingForUsername = false;
        waitingForPassword = true;
        return;
      }

      if (waitingForPassword && (output.includes('Password') || output.includes('password:') || output.includes('Enter password'))) {
        sendLog('[DEBUG] Password prompt on stderr, sending password...', 'info');
        sudoProcess.stdin.write(config.password.trim() + '\n');
        waitingForPassword = false;
        return;
      }

      // Handle 2FA prompts on stderr
      if ((output.includes('Response:') || output.includes('Enter 2FA code') ||
           output.includes('verification code') || output.includes('Two-Factor Password') ||
           output.includes('one-time password')) && !waitingForPassword) {
        handleTwoFactorPrompt(sudoProcess);
      }

      if (output.includes('Password') && !waitingForPassword && !waitingForTwoFactorPin) {
        sendLog('[INFO] Second Password prompt on stderr (likely 2FA)', 'info');
        handleTwoFactorPrompt(sudoProcess);
      }

      if (output.includes('authentication failed') || output.includes('Login failed')) {
        sendLog('[ERROR] VPN authentication failed!', 'error');
      }

      if (output.includes('is not a recognized network service') || output.includes('Error: The parameters were not valid')) {
        sendLog('Note: Route configuration had errors but VPN tunnel is established', 'info');
      }
    });

    // Handle process exit
    sudoProcess.on('close', (code) => {
      const exitTime = new Date().toLocaleTimeString();
      sendLog(`[DEBUG] OpenConnect process exited with code ${code} at ${exitTime}`);

      openconnectProcess = null;
      updateStatus('disconnected');

      if (code !== 0 && code !== null) {
        let errorMessage = `Connection closed with exit code ${code}`;
        if (code === 1) {
          errorMessage = 'Connection failed. This may be due to incorrect sudo password or network issues.';
        }
        sendLog(`[ERROR] ${errorMessage}`, 'error');

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('connection-error', errorMessage);
        }
      }
    });

    sudoProcess.on('error', (error) => {
      sendLog(`Error: ${error.message}`, 'error');
      openconnectProcess = null;
      updateStatus('disconnected');

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('connection-error', error.message);
      }
    });

    return { success: true };
  } catch (error) {
    updateStatus('disconnected');
    return { success: false, error: error.message };
  }
}

// Handle 2FA prompts
function handleTwoFactorPrompt(sudoProcess) {
  waitingForTwoFactorPin = true;

  promptForTwoFactorPin().then((pin) => {
    if (openconnectProcess && !waitingForTwoFactorPin) {
      return;
    }

    if (pin !== null && pin !== undefined) {
      sendLog('[DEBUG] Sending 2FA PIN to openconnect process...', 'info');
      sudoProcess.stdin.write(pin + '\n');
      waitingForTwoFactorPin = false;
    } else {
      sendLog('[INFO] 2FA prompt cancelled by user', 'info');
      waitingForTwoFactorPin = false;
      disconnectVPN();
    }
  }).catch((error) => {
    sendLog(`[ERROR] Error prompting for 2FA PIN: ${error.message}`, 'error');
    waitingForTwoFactorPin = false;
  });
}

// Prompt for 2FA PIN
async function promptForTwoFactorPin() {
  return new Promise((resolve) => {
    const { BrowserWindow } = require('electron');
    sendLog('[DEBUG] Creating 2FA PIN prompt window...', 'info');

    const promptWindow = new BrowserWindow({
      width: 520,
      height: 400,
      parent: mainWindow,
      modal: false,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

    if (isDev) {
      promptWindow.loadURL('http://localhost:5173/pages/two-factor-prompt.html');
    } else {
      promptWindow.loadFile(path.join(__dirname, 'dist', 'pages', 'two-factor-prompt.html'));
    }

    const { ipcMain } = require('electron');
    ipcMain.once('two-factor-pin-entered', (event, pin) => {
      sendLog('[DEBUG] 2FA PIN entered by user', 'info');
      promptWindow.close();
      resolve(pin);
    });

    promptWindow.on('closed', () => {
      sendLog('[DEBUG] 2FA PIN prompt window closed', 'info');
      resolve(null);
    });

    promptWindow.once('ready-to-show', () => {
      sendLog('[DEBUG] 2FA PIN prompt ready to show', 'info');
      promptWindow.show();
    });

    setTimeout(() => {
      if (promptWindow && !promptWindow.isDestroyed() && !promptWindow.isVisible()) {
        sendLog('[DEBUG] Showing 2FA PIN prompt (fallback)', 'info');
        promptWindow.show();
      }
    }, 100);
  });
}

// Disconnect VPN
function disconnectVPN() {
  if (openconnectProcess) {
    sendLog('Disconnecting...');

    try {
      openconnectProcess.stdin.end();
    } catch (e) {}

    openconnectProcess.kill('SIGINT');

    setTimeout(() => {
      if (openconnectProcess) {
        sendLog('Force killing OpenConnect process...');
        openconnectProcess.kill('SIGKILL');
        openconnectProcess = null;
        updateStatus('disconnected');
      }
    }, 5000);

    return { success: true };
  }
  return { success: false, error: 'Not connected' };
}

// IPC Handlers
const { ipcMain } = require('electron');

ipcMain.handle('connect-vpn', async (event, config) => {
  return connectVPN(config);
});

ipcMain.handle('disconnect-vpn', async () => {
  return disconnectVPN();
});

ipcMain.handle('get-status', async () => {
  return connectionStatus;
});

ipcMain.handle('save-profiles', async (event, profiles) => {
  return saveProfiles(profiles);
});

ipcMain.handle('load-profiles', async () => {
  return loadProfiles();
});

ipcMain.handle('check-openconnect', async () => {
  return checkOpenConnect();
});

ipcMain.handle('is-first-start', async () => {
  return !checkSetupComplete();
});

ipcMain.handle('mark-setup-complete', async () => {
  markSetupComplete();
  return { success: true };
});

// App lifecycle
app.whenReady().then(async () => {
  createSplashWindow();

  // Perform system checks
  const splashWin = require('./src/modules/windowManager').getSplashWindow();
  const result = await performSystemChecks(splashWin);

  if (result.success) {
    createMainWindow();
    createTray();

    // Show sudoers notice on first start
    if (result.isFirstStart && mainWindow) {
      setTimeout(() => {
        showSudoersNotice();
      }, 1000);
    }
  } else {
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (openconnectProcess) {
    openconnectProcess.kill('SIGTERM');
  }
});
