const { app } = require('electron');
const path = require('path');
const fs = require('fs');

let Keytar;
let hasKeytar = false;

// Try to load keytar only on demand (platform-specific)
function tryLoadKeytar() {
  if (hasKeytar) return true;
  
  const { platform } = process;
  
  try {
    Keytar = require('keytar');
    hasKeytar = true;
    return true;
  } catch (error) {
    console.log(`[systemKeychain] keytar not available on ${platform}: ${error.message}`);
    Keytar = null;
    return false;
  }
}

// Check if system keychain integration is available
function isKeychainAvailable() {
  const { platform } = process;
  
  // Keytar works on macOS, Windows, and Linux
  return ['darwin', 'win32', 'linux'].includes(platform);
}

// Get service name for keychain
function getServiceName() {
  return 'OpenConnect VPN';
}

// Get account name for a profile
function getAccountName(profileName) {
  return `profile_${profileName}`;
}

// Save credentials to keychain
async function saveCredentials(profileName, username, password) {
  if (!tryLoadKeytar()) {
    return { success: false, error: 'System keychain not available' };
  }

  try {
    const account = getAccountName(profileName);
    await Keytar.setPassword(getServiceName(), account, password);
    
    // Also store username in keychain if available
    try {
      await Keytar.setPassword(getServiceName(), `${account}_username`, username);
    } catch (e) {
      // Username storage is optional
      console.log(`[systemKeychain] Could not store username: ${e.message}`);
    }
    
    return { success: true };
  } catch (error) {
    console.log(`[systemKeychain] Error saving credentials: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Get credentials from keychain
async function getCredentials(profileName) {
  if (!tryLoadKeytar()) {
    return { success: false, error: 'System keychain not available' };
  }

  try {
    const account = getAccountName(profileName);
    const password = await Keytar.getPassword(getServiceName(), account);
    
    if (!password) {
      return { success: false, error: 'Credentials not found in keychain' };
    }

    // Try to get username from keychain
    let username = '';
    try {
      username = await Keytar.getPassword(getServiceName(), `${account}_username`);
    } catch (e) {
      console.log(`[systemKeychain] Could not get username from keychain: ${e.message}`);
    }

    return { success: true, username, password };
  } catch (error) {
    console.log(`[systemKeychain] Error getting credentials: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Delete credentials from keychain
async function deleteCredentials(profileName) {
  if (!tryLoadKeytar()) {
    return { success: false, error: 'System keychain not available' };
  }

  try {
    const account = getAccountName(profileName);
    await Keytar.deletePassword(getServiceName(), account);
    
    // Also delete username if exists
    try {
      await Keytar.deletePassword(getServiceName(), `${account}_username`);
    } catch (e) {
      // Username deletion is optional
      console.log(`[systemKeychain] Could not delete username from keychain: ${e.message}`);
    }
    
    return { success: true };
  } catch (error) {
    console.log(`[systemKeychain] Error deleting credentials: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Save 2FA code to keychain
async function saveTwoFactorCode(profileName, code) {
  if (!tryLoadKeytar()) {
    return { success: false, error: 'System keychain not available' };
  }

  try {
    const account = getAccountName(profileName);
    await Keytar.setPassword(getServiceName(), `${account}_2fa`, code);
    return { success: true };
  } catch (error) {
    console.log(`[systemKeychain] Error saving 2FA code: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Get 2FA code from keychain
async function getTwoFactorCode(profileName) {
  if (!tryLoadKeytar()) {
    return { success: false, error: 'System keychain not available' };
  }

  try {
    const account = getAccountName(profileName);
    const code = await Keytar.getPassword(getServiceName(), `${account}_2fa`);
    
    if (!code) {
      return { success: false, error: '2FA code not found in keychain' };
    }

    return { success: true, code };
  } catch (error) {
    console.log(`[systemKeychain] Error getting 2FA code: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Delete 2FA code from keychain
async function deleteTwoFactorCode(profileName) {
  if (!tryLoadKeytar()) {
    return { success: false, error: 'System keychain not available' };
  }

  try {
    const account = getAccountName(profileName);
    await Keytar.deletePassword(getServiceName(), `${account}_2fa`);
    return { success: true };
  } catch (error) {
    console.log(`[systemKeychain] Error deleting 2FA code: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Check if credentials exist in keychain
async function hasCredentials(profileName) {
  const result = await getCredentials(profileName);
  return { exists: result.success };
}

// Export all functions
module.exports = {
  isKeychainAvailable,
  saveCredentials,
  getCredentials,
  deleteCredentials,
  saveTwoFactorCode,
  getTwoFactorCode,
  deleteTwoFactorCode,
  hasCredentials
};
