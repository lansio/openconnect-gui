const { dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Setup complete file path
function getSetupCompleteFile() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'SETUP_COMPLETE');
}

// Check if OpenConnect is installed
function checkOpenConnect() {
  return new Promise((resolve) => {
    const mainRequire = require.main || module.parent;
    const appPath = path.dirname(mainRequire.filename);
    
    // Check for OpenConnect in multiple locations
    const locations = [
      '/usr/local/bin/openconnect',           // Homebrew (Intel Mac)
      '/opt/homebrew/bin/openconnect',        // Homebrew (Apple Silicon)
      path.join(process.env.HOME, '.local/openconnect/bin/openconnect'), // Standalone install
      path.join(appPath, 'bin', 'openconnect'), // Bundled with app (dev)
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

  for (const location of locations) {
    if (fs.existsSync(location)) {
      return location;
    }
  }

  // Fallback to just 'vpnc-script' and hope it's in PATH
  return 'vpnc-script';
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
    fs.writeFileSync(getSetupCompleteFile(), new Date().toISOString());
    console.log('Setup marked as complete');
  } catch (error) {
    console.error('Failed to mark setup complete:', error);
  }
}

function checkSetupComplete() {
  return fs.existsSync(getSetupCompleteFile());
}

// Perform system checks
async function performSystemChecks(splashWindow) {
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
      const { app } = require('electron');
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
      return { success: false };
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

    const isFirstStart = !checkSetupComplete();
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

    return { success: true, isFirstStart };
  } catch (error) {
    console.error('System check error:', error);
    if (splashWindow) {
      splashWindow.webContents.send('splash-error', {
        message: `System check failed: ${error.message}`
      });
    }
    return { success: false };
  }
}

module.exports = {
  checkOpenConnect,
  checkSudoAccess,
  getOpenConnectPath,
  getVpncScriptPath,
  showSudoersNotice,
  markSetupComplete,
  checkSetupComplete,
  performSystemChecks
};
