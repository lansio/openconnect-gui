const { dialog } = require('electron');
const fs = require('fs');
const path = require('path');

// Status management
function updateStatus(status) {
  // This will be implemented in main.js or trayManager.js
}

function sendLog(message, level = 'info') {
  // This will be implemented in main.js
}

// Profile management
function getProfilesFile() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'profiles.json');
}

// Load electron-store for settings
let store = null;
function getStore() {
  if (!store) {
    const { app } = require('electron');
    store = require('electron-store');
  }
  return store;
}

// Save profiles with optional keychain storage
function saveProfiles(profiles) {
  try {
    const profilesFile = getProfilesFile();
    
    // Store profiles without passwords (keychain will store them)
    const profilesWithoutPasswords = profiles.map(profile => {
      const { password, ...rest } = profile;
      return rest;
    });
    
    fs.writeFileSync(profilesFile, JSON.stringify(profilesWithoutPasswords, null, 2));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Load profiles with credentials from keychain if available
async function loadProfiles() {
  try {
    const profilesFile = getProfilesFile();
    
    if (!fs.existsSync(profilesFile)) {
      return { success: true, profiles: [] };
    }
    
    const data = fs.readFileSync(profilesFile, 'utf8');
    const profilesWithoutPasswords = JSON.parse(data);
    
    // Try to load credentials from keychain for each profile
    const { getCredentials } = require('../modules/systemKeychain');
    
    const profiles = await Promise.all(profilesWithoutPasswords.map(async (profile) => {
      const result = await getCredentials(profile.name);
      
      if (result.success) {
        return {
          ...profile,
          username: result.username || profile.username,
          password: result.password
        };
      }
      
      return { ...profile, username: profile.username || '', password: '' };
    }));
    
    return { success: true, profiles };
  } catch (error) {
    console.error(`[utils] Error loading profiles: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Save credentials to keychain
async function saveCredentialsToKeychain(profileName, username, password) {
  const { saveCredentials } = require('../modules/systemKeychain');
  
  if (!password || password === '') {
    // Don't save empty passwords
    return { success: true };
  }
  
  const result = await saveCredentials(profileName, username, password);
  return result;
}

// Delete credentials from keychain
async function deleteCredentialsFromKeychain(profileName) {
  const { deleteCredentials, deleteTwoFactorCode } = require('../modules/systemKeychain');
  
  await deleteCredentials(profileName);
  await deleteTwoFactorCode(profileName);
  
  return { success: true };
}

// Save 2FA code to keychain
async function saveTwoFactorCodeToKeychain(profileName, code) {
  const { saveTwoFactorCode } = require('../modules/systemKeychain');
  
  if (!code || code === '') {
    return { success: true };
  }
  
  const result = await saveTwoFactorCode(profileName, code);
  return result;
}

// Get 2FA code from keychain
async function getTwoFactorCodeFromKeychain(profileName) {
  const { getTwoFactorCode } = require('../modules/systemKeychain');
  
  const result = await getTwoFactorCode(profileName);
  return result;
}

module.exports = {
  updateStatus,
  sendLog,
  getProfilesFile,
  saveProfiles,
  loadProfiles,
  saveCredentialsToKeychain,
  deleteCredentialsFromKeychain,
  saveTwoFactorCodeToKeychain,
  getTwoFactorCodeFromKeychain
};
