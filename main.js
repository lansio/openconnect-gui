const { app } = require('electron');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// Import modules
const { createSplashWindow, createMainWindow, createInstallerWindow, getSplashWindow } = require('./src/modules/windowManager');
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
const systemKeychain = require('./src/modules/systemKeychain');

// Global state
let tray;
// Хранилище активных подключений по профилям: key = profileName, value = process object
let openconnectProcesses = {};
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
  // Send status change to renderer
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status-changed', status);
  }
  
  // Send active connections to renderer
  const activeConnections = getActiveConnections();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('active-connections-changed', activeConnections);
  }
}

// Получить список активных подключений
function getActiveConnections() {
  const connections = [];
  for (const [profileName, process] of Object.entries(openconnectProcesses)) {
    if (process) {
      connections.push({ profileName, server: process.serverUrl || 'Unknown' });
    }
  }
  return connections;
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
  // Получить имя профиля для проверки активных подключений
  const profileName = config.profileName || 'default';
  
  // Проверить, есть ли уже активное подключение к этому серверу
  if (openconnectProcesses[profileName]) {
    return { success: false, error: `Already connected to "${profileName}"` };
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

    // Сохраняем информацию о процессе в хранилище по имени профиля
    openconnectProcesses[profileName] = {
      process: sudoProcess,
      serverUrl: serverUrl,
      profileName: profileName
    };

    sendLog(`[DEBUG] Process stored for profile "${profileName}"`, 'debug');

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
        // Используем profileName из хранилища вместо config.profileName
        const processProfileName = openconnectProcesses[profileName]?.profileName || profileName;
        sendLog(`[DEBUG] 2FA prompt detected for profile "${processProfileName}"`, 'info');
        handleTwoFactorPrompt(sudoProcess, processProfileName);
      }

      // Handle second Password prompt for 2FA
      if (output.includes('Password') && !waitingForPassword && !waitingForTwoFactorPin) {
        sendLog('[INFO] Second Password prompt detected (likely 2FA)', 'info');
        const processProfileName = openconnectProcesses[profileName]?.profileName || profileName;
        handleTwoFactorPrompt(sudoProcess, processProfileName);
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
        const processProfileName = openconnectProcesses[profileName]?.profileName || profileName;
        sendLog(`[DEBUG] 2FA prompt on stderr for profile "${processProfileName}"`, 'info');
        handleTwoFactorPrompt(sudoProcess, processProfileName);
      }

      if (output.includes('Password') && !waitingForPassword && !waitingForTwoFactorPin) {
        sendLog('[INFO] Second Password prompt on stderr (likely 2FA)', 'info');
        const processProfileName = openconnectProcesses[profileName]?.profileName || profileName;
        handleTwoFactorPrompt(sudoProcess, processProfileName);
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

      // Удалить процесс из хранилища по имени профиля
      delete openconnectProcesses[profileName];
      
      // Обновить статус на основе оставшихся подключений
      const activeConnections = Object.keys(openconnectProcesses).length;
      updateStatus(activeConnections > 0 ? 'connected' : 'disconnected');

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
      // Удалить процесс из хранилища по имени профиля
      delete openconnectProcesses[profileName];
      
      // Обновить статус на основе оставшихся подключений
      const activeConnections = Object.keys(openconnectProcesses).length;
      updateStatus(activeConnections > 0 ? 'connected' : 'disconnected');

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
function handleTwoFactorPrompt(sudoProcess, profileName = null) {
  // Проверяем, что процесс еще активен в хранилище
  if (!profileName || !openconnectProcesses[profileName]) {
    sendLog('[ERROR] handleTwoFactorPrompt: No active process for profile', 'error');
    return;
  }

  // Проверяем, что это тот же процесс
  if (openconnectProcesses[profileName].process !== sudoProcess) {
    sendLog('[ERROR] handleTwoFactorPrompt: Process mismatch', 'error');
    return;
  }

  const processEntry = openconnectProcesses[profileName];

  // Try to get 2FA code from keychain if profile name is provided
  const tryLoadFromKeychain = async () => {
    if (!profileName) return null;

    const { getTwoFactorCode } = require('./src/modules/systemKeychain');
    const result = await getTwoFactorCode(profileName);

    if (result.success) {
      sendLog(`[DEBUG] 2FA code loaded from keychain for profile "${profileName}"`, 'info');
      return result.code;
    }

    return null;
  };

  const promptAndSend = async () => {
    const pin = await tryLoadFromKeychain() || await promptForTwoFactorPin(profileName);

    // Проверяем, что процесс еще активен
    if (!openconnectProcesses[profileName]) {
      sendLog('[DEBUG] Process no longer active, skipping 2FA PIN', 'info');
      return;
    }

    if (pin !== null && pin !== undefined) {
      sendLog('[DEBUG] Sending 2FA PIN to openconnect process...', 'info');
      sudoProcess.stdin.write(pin + '\n');
    } else {
      sendLog('[INFO] 2FA prompt cancelled by user', 'info');
      // Отключаем только этот профиль
      disconnectVPNByProfile(profileName);
    }
  };

  promptAndSend().catch((error) => {
    sendLog(`[ERROR] Error prompting for 2FA PIN: ${error.message}`, 'error');
  });
}

// Prompt for 2FA PIN
async function promptForTwoFactorPin(profileName = null) {
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

    // Set profile name in window object for TwoFactorPrompt
    if (profileName) {
      promptWindow.webContents.executeJavaScript(`
        window.twoFactorProfileName = '${profileName.replace(/'/g, "\\'")}';
      `).catch(() => {});
    }

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

// Disconnect VPN by profile name
function disconnectVPNByProfile(profileName) {
  const processEntry = openconnectProcesses[profileName];
  
  if (!processEntry || !processEntry.process) {
    return { success: false, error: `No active connection for profile "${profileName}"` };
  }

  const sudoProcess = processEntry.process;
  
  sendLog(`Disconnecting profile "${profileName}"...`);

  try {
    sudoProcess.stdin.end();
  } catch (e) {}

  sudoProcess.kill('SIGINT');

  setTimeout(() => {
    if (openconnectProcesses[profileName] && openconnectProcesses[profileName].process) {
      sendLog(`Force killing OpenConnect process for "${profileName}"...`);
      openconnectProcesses[profileName].process.kill('SIGKILL');
    }
  }, 5000);

  // Удалить процесс из хранилища
  delete openconnectProcesses[profileName];
  
  // Обновить статус на основе оставшихся подключений
  const activeConnections = Object.keys(openconnectProcesses).length;
  updateStatus(activeConnections > 0 ? 'connected' : 'disconnected');

  return { success: true };
}

// Disconnect all VPN connections
function disconnectAllVPN() {
  const profilesToDisconnect = Object.keys(openconnectProcesses);
  
  if (profilesToDisconnect.length === 0) {
    return { success: false, error: 'No active connections' };
  }

  sendLog(`Disconnecting all ${profilesToDisconnect.length} VPN connection(s)...`);

  profilesToDisconnect.forEach(profileName => {
    disconnectVPNByProfile(profileName);
  });

  return { success: true, disconnectedCount: profilesToDisconnect.length };
}

// IPC Handlers
const { ipcMain } = require('electron');

console.log('[main] Registering IPC handlers...');

// Attach ipcMain before any handlers to ensure it's ready
const { BrowserWindow } = require('electron');

// Process and network diagnostic handlers
ipcMain.handle('check-running-processes', async () => {
  return new Promise((resolve, reject) => {
    exec('ps aux | grep -v grep', { maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) {
        console.log('[ERROR] check-running-processes:', error.message);
        reject(error);
        return;
      }
      
      const processes = stdout
        .trim()
        .split('\n')
        .map(line => {
          const parts = line.split(/\s+/);
          return {
            user: parts[0],
            pid: parts[1],
            cpu: parts[2],
            mem: parts[3],
            vsz: parts[4],
            rss: parts[5],
            tty: parts[6],
            stat: parts[7],
            start: parts[8],
            time: parts[9],
            command: parts.slice(10).join(' ')
          };
        });
      
      resolve(processes);
    });
  });
});

ipcMain.handle('get-routes', async () => {
  return new Promise((resolve, reject) => {
    exec('netstat -rn', { maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) {
        console.log('[ERROR] get-routes:', error.message);
        reject(error);
        return;
      }
      
      const lines = stdout.trim().split('\n');
      resolve(lines);
    });
  });
});

ipcMain.handle('kill-process', async (event, pid, sudoPassword) => {
  return new Promise((resolve, reject) => {
    const { exec } = require('child_process');
    exec(`echo '${sudoPassword}' | sudo -S kill ${pid}`, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        console.log('[ERROR] kill-process:', error.message);
        reject(error);
        return;
      }
      resolve({ success: true, stdout, stderr });
    });
  });
});

