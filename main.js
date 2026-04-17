const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, shell } = require('electron');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

let mainWindow;
let splashWindow;
let installerWindow;
let tray;
let openconnectProcess = null;
let connectionStatus = 'disconnected';
const PROFILES_FILE = path.join(app.getPath('userData'), 'profiles.json');
let systemChecksComplete = false;

// Setup complete file path
const SETUP_COMPLETE_FILE = path.join(app.getPath('userData'), 'SETUP_COMPLETE');

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
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    splashWindow.loadURL('http://localhost:5173/pages/splash.html');
  } else {
    splashWindow.loadFile(path.join(__dirname, 'dist', 'pages', 'splash.html'));
  }

  splashWindow.center();

  // Handle splash window events
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

// Perform system checks
async function performSystemChecks() {
  let progress = 0;
  const totalChecks = 6;
  const updateProgress = () => {
    progress++;
    const percent = Math.round((progress / totalChecks) * 100);
    if (splashWindow) {
      splashWindow.webContents.send('splash-progress', percent);
    }
  };

  try {
    // Check 1: Electron runtime
    if (splashWindow) {
      splashWindow.webContents.send('system-check-start', 'Application Runtime');
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    if (splashWindow) {
      splashWindow.webContents.send('system-check-complete', 'Application Runtime', true, `Electron v${process.versions.electron}`);
    }
    updateProgress();

    // Check 2: File system access
    if (splashWindow) {
      splashWindow.webContents.send('system-check-start', 'File System Access');
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    try {
      const userDataPath = app.getPath('userData');
      if (!fs.existsSync(userDataPath)) {
        fs.mkdirSync(userDataPath, { recursive: true });
      }
      if (splashWindow) {
        splashWindow.webContents.send('system-check-complete', 'File System Access', true, 'OK');
      }
    } catch (error) {
      if (splashWindow) {
        splashWindow.webContents.send('system-check-complete', 'File System Access', false, error.message);
      }
    }
    updateProgress();

    // Check 3: OpenConnect installation
    if (splashWindow) {
      splashWindow.webContents.send('system-check-start', 'OpenConnect Binary');
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    const openconnectCheck = await checkOpenConnect();
    if (openconnectCheck.installed) {
      if (splashWindow) {
        splashWindow.webContents.send('system-check-complete', 'OpenConnect Binary', true, openconnectCheck.path || 'Found');
      }
    } else {
      if (splashWindow) {
        splashWindow.webContents.send('system-check-complete', 'OpenConnect Binary', false, 'Not installed');
        splashWindow.webContents.send('splash-error', {
          message: 'OpenConnect is not installed. Install with: brew install openconnect',
          action: 'install-openconnect'
        });
      }
      // Don't continue if OpenConnect is not found
      updateProgress();
      updateProgress();
      updateProgress();
      updateProgress();
      return false;
    }
    updateProgress();

    // Check 4: Sudo privileges
    if (splashWindow) {
      splashWindow.webContents.send('system-check-start', 'Sudo Privileges');
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    const sudoCheck = await checkSudoAccess();
    if (sudoCheck.available) {
      if (splashWindow) {
        splashWindow.webContents.send('system-check-complete', 'Sudo Privileges', true, 'User has sudo access');
      }
    } else {
      if (splashWindow) {
        splashWindow.webContents.send('system-check-warning', 'Sudo Privileges', 'Sudo required - will prompt when connecting');
      }
    }
    updateProgress();

    // Check 5: Network capabilities
    if (splashWindow) {
      splashWindow.webContents.send('system-check-start', 'Network Capabilities');
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    if (splashWindow) {
      splashWindow.webContents.send('system-check-complete', 'Network Capabilities', true, 'Available');
    }
    updateProgress();

    // Check 6: Sudoers configuration (first start check)
    if (splashWindow) {
      splashWindow.webContents.send('system-check-start', 'Sudoers Configuration');
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const isFirstStart = !fs.existsSync(SETUP_COMPLETE_FILE);
    if (isFirstStart) {
      if (splashWindow) {
        splashWindow.webContents.send('system-check-warning', 'Sudoers Configuration', 
          'One-time sudoers setup required for passwordless sudo with SUDO_ASKPASS');
      }
    } else {
      if (splashWindow) {
        splashWindow.webContents.send('system-check-complete', 'Sudoers Configuration', true, 'Already configured');
      }
    }
    updateProgress();

    // All checks passed
    if (splashWindow) {
      splashWindow.webContents.send('splash-complete');
      
      // Show sudoers notice on first start
      if (isFirstStart && mainWindow) {
        setTimeout(() => {
          showSudoersNotice();
        }, 1000);
      }
    }
    systemChecksComplete = true;
    return true;

  } catch (error) {
    console.error('System check error:', error);
    if (splashWindow) {
      splashWindow.webContents.send('splash-error', {
        message: `System check failed: ${error.message}`
      });
    }
    return false;
  }
}

// Show sudoers configuration notice on first start
function showSudoersNotice() {
  dialog.showMessageBox({
    type: 'info',
    title: 'Sudoers Configuration Required',
    message: 'To enable passwordless VPN authentication, please run the following command in Terminal:\n\n' +
      'sudo visudo -f /etc/sudoers.d/openconnect-gui\n\n' +
      'Then add this line (replace YOUR_USERNAME with your username):\n' +
      'YOUR_USERNAME ALL=(ALL) NOPASSWD: /usr/local/bin/openconnect\n' +
      'Or for Apple Silicon:\n' +
      'YOUR_USERNAME ALL=(ALL) NOPASSWD: /opt/homebrew/bin/openconnect\n\n' +
      'Alternatively, you can run:\n' +
      'echo "YOUR_USERNAME ALL=(ALL) NOPASSWD: /usr/local/bin/openconnect" | sudo tee /etc/sudoers.d/openconnect-gui',
    buttons: ['OK'],
    cancelId: 0,
  }).then(() => {
    // Mark setup complete after user acknowledges
    markSetupComplete();
  });
}

function markSetupComplete() {
  try {
    fs.writeFileSync(SETUP_COMPLETE_FILE, new Date().toISOString());
    console.log('Setup marked as complete');
  } catch (error) {
    console.error('Failed to mark setup complete:', error);
  }
}

function checkSetupComplete() {
  return fs.existsSync(SETUP_COMPLETE_FILE);
}

// Create main window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false, // Don't show immediately
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 10, y: 10 }
  });

  // Load the app - in dev mode, load from vite server; in production, load from dist
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    // Development mode - load from Vite dev server
    mainWindow.loadURL('http://localhost:5173/pages/index.html');
    // Open DevTools in development
    // mainWindow.webContents.openDevTools();
  } else {
    // Production mode - load from built files
    mainWindow.loadFile(path.join(__dirname, 'dist', 'pages', 'index.html'));
  }

  // Prevent window close, minimize to tray instead
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
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
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    installerWindow.loadURL('http://localhost:5173/pages/installer-helper.html');
  } else {
    installerWindow.loadFile(path.join(__dirname, 'dist', 'pages', 'installer-helper.html'));
  }

  installerWindow.on('closed', () => {
    installerWindow = null;
  });
}

