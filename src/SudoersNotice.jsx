import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Shield, X } from 'lucide-react';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Separator } from './components/ui/separator';

function SudoersNotice({ onDismiss }) {
  const [copied, setCopied] = useState(false);
  const username = process.env.USER || 'your-username';

  const copyToClipboard = () => {
    const command = `echo "${username} ALL=(ALL) NOPASSWD: /usr/bin/openconnect" | sudo tee -a /etc/sudoers.d/openconnect`;
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Card className="w-full max-w-2xl mx-auto border-2 border-warning bg-warning/10">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-warning flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Required: Configure Sudo for OpenConnect
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          className="text-warning hover:text-warning/80 hover:bg-warning/20"
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-sm text-warning-foreground/90">
              OpenConnect requires elevated privileges (sudo) to configure network interfaces.
              To avoid entering your password each time you connect, you can configure sudo to
              allow OpenConnect to run without a password.
            </p>
          </div>
        </div>

        <div className="rounded-md bg-muted p-4 border">
          <p className="text-sm font-medium mb-2">Run this command in Terminal:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-xs bg-background p-2 rounded border overflow-x-auto">
              echo "$(whoami) ALL=(ALL) NOPASSWD: /usr/bin/openconnect" | sudo tee -a /etc/sudoers.d/openconnect
            </code>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={copyToClipboard}>
            {copied ? (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Copied!
              </>
            ) : (
              'Copy Command'
            )}
          </Button>
          
          <a
            href="https://www.openconnect.net.uk/manual.html#sudoers_configuration"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline flex items-center gap-1"
          >
            Learn more about sudoers configuration
            <Shield className="h-3 w-3" />
          </a>
        </div>

        <Separator />

        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground">
            <p className="font-medium mb-1">Alternative: Manual Configuration</p>
            <p>
              You can also manually edit /etc/sudoers using{" "}
              <code className="font-mono">sudo visudo</code> and add:
            </p>
            <code className="block mt-1 bg-background p-2 rounded border font-mono text-xs">
              username ALL=(ALL) NOPASSWD: /usr/bin/openconnect
            </code>
            <p className="mt-2">
              Replace <code className="font-mono">username</code> with your actual username.
            </p>
          </div>
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Shield className="h-3 w-3" />
            This configuration is required for passwordless VPN connections
          </div>
          <Button onClick={onDismiss} className="ml-auto">
            I've Configured Sudo &rarr;
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default SudoersNotice;