ipcMain.handle('test-connectivity', async (event, host, port) => {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const timeout = 5000;
    
    let stdout = '';
    let stderr = '';
    
    const ncProcess = spawn('nc', ['-zv', '-w', '5', host, port.toString()]);
    
    ncProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    ncProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    ncProcess.on('close', (code) => {
      const success = code === 0;
      resolve({ success, stdout, stderr, exitCode: code });
    });
    
    ncProcess.on('error', (error) => {
      reject(error);
    });
    
    setTimeout(() => {
      ncProcess.kill('SIGTERM');
      resolve({ success: false, stdout, stderr, exitCode: null, timeout: true });
    }, timeout);
  });
});

ipcMain.handle('delete-route', async (event, destination, sudoPassword) => {
  return new Promise((resolve, reject) => {
    const { exec } = require('child_process');
    
    // Try to delete route using sudo
    const cmd = `echo '${sudoPassword}' | sudo -S route delete ${destination}`;
    exec(cmd, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        console.log('[ERROR] delete-route:', error.message);
        reject(error);
        return;
      }
      resolve({ success: true, stdout, stderr });
    });
  });
});

ipcMain.handle('get-network-interfaces', async () => {
  return new Promise((resolve, reject) => {
    exec('ifconfig', { maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) {
        console.log('[ERROR] get-network-interfaces:', error.message);
        reject(error);
        return;
      }
      
      // Parse ifconfig output
      const interfaces = [];
      const blocks = stdout.split('\n\n');
      
      for (const block of blocks) {
        if (!block.trim()) continue;
        
        const lines = block.split('\n');
        let interfaceName = '';
        const info = {};
        
        for (const line of lines) {
          if (line.match(/^[a-zA-Z0-9]+:/)) {
            interfaceName = line.split(':')[0];
          } else if (line.includes('inet ')) {
            const parts = line.trim().split(/\s+/);
            info.address = parts[1];
          } else if (line.includes('netmask ')) {
            info.netmask = parts[1];
          } else if (line.includes('broadcast ')) {
            info.broadcast = parts[1];
          } else if (line.includes('status:')) {
            const statusMatch = line.match(/status: (.+)$/);
            if (statusMatch) {
              info.status = statusMatch[1];
            }
          }
        }
        
        if (interfaceName && Object.keys(info).length > 0) {
          interfaces.push({ name: interfaceName, ...info });
        }
      }
      
      resolve(interfaces);
    });
  });
});

