import { useState, useEffect } from 'react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Shield, Key } from 'lucide-react';

function TwoFactorPrompt({ onComplete, profileName }) {
  const [pin, setPin] = useState('');
  const [saveToKeychain, setSaveToKeychain] = useState(false);
  const [keychainSupported, setKeychainSupported] = useState(true);
  const { ipcRenderer } = window.require('electron');

  // Check if keychain is supported
  useEffect(() => {
    ipcRenderer.invoke('is-keychain-available').then((supported) => {
      setKeychainSupported(supported);
    });
  }, []);

  // Auto-focus input on mount
  useEffect(() => {
    const input = document.getElementById('pin');
    if (input) {
      input.focus();
    }
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();

    // Save to keychain if enabled
    if (saveToKeychain && keychainSupported) {
      // Save 2FA code with the profile name (server URL)
      const twoFactorProfileName = profileName || 'current';
      ipcRenderer.invoke('save-two-factor-code', twoFactorProfileName, pin).then((result) => {
        if (result.success) {
          console.log('2FA code saved to keychain for profile:', twoFactorProfileName);
        } else {
          console.error('Failed to save 2FA code to keychain:', result.error);
        }
      });
    }

    ipcRenderer.send('two-factor-pin-entered', pin);
  };

  const handleCancel = () => {
    ipcRenderer.send('two-factor-pin-entered', null);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSubmit(e);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border-2 border-foreground">
            <Shield className="h-6 w-6" />
          </div>
          <CardTitle className="text-center">Two-Factor Authentication</CardTitle>
          <CardDescription className="text-center">
            Your VPN server requires two-factor authentication. Please enter the verification code.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pin">Verification Code (2FA PIN)</Label>
              <Input
                type="password"
                id="pin"
                placeholder="Enter 2FA verification code"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                onKeyPress={handleKeyPress}
                autoFocus
              />
            </div>

            {/* Save to keychain option */}
            {keychainSupported && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="saveToKeychain"
                  checked={saveToKeychain}
                  onChange={(e) => setSaveToKeychain(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <Label htmlFor="saveToKeychain" className="flex items-center gap-1 cursor-pointer">
                  <Key className="h-3 w-3" />
                  Save to system keychain for next time
                </Label>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
              <Button type="submit">
                Connect
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default TwoFactorPrompt;
