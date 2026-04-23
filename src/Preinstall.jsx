import React, { useState, useEffect } from 'react';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './components/ui/card';
import { Separator } from './components/ui/separator';
import { Loader2, CheckCircle2, AlertCircle, Terminal, RefreshCw } from 'lucide-react';

function Preinstall() {
  const [status, setStatus] = useState({ show: false, message: '', type: 'info' });
  const [checks, setChecks] = useState([]);
  const [isChecking, setIsChecking] = useState(false);
  const { performSystemChecks } = window.electronAPI;

  const runSystemChecks = async () => {
    setIsChecking(true);
    setStatus({ show: true, message: 'Running system checks...', type: 'info' });
    setChecks([]);

    try {
      const result = await performSystemChecks();

      if (result.success) {
        setStatus({
          show: true,
          message: '✅ All system checks passed!',
          type: 'success'
        });
      } else {
        setStatus({
          show: true,
          message: '❌ Some system checks failed. Please review the results below.',
          type: 'error'
        });
      }

      if (result.checks) {
        setChecks(result.checks);
      }
    } catch (error) {
      setStatus({
        show: true,
        message: `❌ Error running checks: ${error.message}`,
        type: 'error'
      });
    } finally {
      setIsChecking(false);
    }
  };

  const renderCheckStatus = (check) => {
    if (!check.status) return null;

    switch (check.type) {
      case 'success':
        return (
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
            <CheckCircle2 className="w-5 h-5" />
            <span>{check.message}</span>
          </div>
        );
      case 'warning':
        return (
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <AlertCircle className="w-5 h-5" />
            <span>{check.message}</span>
          </div>
        );
      case 'error':
        return (
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertCircle className="w-5 h-5" />
            <span>{check.message}</span>
          </div>
        );
      default:
        return <div className="text-muted-foreground">{check.message}</div>;
    }
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-4xl font-bold">System Checks</h1>
          <p className="text-muted-foreground">
            Verifying system requirements for OpenConnect VPN
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            {status.show && (
              <div className={`mb-4 p-3 rounded-lg ${
                status.type === 'success' ? 'bg-green-50 dark:bg-green-900/20' :
                status.type === 'error' ? 'bg-red-50 dark:bg-red-900/20' :
                'bg-blue-50 dark:bg-blue-900/20'
              }`}>
                <div className="flex items-center gap-2">
                  {status.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-green-600" /> :
                   status.type === 'error' ? <AlertCircle className="w-5 h-5 text-red-600" /> :
                   <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />}
                  <span className={status.type === 'error' ? 'text-red-600' : 
                                   status.type === 'success' ? 'text-green-600' :
                                   'text-blue-600'}>
                    {status.message}
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-4">
              {checks.length === 0 && (
                <div className="text-center py-8">
                  <Button onClick={runSystemChecks} disabled={isChecking}>
                    {isChecking ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Running checks...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Run System Checks
                      </>
                    )}
                  </Button>
                </div>
              )}

              {checks.map((check, index) => (
                <Card key={index} className="border-gray-200 dark:border-gray-700">
                  <CardContent className="pt-4">
                    {renderCheckStatus(check)}
                  </CardContent>
                </Card>
              ))}
            </div>

            {isChecking && (
              <div className="mt-4 flex justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-center gap-4 mt-6">
          <Button onClick={() => window.close()} variant="secondary">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

export default Preinstall;