ipcMain.handle('connect-vpn', async (event, config) => {
  return connectVPN(config);
});

ipcMain.handle('disconnect-vpn', async (event, config) => {
  // Если передан config.profileName - отключить конкретный профиль
  if (config && config.profileName) {
    return disconnectVPNByProfile(config.profileName);
  }
  // Иначе отключить все подключения
  return disconnectAllVPN();
});

ipcMain.handle('get-active-connections', async () => {
  return getActiveConnections();
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

// Keychain IPC handlers
ipcMain.handle('is-keychain-available', async () => {
  return systemKeychain.isKeychainAvailable();
});

ipcMain.handle('save-credentials', async (event, profileName, username, password) => {
  return systemKeychain.saveCredentials(profileName, username, password);
});

ipcMain.handle('get-credentials', async (event, profileName) => {
  return systemKeychain.getCredentials(profileName);
});

ipcMain.handle('delete-credentials', async (event, profileName) => {
  return systemKeychain.deleteCredentials(profileName);
});

ipcMain.handle('save-two-factor-code', async (event, profileName, code) => {
  return systemKeychain.saveTwoFactorCode(profileName, code);
});

ipcMain.handle('get-two-factor-code', async (event, profileName) => {
  return systemKeychain.getTwoFactorCode(profileName);
});

ipcMain.handle('delete-two-factor-code', async (event, profileName) => {
  return systemKeychain.deleteTwoFactorCode(profileName);
});

// Handle splash screen completion and show main window
ipcMain.on('splash-ready', (event, ...args) => {
  console.log('[main] [IPC CATCH-ALL] splash-ready event received from', event.sender.id, 'args:', args);
  console.log('[main] current mainWindow before create:', !!mainWindow);

  // System checks passed, create and show main window
  console.log('[main] Creating new main window...');
  const newMainWindow = createMainWindow();
  mainWindow = newMainWindow;
  
  console.log('[main] mainWindow after assign:', !!mainWindow);
  
  try {
    createTray();
  } catch (e) {
    console.log('[main] Error in createTray:', e.message);
  }

  // Close splash after a short delay
  setTimeout(() => {
    if (getSplashWindow()) {
      getSplashWindow().close();
    }
  }, 300);

  // Show main window
  console.log('[main] Attempting to show main window, isDestroyed:', mainWindow?.isDestroyed());
  if (mainWindow) {
    console.log('[main] Showing main window');
    mainWindow.show();
  } else {
    console.log('[main] mainWindow is null or destroyed');
  }
});

// App lifecycle
app.whenReady().then(() => {
  createSplashWindow();
});

// Handle splash screen loaded and start system checks
ipcMain.on('splash-loaded', async () => {
  // Get splash window once before setTimeout to avoid destroyed object error
  const splashWin = getSplashWindow();

  // Wait a bit for splash to render, then start system checks
  setTimeout(async () => {
    if (!splashWin || splashWin.isDestroyed()) {
      console.log('Splash window destroyed, skipping system checks');
      return;
    }

    // Check if setup is already complete
    const isSetupComplete = checkSetupComplete();
    
    if (isSetupComplete) {
      // Setup already complete, skip checks and go directly to main window
      console.log('Setup already complete, skipping system checks');
      
      // Notify splash that it's ready to close
      if (splashWin && !splashWin.isDestroyed()) {
        splashWin.webContents.send('splash-complete');
      }
      
      // Create and show main window after a short delay
      setTimeout(() => {
        if (splashWin && !splashWin.isDestroyed()) {
          splashWin.close();
        }
        
        console.log('[main] Creating main window (setup complete, skipping checks)...');
        const newMainWindow = createMainWindow();
        mainWindow = newMainWindow;
        
        console.log('[main] mainWindow after assign:', !!mainWindow);
        
        try {
          createTray();
        } catch (e) {
          console.log('[main] Error in createTray:', e.message);
        }
        
        // Show main window
        console.log('[main] Attempting to show main window, isDestroyed:', mainWindow?.isDestroyed());
        if (mainWindow) {
          console.log('[main] Showing main window');
          mainWindow.show();
        } else {
          console.log('[main] mainWindow is null or destroyed');
        }
      }, 500);
      
      return;
    }
    
    // Run system checks for first-time setup
    const result = await performSystemChecks(splashWin);

    if (!result.success) {
      // System checks failed, keep splash open
      return;
    }
  }, 500);
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