// This function is no longer needed - checks are done in splash screen

// Helper function to check OpenConnect
function checkOpenConnect() {
  return new Promise((resolve) => {
    // Check for OpenConnect in multiple locations
    const locations = [
      '/usr/local/bin/openconnect',           // Homebrew (Intel Mac)
      '/opt/homebrew/bin/openconnect',        // Homebrew (Apple Silicon)
      path.join(process.env.HOME, '.local/openconnect/bin/openconnect'), // Standalone install
      path.join(__dirname, 'bin', 'openconnect'), // Bundled with app (dev)
      path.join(process.resourcesPath, 'bin', 'openconnect'), // Bundled with app (production)
    ];

    // Check each location
    for (const location of locations) {
      if (fs.existsSync(location)) {
        resolve({ installed: true, path: location });
        return;
      }
    }

    // Fallback to 'which' command
    const checkProcess = spawn('which', ['openconnect']);
    checkProcess.on('close', (code) => {
      if (code === 0) {
        resolve({ installed: true, path: 'openconnect' });
      } else {
        resolve({ installed: false });
      }
    });
  });
}

// Check if user has sudo access
function checkSudoAccess() {
  return new Promise((resolve) => {
    // Check if user is in admin/sudo group
    // Note: This doesn't guarantee they know the password, just that they have potential access
    const checkProcess = spawn('groups');
    let output = '';

    checkProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    checkProcess.on('close', () => {
      // Check if user is in admin or wheel group (common sudo groups on macOS)
      const hasAdminAccess = output.includes('admin') || output.includes('wheel');
      resolve({ available: hasAdminAccess });
    });
  });
}

