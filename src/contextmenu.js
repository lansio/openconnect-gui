// Global context menu handler for input fields
// This enables right-click copy/paste on macOS

export function setupContextMenu() {
  // Only apply to browser environment
  if (typeof document === 'undefined') return;

  const handleContextMenu = (event) => {
    // Don't prevent default for form inputs - they need context menu
    if (event.target instanceof HTMLInputElement || 
        event.target instanceof HTMLTextAreaElement) {
      // Let the default context menu show
      return;
    }
  };

  document.addEventListener('contextmenu', handleContextMenu);
}
