#!/usr/bin/env node

// Script to create a tray icon from the tunnel SVG
// This creates a 16x16 PNG with a simplified tunnel icon

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const assetsDir = path.join(__dirname, '..', 'assets');
const iconPath = path.join(assetsDir, 'tray-icon.png');

// Ensure assets directory exists
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// Check if the icon already exists and is recent
if (fs.existsSync(iconPath)) {
  const now = Date.now();
  const iconTime = fs.statSync(iconPath).mtime.getTime();
  // Recreate if older than 1 day
  if (now - iconTime < 24 * 60 * 60 * 1000) {
    console.log('Tray icon already exists and is up to date');
    process.exit(0);
  }
}

// Use sips to convert and resize the SVG
const buildDir = path.join(__dirname, '..', 'build');
const iconFile = path.join(buildDir, 'tunnel-icon.svg');

if (!fs.existsSync(iconFile)) {
  console.error('Error: tunnel-icon.svg not found in build directory');
  process.exit(1);
}

try {
  // Convert SVG to PNG at tray icon size (16x16)
  execSync(`sips -z 16 16 --out "${iconPath}" "${iconFile}"`, { stdio: 'pipe' });
  console.log('✅ Tray icon created successfully at:', iconPath);
} catch (error) {
  // Fallback: try using convert from ImageMagick
  console.log('sips failed, trying ImageMagick...');
  try {
    execSync(`magick "${iconFile}" -background none -resize 16x16 "${iconPath}"`, { stdio: 'pipe' });
    console.log('✅ Tray icon created successfully at:', iconPath);
  } catch (convertError) {
    console.error('Error creating tray icon:', convertError.message);
    process.exit(1);
  }
}