// Get the OpenConnect binary path
function getOpenConnectPath() {
  return new Promise((resolve) => {
    checkOpenConnect().then(result => {
      resolve(result.path || 'openconnect');
    });
  });
}

// Get the vpnc-script path
function getVpncScriptPath() {
  const locations = [
    '/opt/homebrew/etc/vpnc/vpnc-script',           // Homebrew (Apple Silicon)
    '/usr/local/etc/vpnc/vpnc-script',              // Homebrew (Intel)
    '/opt/homebrew/opt/vpnc-scripts/etc/vpnc/vpnc-script', // Homebrew alternate
    '/usr/local/opt/vpnc-scripts/etc/vpnc/vpnc-script',    // Homebrew alternate
    path.join(process.env.HOME, '.local/openconnect/etc/vpnc/vpnc-script'), // Standalone
  ];

  // Check each location
  for (const location of locations) {
    if (fs.existsSync(location)) {
      return location;
    }
  }

  // Fallback to just 'vpnc-script' and hope it's in PATH
  return 'vpnc-script';
}

// Create system tray
function createTray() {
  tray = new Tray(path.join(__dirname, 'assets', 'tray-icon.png'));

  updateTrayMenu();

  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });
}

function updateTrayMenu() {
  // Only update tray if it exists
  if (!tray) {
    return;
  }

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
  tray.setToolTip(`OpenConnect VPN - ${connectionStatus}`);
}

// Handle first start check
ipcMain.handle('is-first-start', async () => {
  return !checkSetupComplete();
});

// Handle marking setup as complete
ipcMain.handle('mark-setup-complete', async () => {
  markSetupComplete();
  return { success: true };
});

