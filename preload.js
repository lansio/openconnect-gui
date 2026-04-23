const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // VPN connection methods
  connectVPN: (config) => ipcRenderer.invoke('connect-vpn', config),
  disconnectVPN: (config) => ipcRenderer.invoke('disconnect-vpn', config),
  getStatus: () => ipcRenderer.invoke('get-status'),
  getActiveConnections: () => ipcRenderer.invoke('get-active-connections'),
  checkOpenConnect: () => ipcRenderer.invoke('check-openconnect'),

  // Profile management methods
  saveProfiles: (profiles) => ipcRenderer.invoke('save-profiles', profiles),
  loadProfiles: () => ipcRenderer.invoke('load-profiles'),

  // Keychain methods
  isKeychainAvailable: () => ipcRenderer.invoke('is-keychain-available'),
  saveCredentials: (profileName, username, password) => ipcRenderer.invoke('save-credentials', profileName, username, password),
  getCredentials: (profileName) => ipcRenderer.invoke('get-credentials', profileName),
  deleteCredentials: (profileName) => ipcRenderer.invoke('delete-credentials', profileName),
  saveTwoFactorCode: (profileName, code) => ipcRenderer.invoke('save-two-factor-code', profileName, code),
  getTwoFactorCode: (profileName) => ipcRenderer.invoke('get-two-factor-code', profileName),
  deleteTwoFactorCode: (profileName) => ipcRenderer.invoke('delete-two-factor-code', profileName),

  // Process management
  checkRunningProcesses: () => ipcRenderer.invoke('check-running-processes'),
  killProcess: (pid, sudoPassword) => ipcRenderer.invoke('kill-process', pid, sudoPassword),

  // Network diagnostics
  getRoutes: () => ipcRenderer.invoke('get-routes'),
  testConnectivity: (host, port) => ipcRenderer.invoke('test-connectivity', host, port),
  deleteRoute: (destination, sudoPassword) => ipcRenderer.invoke('delete-route', destination, sudoPassword),
  getNetworkInterfaces: () => ipcRenderer.invoke('get-network-interfaces'),

  // First-time setup
  isFirstStart: () => ipcRenderer.invoke('is-first-start'),
  markSetupComplete: () => ipcRenderer.invoke('mark-setup-complete'),

  // System checks
  performSystemChecks: () => ipcRenderer.invoke('perform-system-checks'),

  // Event sending
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),

  // Event listeners
  onStatusChanged: (callback) => {
    ipcRenderer.on('status-changed', (event, status) => callback(status));
  },
  onActiveConnectionsChanged: (callback) => {
    ipcRenderer.on('active-connections-changed', (event, connections) => callback(connections));
  },
  onLogMessage: (callback) => {
    ipcRenderer.on('log-message', (event, log) => callback(log));
  },
  onConnectionError: (callback) => {
    ipcRenderer.on('connection-error', (event, error) => callback(error));
  }
});
