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

function saveProfiles(profiles) {
  try {
    const profilesFile = getProfilesFile();
    fs.writeFileSync(profilesFile, JSON.stringify(profiles, null, 2));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function loadProfiles() {
  try {
    const profilesFile = getProfilesFile();
    if (fs.existsSync(profilesFile)) {
      const data = fs.readFileSync(profilesFile, 'utf8');
      return { success: true, profiles: JSON.parse(data) };
    }
    return { success: true, profiles: [] };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  updateStatus,
  sendLog,
  getProfilesFile,
  saveProfiles,
  loadProfiles
};