// Handle VPN connection
ipcMain.handle('connect-vpn', async (event, config) => {
  if (openconnectProcess) {
    return { success: false, error: 'Already connected or connecting' };
  }

  try {
    updateStatus('connecting');

    // Track input prompts state
    let waitingForUsername = true;
    let waitingForPassword = false;
    let waitingForTwoFactorPin = false;

    // Get OpenConnect binary path
    const openconnectPath = await getOpenConnectPath();

    // Get vpnc-script path (optional)
    const vpncScriptPath = getVpncScriptPath();

    // Build openconnect command arguments
    const args = [];

    // Only add vpnc-script if found (to match working manual command)
    if (vpncScriptPath && vpncScriptPath !== 'vpnc-script') {
      args.push('-s', vpncScriptPath);
    }

    // Add protocol (default is anyconnect)
    const protocol = config.protocol || 'anyconnect';
    args.push(`--protocol=${protocol}`);

    // Add server (keep https:// if present, add it if not)
    let serverUrl = config.server;
    if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
      serverUrl = `https://${serverUrl}`;
    }
    args.push(`--server=${serverUrl}`);

    // Add server certificate pinning if specified
    if (config.serverCert) {
      args.push('--servercert', config.serverCert);
    }

    if (config.authgroup) {
      args.push(`--authgroup=${config.authgroup}`);
    }

    // Add stability and reconnection options
    args.push('--reconnect-timeout', '60'); // Try to reconnect for 60 seconds
    args.push('--dtls-ciphers', 'DEFAULT'); // Use default DTLS ciphers
    args.push('--verbose'); // More detailed logging

    // Log the command being executed (without password)
    sendLog(`Executing: sudo -A openconnect ${args.join(' ')}`, 'info');

    // Spawn openconnect directly with sudo -A
    // SUDO_ASKPASS will automatically prompt for password if needed (not configured in sudoers)
    // If user has configured NOPASSWD, no password prompt will appear
    const sudoProcess = spawn('sudo', ['-A', openconnectPath, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, {
        SUDO_ASKPASS: '/bin/echo'  // Simple askpass that just echoes password
      })
    });

    openconnectProcess = sudoProcess;

    // Handle stdout from openconnect
    sudoProcess.stdout.on('data', (data) => {
      const output = data.toString();
      sendLog(output);

      // Handle username prompt (can appear on stdout)
      if (waitingForUsername && (output.includes('Username') || output.includes('login:'))) {
        sendLog('[DEBUG] Username prompt detected on stdout, sending username...', 'info');
        sudoProcess.stdin.write(config.username.trim() + '\n');
        waitingForUsername = false;
        waitingForPassword = true;
        return;
      }

      // Handle password prompt (can appear on stdout)
      if (waitingForPassword && (output.includes('Password') || output.includes('password:') || output.includes('Enter password'))) {
        sendLog('[DEBUG] Password prompt detected on stdout, sending password...', 'info');
        sudoProcess.stdin.write(config.password.trim() + '\n');
        waitingForPassword = false;
        return;
      }

      // Handle 2FA prompts (can appear as "Password:" second time or "Response:")
      if ((output.includes('Response:') || output.includes('Enter 2FA code') || 
           output.includes('verification code') || output.includes('Two-Factor Password') ||
           output.includes('one-time password')) && !waitingForPassword) {
        sendLog('[INFO] 2FA PIN required by server', 'info');
        waitingForTwoFactorPin = true;

        // Prompt user for 2FA PIN
        promptForTwoFactorPin().then((pin) => {
          if (openconnectProcess && !waitingForTwoFactorPin) {
            // 2FA prompt already resolved or cancelled
            return;
          }

          if (pin !== null && pin !== undefined) {
            // User entered PIN - send it through stdin
            sendLog('[DEBUG] Sending 2FA PIN to openconnect process...', 'info');
            sudoProcess.stdin.write(pin + '\n');

            // Reset 2FA state after sending PIN
            waitingForTwoFactorPin = false;
          } else {
            // User cancelled - disconnect
            sendLog('[INFO] 2FA prompt cancelled by user', 'info');
            waitingForTwoFactorPin = false;
            disconnectVPN();
          }
        }).catch((error) => {
          sendLog(`[ERROR] Error prompting for 2FA PIN: ${error.message}`, 'error');
          waitingForTwoFactorPin = false;
        });
      }

      // Handle second Password prompt for 2FA (after first password was sent)
      if (output.includes('Password') && !waitingForPassword && !waitingForTwoFactorPin) {
        sendLog('[INFO] Second Password prompt detected (likely 2FA)', 'info');
        waitingForTwoFactorPin = true;

        // Prompt user for 2FA PIN
        promptForTwoFactorPin().then((pin) => {
          if (openconnectProcess && !waitingForTwoFactorPin) {
            // 2FA prompt already resolved or cancelled
            return;
          }

          if (pin !== null && pin !== undefined) {
            // User entered PIN - send it through stdin
            sendLog('[DEBUG] Sending 2FA PIN to openconnect process...', 'info');
            sudoProcess.stdin.write(pin + '\n');

            // Reset 2FA state after sending PIN
            waitingForTwoFactorPin = false;
          } else {
            // User cancelled - disconnect
            sendLog('[INFO] 2FA prompt cancelled by user', 'info');
            waitingForTwoFactorPin = false;
            disconnectVPN();
          }
        }).catch((error) => {
          sendLog(`[ERROR] Error prompting for 2FA PIN: ${error.message}`, 'error');
          waitingForTwoFactorPin = false;
        });
      }

      // Check for successful connection
      if (output.includes('CONNECTED') || output.includes('Established') || output.includes('Configured as')) {
        updateStatus('connected');
        sendLog('Connection established successfully!', 'info');
      }
    });

    // Handle stderr from openconnect
    sudoProcess.stderr.on('data', (data) => {
      const output = data.toString();
      sendLog('[STDERR] ' + output);

      // Handle username prompt on stderr
      if (waitingForUsername && (output.includes('Username') || output.includes('login:'))) {
        sendLog('[DEBUG] Username prompt detected on stderr, sending username...', 'info');
        sudoProcess.stdin.write(config.username.trim() + '\n');
        waitingForUsername = false;
        waitingForPassword = true;
        return;
      }

      // Handle password prompt on stderr
      if (waitingForPassword && (output.includes('Password') || output.includes('password:') || output.includes('Enter password'))) {
        sendLog('[DEBUG] Password prompt detected on stderr, sending password...', 'info');
        sudoProcess.stdin.write(config.password.trim() + '\n');
        waitingForPassword = false;
        return;
      }

      // Handle 2FA prompts on stderr (can appear as "Password:" second time or "Response:")
      if ((output.includes('Response:') || output.includes('Enter 2FA code') ||
           output.includes('verification code') || output.includes('Two-Factor Password') ||
           output.includes('one-time password')) && !waitingForPassword) {
        sendLog('[INFO] 2FA PIN required by server (stderr)', 'info');
        waitingForTwoFactorPin = true;

        // Prompt user for 2FA PIN
        promptForTwoFactorPin().then((pin) => {
          if (openconnectProcess && !waitingForTwoFactorPin) {
            // 2FA prompt already resolved or cancelled
            return;
          }

          if (pin !== null && pin !== undefined) {
            // User entered PIN - send it through stdin
            sendLog('[DEBUG] Sending 2FA PIN to openconnect process (stderr)...', 'info');
            sudoProcess.stdin.write(pin + '\n');

            // Reset 2FA state after sending PIN
            waitingForTwoFactorPin = false;
          } else {
            // User cancelled - disconnect
            sendLog('[INFO] 2FA prompt cancelled by user (stderr)', 'info');
            waitingForTwoFactorPin = false;
            disconnectVPN();
          }
        }).catch((error) => {
          sendLog(`[ERROR] Error prompting for 2FA PIN (stderr): ${error.message}`, 'error');
          waitingForTwoFactorPin = false;
        });
      }

      // Handle second Password prompt for 2FA (after first password was sent) on stderr
      if (output.includes('Password') && !waitingForPassword && !waitingForTwoFactorPin) {
        sendLog('[INFO] Second Password prompt detected (likely 2FA, stderr)', 'info');
        waitingForTwoFactorPin = true;

        // Prompt user for 2FA PIN
        promptForTwoFactorPin().then((pin) => {
          if (openconnectProcess && !waitingForTwoFactorPin) {
            // 2FA prompt already resolved or cancelled
            return;
          }

          if (pin !== null && pin !== undefined) {
            // User entered PIN - send it through stdin
            sendLog('[DEBUG] Sending 2FA PIN to openconnect process (stderr)...', 'info');
            sudoProcess.stdin.write(pin + '\n');

            // Reset 2FA state after sending PIN
            waitingForTwoFactorPin = false;
          } else {
            // User cancelled - disconnect
            sendLog('[INFO] 2FA prompt cancelled by user (stderr)', 'info');
            waitingForTwoFactorPin = false;
            disconnectVPN();
          }
        }).catch((error) => {
          sendLog(`[ERROR] Error prompting for 2FA PIN (stderr): ${error.message}`, 'error');
          waitingForTwoFactorPin = false;
        });
      }

      // Check for sudo password errors
      if (output.includes('Sorry, try again') || output.includes('incorrect password')) {
        sendLog('[ERROR] Sudo password authentication failed!', 'error');
      }

      // Check for VPN authentication errors
      if (output.includes('authentication failed') || output.includes('Login failed')) {
        sendLog('[ERROR] VPN authentication failed!', 'error');
      }

      // Check for vpnc-script errors (connection still works)
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

        // Provide specific error messages based on context
        if (code === 1) {
          errorMessage = 'Connection failed. This may be due to incorrect sudo password or network issues.';
        }

        sendLog(`[ERROR] ${errorMessage}`, 'error');

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('connection-error', errorMessage);
        }
      } else if (code === 0) {
        // Clean exit while connected - this is unexpected
        sendLog(`[WARNING] VPN disconnected cleanly. This may be due to:`, 'error');
        sendLog(`  - Network interruption or timeout`, 'error');
        sendLog(`  - Server-side disconnect (idle timeout, policy, etc.)`, 'error');
        sendLog(`  - MTU/DTLS issues`, 'error');

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('connection-error', 'VPN disconnected. Check logs for details.');
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
});

