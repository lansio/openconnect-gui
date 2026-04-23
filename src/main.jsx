import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './globals.css';
import { setupContextMenu } from './contextmenu';

// Setup context menu support for input fields
setupContextMenu();

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
);
