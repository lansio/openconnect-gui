import { useState, useEffect } from 'react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Shield } from 'lucide-react';

function TwoFactorPrompt({ onComplete, profileName }) {
  const [pin, setPin] = useState('');
  const { ipcRenderer } = window.require('electron');

  // Auto-focus input on mount
  useEffect(() => {
    const input = document.getElementById('pin');
    if (input) {
      input.focus();
    }
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
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
                autoComplete="one-time-code"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                onKeyPress={handleKeyPress}
                autoFocus
              />
            </div>

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