// Handle VPN disconnection
ipcMain.handle('disconnect-vpn', async () => {
  return disconnectVPN();
});

function disconnectVPN() {
  if (openconnectProcess) {
    sendLog('Disconnecting...');

    // Close stdin to signal clean shutdown
    try {
      openconnectProcess.stdin.end();
    } catch (e) {
      // Ignore errors if stdin already closed
    }

    // Send SIGINT for graceful shutdown
    openconnectProcess.kill('SIGINT');

    // Give it 5 seconds to shut down gracefully, then force kill
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

// Get connection status
ipcMain.handle('get-status', async () => {
  return connectionStatus;
});

// Save profiles
ipcMain.handle('save-profiles', async (event, profiles) => {
  try {
    fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Load profiles
ipcMain.handle('load-profiles', async () => {
  try {
    if (fs.existsSync(PROFILES_FILE)) {
      const data = fs.readFileSync(PROFILES_FILE, 'utf8');
      return { success: true, profiles: JSON.parse(data) };
    }
    return { success: true, profiles: [] };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Check if openconnect is installed
ipcMain.handle('check-openconnect', async () => {
  return checkOpenConnect();
});

// Check for running openconnect processes
ipcMain.handle('check-running-processes', async () => {
  return new Promise((resolve) => {
    // Look for actual openconnect VPN processes, not the GUI app
    exec('ps aux | grep -E "sudo.*openconnect|/usr.*openconnect|/opt.*openconnect" | grep -v grep | grep -v "openconnect-gui"', (error, stdout, stderr) => {
      if (error && error.code !== 1) {
        // Code 1 means no processes found, which is not an error
        resolve({ success: false, error: stderr || error.message, processes: [] });
        return;
      }

      const processes = stdout.trim().split('\n').filter(line => line.length > 0);
      resolve({
        success: true,
        processes: processes,
        count: processes.length
      });
    });
  });
});

// Kill a process by PID
ipcMain.handle('kill-process', async (event, pid, sudoPassword) => {
  return new Promise((resolve) => {
    if (!pid) {
      resolve({ success: false, error: 'PID is required' });
      return;
    }

    // Validate PID is a positive integer (prevent command injection)
    const pidNumber = parseInt(pid, 10);
    if (!Number.isInteger(pidNumber) || pidNumber <= 0 || pidNumber.toString() !== pid.toString()) {
      resolve({ success: false, error: 'Invalid PID format' });
      return;
    }

    if (!sudoPassword) {
      resolve({
        success: false,
        error: 'Sudo password required to kill processes',
        needsSudo: true
      });
      return;
    }

    // Use spawn with sudo -S to pass password via stdin
    // PID is validated as integer, safe to use in command
    const sudoProcess = spawn('sudo', ['-S', 'kill', '-9', pidNumber.toString()], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    sudoProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    sudoProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    sudoProcess.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, message: `Process ${pid} killed successfully` });
      } else {
        // Check for common error messages
        if (stderr.includes('Sorry, try again') || stderr.includes('incorrect password')) {
          resolve({
            success: false,
            error: 'Incorrect sudo password',
            incorrectPassword: true
          });
        } else {
          resolve({
            success: false,
            error: `Failed to kill process (exit code: ${code})`
          });
        }
      }
    });

    sudoProcess.on('error', (error) => {
      resolve({ success: false, error: error.message });
    });
  });
});

// Splash screen IPC handlers
ipcMain.on('splash-loaded', async () => {
  // Wait a bit for splash to render, then start system checks
  setTimeout(async () => {
    const checksPass = await performSystemChecks();

    if (!checksPass) {
      // System checks failed, keep splash open
      return;
    }
  }, 500);
});

ipcMain.on('splash-ready', () => {
  // System checks passed, create and show main window
  createWindow();

  // Close splash after a short delay
  setTimeout(() => {
    if (splashWindow) {
      splashWindow.close();
    }
  }, 300);

  // Show main window when ready
  if (mainWindow) {
    mainWindow.once('ready-to-show', () => {
      mainWindow.show();

      // Create tray after main window is shown
      try {
        if (!tray) {
          createTray();
        }
      } catch (error) {
        console.log('Tray icon not found, skipping tray creation');
      }
    });
  }
});

ipcMain.on('open-installer', () => {
  createInstallerWindow();
});

// Helper functions
function updateStatus(status) {
  connectionStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status-changed', status);
  }
  updateTrayMenu();
}

function sendLog(message, type = 'info') {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log-message', { message, type, timestamp: new Date().toISOString() });
  }
}

async function promptForSudoPassword() {
  return new Promise((resolve) => {
    // Create a simple dialog to get sudo password
    sendLog('[DEBUG] Creating sudo password prompt window...', 'info');

    const promptWindow = new BrowserWindow({
      width: 520,
      height: 400,
      parent: mainWindow,
      modal: true,
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
      promptWindow.loadURL('http://localhost:5173/pages/password-prompt.html');
    } else {
      promptWindow.loadFile(path.join(__dirname, 'dist', 'pages', 'password-prompt.html'));
    }

    ipcMain.once('sudo-password-entered', (event, password) => {
      sendLog('[DEBUG] Sudo password entered by user', 'info');
      promptWindow.close();
      resolve(password);
    });

    promptWindow.on('closed', () => {
      sendLog('[DEBUG] Sudo password prompt window closed', 'info');
      // If window was closed without entering password, resolve with null
      resolve(null);
    });

    promptWindow.once('ready-to-show', () => {
      sendLog('[DEBUG] Sudo password prompt ready to show', 'info');
      promptWindow.show();
    });

    // Fallback: show after a short delay if ready-to-show doesn't fire
    setTimeout(() => {
      if (promptWindow && !promptWindow.isDestroyed() && !promptWindow.isVisible()) {
        sendLog('[DEBUG] Showing sudo password prompt (fallback)', 'info');
        promptWindow.show();
      }
    }, 100);
  });
}

async function promptForTwoFactorPin() {
  return new Promise((resolve) => {
    // Create a window to get 2FA PIN
    sendLog('[DEBUG] Creating 2FA PIN prompt window...', 'info');

    const promptWindow = new BrowserWindow({
      width: 520,
      height: 400,
      parent: mainWindow,
      modal: false,  // Changed from true to false - allows window to show even if main window is hidden
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

    // Fallback: show after a short delay if ready-to-show doesn't fire
    setTimeout(() => {
      if (promptWindow && !promptWindow.isDestroyed() && !promptWindow.isVisible()) {
        sendLog('[DEBUG] Showing 2FA PIN prompt (fallback)', 'info');
        promptWindow.show();
      }
    }, 100);
  });
}

// App lifecycle
app.whenReady().then(() => {
  // Show splash screen first
  createSplashWindow();

  // Don't create main window yet - wait for splash to complete

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createSplashWindow();
    }
  });
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
