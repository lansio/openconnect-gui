import React from 'react';
import ReactDOM from 'react-dom/client';
import TwoFactorPrompt from './TwoFactorPrompt';
import './globals.css';

// Get profile name from window if passed
const profileName = typeof window !== 'undefined' ? (window.twoFactorProfileName || null) : null;

ReactDOM.createRoot(document.getElementById('root')).render(
  <TwoFactorPrompt profileName={profileName} />
);
