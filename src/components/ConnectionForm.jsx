import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Trash2, Settings, Key, Lock, User, CheckCircle2, Loader2 } from 'lucide-react';
import { Badge } from './ui/badge';

function ConnectionForm({
  profiles,
  setProfiles,
  currentStatus,
  openConnectInstalled,
  showAlert,
  addLog,
  saveProfiles,
  loadProfiles,
  onServerChange
}) {
  const [formData, setFormData] = useState({
    profileName: '',
    serverUrl: '',
    username: '',
    password: '',
    authgroup: '',
    protocol: 'anyconnect',
    serverCert: ''
  });
  const [selectedProfile, setSelectedProfile] = useState('__new__');
  const [useKeychain, setUseKeychain] = useState(false);
  const [keychainStatus, setKeychainStatus] = useState(null); // 'available', 'not_available', 'empty'
  const [loadingKeychain, setLoadingKeychain] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  // Persist last selected profile in component state for session
  const [lastSelectedProfile, setLastSelectedProfile] = useState(null);

  // Check if keychain is available on mount
  useEffect(() => {
    const checkKeychain = async () => {
      try {
        const { isKeychainAvailable } = window.electronAPI;
        const available = await isKeychainAvailable();
        setUseKeychain(available);
      } catch (e) {
        console.log('[ConnectionForm] Keychain check failed:', e.message);
      }
    };

    checkKeychain();
  }, []);

  // When profiles change, try to restore last selected profile
  useEffect(() => {
    if (profiles.length > 0 && !lastSelectedProfile) {
      // Try to restore from localStorage
      const savedLastProfile = window.localStorage?.getItem('openconnect_last_profile');
      if (savedLastProfile && profiles.find(p => p.name === savedLastProfile)) {
        setSelectedProfile(savedLastProfile);
        setLastSelectedProfile(savedLastProfile);
      } else if (profiles.length > 0) {
        // Set to first available profile
        setSelectedProfile(profiles[0].name);
        setLastSelectedProfile(profiles[0].name);
      }
    } else if (profiles.length === 0 && selectedProfile !== '__new__') {
      // No profiles, switch to new
      setSelectedProfile('__new__');
    }
  }, [profiles.length]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));

    // Notify parent when server URL changes
    if (name === 'serverUrl' && onServerChange) {
      onServerChange(value);
    }
  };

  const handleProfileSelect = async (profileName) => {
    // Save last selected profile to localStorage
    if (profileName && profileName !== '__new__') {
      window.localStorage?.setItem('openconnect_last_profile', profileName);
    }

    setSelectedProfile(profileName);
    setIsEditingProfile(false); // Reset editing mode when changing profile

    if (!profileName || profileName === '__new__') {
      // Clear form
      setFormData({
        profileName: '',
        serverUrl: '',
        username: '',
        password: '',
        authgroup: '',
        protocol: 'anyconnect',
        serverCert: ''
      });
      setSelectedProfile('__new__');
      if (onServerChange) {
        onServerChange('');
      }
      return;
    }

    const profile = profiles.find(p => p.name === profileName);
    if (profile) {
      // If using keychain, try to load credentials from there
      const { getCredentials } = window.electronAPI;

      if (useKeychain && profile.password) {
        setLoadingKeychain(true);
        try {
          const result = await getCredentials(profile.name);
          if (result.success) {
            setFormData({
              profileName: profile.name,
              serverUrl: profile.server,
              username: result.username || '',
              password: '',
              authgroup: profile.authgroup || '',
              protocol: profile.protocol || 'anyconnect',
              serverCert: profile.serverCert || ''
            });
            addLog(`Loaded credentials from system keychain for "${profile.name}"`, 'info');
          } else {
            // Fall back to stored credentials
            setFormData({
              profileName: profile.name,
              serverUrl: profile.server,
              username: profile.username || '',
              password: profile.password || '',
              authgroup: profile.authgroup || '',
              protocol: profile.protocol || 'anyconnect',
              serverCert: profile.serverCert || ''
            });
          }
        } catch (e) {
          console.error('Error loading from keychain:', e.message);
          // Fall back to stored credentials
          setFormData({
            profileName: profile.name,
            serverUrl: profile.server,
            username: profile.username || '',
            password: profile.password || '',
            authgroup: profile.authgroup || '',
            protocol: profile.protocol || 'anyconnect',
            serverCert: profile.serverCert || ''
          });
        } finally {
          setLoadingKeychain(false);
        }
      } else {
        // Use stored credentials (no keychain or keychain disabled)
        setFormData({
          profileName: profile.name,
          serverUrl: profile.server,
          username: profile.username || '',
          password: profile.password || '',
          authgroup: profile.authgroup || '',
          protocol: profile.protocol || 'anyconnect',
          serverCert: profile.serverCert || ''
        });
      }

      if (onServerChange) {
        onServerChange(profile.server);
      }
    }
  };

  const handleEditProfile = () => {
    setIsEditingProfile(true);
  };

  const handleConnect = async () => {
    if (!formData.serverUrl || !formData.username) {
      showAlert('Please fill in server and username', 'error');
      return;
    }

    addLog('Attempting to connect...', 'info');

    const config = {
      server: formData.serverUrl.trim(),
      username: formData.username.trim(),
      password: formData.password.trim(),
      // 2FA PIN is not passed from form - it should be entered interactively when server requests it
      authgroup: formData.authgroup?.trim() || undefined,
      protocol: formData.protocol || 'anyconnect',
      serverCert: formData.serverCert?.trim() || undefined
    };

    // If using keychain and password is empty, load it from keychain
    if (useKeychain && !formData.password) {
      const { getCredentials } = window.electronAPI;
      const result = await getCredentials(selectedProfile);
      
      if (result.success) {
        config.password = result.password;
        addLog('Loaded password from system keychain', 'info');
      } else if (!formData.password) {
        showAlert(`Failed to load password from keychain: ${result.error}`, 'error');
        addLog(`Failed to load password from keychain: ${result.error}`, 'error');
        return;
      }
    } else if (!formData.password) {
      showAlert('Password is required', 'error');
      addLog('Connection failed: Password is required', 'error');
      return;
    }

    const result = await window.electronAPI.connectVPN(config);

    if (!result.success) {
      showAlert(`Connection failed: ${result.error}`, 'error');
      addLog(`Connection failed: ${result.error}`, 'error');
    } else {
      addLog('Connection initiated...', 'info');
    }
  };

  const handleDisconnect = async () => {
    addLog('Disconnecting...', 'info');
    const result = await window.electronAPI.disconnectVPN();

    if (!result.success) {
      showAlert(`Disconnect failed: ${result.error}`, 'error');
    }
  };

  const handleSaveProfile = async () => {
    if (!formData.profileName) {
      showAlert('Please enter a profile name', 'error');
      return;
    }

    if (!formData.serverUrl || !formData.username) {
      showAlert('Please fill in server and username', 'error');
      return;
    }

    const profile = {
      name: formData.profileName,
      server: formData.serverUrl,
      username: formData.username,
      password: formData.password,
      authgroup: formData.authgroup || '',
      protocol: formData.protocol || 'anyconnect',
      serverCert: formData.serverCert || ''
    };

    // Save credentials to keychain if available
    let saveToKeychain = false;
    
    if (useKeychain && formData.password) {
      const { saveCredentials } = window.electronAPI;
      const result = await saveCredentials(formData.profileName, formData.username, formData.password);
      
      if (result.success) {
        saveToKeychain = true;
        addLog(`Saved credentials to system keychain for "${formData.profileName}"`, 'info');
      } else {
        showAlert(`Failed to save to keychain: ${result.error}. Saving without encryption.`, 'warning');
        addLog(`Keychain save failed: ${result.error}. Fallback to plaintext.`, 'warning');
      }
    }

    const existingIndex = profiles.findIndex(p => p.name === formData.profileName);
    let newProfiles;

    if (existingIndex >= 0) {
      // Update existing
      newProfiles = [...profiles];
      newProfiles[existingIndex] = profile;
      
      if (saveToKeychain && useKeychain) {
        // Remove password from stored profile since it's in keychain
        newProfiles[existingIndex] = { ...profile, password: '' };
      }
      
      showAlert(`Profile "${formData.profileName}" updated`, 'success');
    } else {
      // Add new
      newProfiles = [...profiles, profile];
      
      if (saveToKeychain && useKeychain) {
        // Remove password from stored profile since it's in keychain
        newProfiles[newProfiles.length - 1] = { ...profile, password: '' };
      }
      
      showAlert(`Profile "${formData.profileName}" saved`, 'success');
    }

    setProfiles(newProfiles);
    await saveProfiles(newProfiles);
    
    if (saveToKeychain && useKeychain) {
      addLog(`Profile "${formData.profileName}" saved - credentials in system keychain`, 'success');
    } else {
      addLog(`Profile "${formData.profileName}" saved`, 'info');
    }
  };

  const handleDeleteProfile = async () => {
    if (!selectedProfile) return;

    if (window.confirm(`Delete profile "${selectedProfile}"?`)) {
      // Delete from keychain if using it
      if (useKeychain) {
        const { deleteCredentials } = window.electronAPI;
        await deleteCredentials(selectedProfile);
        addLog(`Deleted credentials from system keychain for "${selectedProfile}"`, 'info');
      }

      const newProfiles = profiles.filter(p => p.name !== selectedProfile);
      setProfiles(newProfiles);
      await saveProfiles(newProfiles);

      // Clear form and selection
      setSelectedProfile('__new__');
      setFormData({
        profileName: '',
        serverUrl: '',
        username: '',
        password: '',
        authgroup: '',
        protocol: 'anyconnect',
        serverCert: ''
      });

      showAlert(`Profile "${selectedProfile}" deleted`, 'success');
      addLog(`Profile "${selectedProfile}" deleted`, 'info');
    }
  };

  const isConnecting = currentStatus === 'connecting';
  const isConnected = currentStatus === 'connected';
  const isDisconnected = currentStatus === 'disconnected';

  // Check if selected profile has saved credentials
  const hasSavedCredentials = profiles.find(p => p.name === selectedProfile)?.password || (useKeychain && !formData.password);

  // Determine if form should be shown (edit mode or new profile)
  const showForm = selectedProfile === '__new__' || isEditingProfile;

  // Get server URL for connection (from form if editing/new, from profile otherwise)
  const connectionServerUrl = showForm ? formData.serverUrl : (profiles.find(p => p.name === selectedProfile)?.server || '');
  const connectionUsername = showForm ? formData.username : (profiles.find(p => p.name === selectedProfile)?.username || '');
  const connectionPassword = showForm ? formData.password : '';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          <CardTitle>Connection Settings</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Profile Selection */}
        <div className="space-y-2">
          <Label htmlFor="profileSelect">Saved Profiles</Label>
          <div className="flex gap-2">
            <Select value={selectedProfile} onValueChange={handleProfileSelect}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="-- New Connection --" />
              </SelectTrigger>
              <SelectContent>
                {profiles.length === 0 && (
                  <SelectItem value="__new__">-- New Connection --</SelectItem>
                )}
                {profiles.map(profile => (
                  <SelectItem key={profile.name} value={profile.name}>
                    {profile.name}
                  </SelectItem>
                ))}
                {profiles.length > 0 && (
                  <SelectItem value="__new__">-- New Connection --</SelectItem>
                )}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              title="Delete Profile"
              disabled={!selectedProfile || selectedProfile === '__new__'}
              onClick={handleDeleteProfile}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Connection Status Area - Always visible */}
        <div className="space-y-3 rounded-md border bg-card p-4">
          {isConnected ? (
            <div className="flex flex-col items-center justify-center py-4">
              <CheckCircle2 className="h-10 w-10 text-green-600" />
              <span className="mt-2 font-semibold text-lg">Connected</span>
              <p className="text-sm text-muted-foreground">
                {profiles.find(p => p.name === selectedProfile)?.server || connectionServerUrl}
              </p>
            </div>
          ) : isConnecting ? (
            <div className="flex flex-col items-center justify-center py-4">
              <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
              <span className="mt-2 font-semibold">Connecting...</span>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-4">
              <div className="rounded-full border-2 border-muted p-3">
                <Shield className="h-10 w-10 text-muted-foreground" />
              </div>
              <span className="mt-2 font-semibold">Disconnected</span>
              {profiles.find(p => p.name === selectedProfile) && (
                <p className="text-sm text-muted-foreground mt-1">
                  Select a profile and click Connect
                </p>
              )}
            </div>
          )}

          {/* Connection Buttons - Always visible at bottom */}
          <div className="mt-4 flex gap-2">
            {isConnected ? (
              <Button
                type="button"
                variant="destructive"
                className="flex-1"
                disabled={!isConnected}
                onClick={handleDisconnect}
              >
                Disconnect
              </Button>
            ) : (
              <Button
                type="button"
                className="flex-1"
                disabled={!openConnectInstalled || isConnecting || !connectionServerUrl || !connectionUsername}
                onClick={handleConnect}
              >
                {isConnecting ? 'Connecting...' : 'Connect'}
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={handleSaveProfile}
            >
              Save Profile
            </Button>
          </div>
        </div>

        {/* Profile Info Card - Show when editing not active */}
        {!showForm && selectedProfile !== '__new__' && (
          <div className="rounded-md border bg-card p-4">
            <h3 className="font-semibold">Selected Profile</h3>
            <div className="mt-2 space-y-1 text-sm">
              <p><span className="text-muted-foreground">Name:</span> {selectedProfile}</p>
              <p><span className="text-muted-foreground">Server:</span> {profiles.find(p => p.name === selectedProfile)?.server}</p>
              <p><span className="text-muted-foreground">Username:</span> {profiles.find(p => p.name === selectedProfile)?.username}</p>
              <p className="flex items-center gap-2">
                <span className="text-muted-foreground">Credentials:</span>
                {useKeychain ? (
                  <Badge variant="outline" className="text-xs">Saved in Keychain</Badge>
                ) : (
                  <span className="text-muted-foreground">Stored locally</span>
                )}
              </p>
            </div>
            <Button onClick={handleEditProfile} variant="outline" className="mt-3 w-full">
              Edit Profile
            </Button>
          </div>
        )}

        {/* Connection Form - Show only when creating new or editing */}
        {showForm && (
          <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
            {selectedProfile !== '__new__' && (
              <Button type="button" variant="ghost" onClick={() => setIsEditingProfile(false)} className="w-full">
                <span className="mr-2">←</span> Back to Profile Info
              </Button>
            )}

            <div className="space-y-2">
              <Label htmlFor="profileName">Profile Name (optional)</Label>
              <Input
                type="text"
                id="profileName"
                name="profileName"
                placeholder="My VPN Connection"
                value={formData.profileName}
                onChange={handleInputChange}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="serverUrl">VPN Server URL *</Label>
              <Input
                type="text"
                id="serverUrl"
                name="serverUrl"
                placeholder="vpn.example.com"
                required
                value={formData.serverUrl}
                onChange={handleInputChange}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">Username *</Label>
              <Input
                type="text"
                id="username"
                name="username"
                placeholder="username"
                required
                value={formData.username}
                onChange={handleInputChange}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password *</Label>
              {useKeychain ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="password"
                    id="password"
                    name="password"
                    placeholder="Enter password manually or leave empty to use keychain"
                    value={formData.password}
                    onChange={handleInputChange}
                    disabled={!useKeychain && !formData.password}
                  />
                  {loadingKeychain ? (
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Lock className="h-3 w-3 animate-spin" />
                      Loading from keychain...
                    </div>
                  ) : formData.password ? (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Key className="h-3 w-3" />
                      Password entered manually
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Lock className="h-3 w-3" />
                      Loading from system keychain...
                    </span>
                  )}
                </div>
              ) : (
                <Input
                  type="password"
                  id="password"
                  name="password"
                  placeholder="password"
                  required
                  value={formData.password}
                  onChange={handleInputChange}
                />
              )}
              {useKeychain ? (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Lock className="h-3 w-3" />
                  Password securely stored in system keychain
                </p>
              ) : (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Lock className="h-3 w-3" />
                  Password is stored in plaintext locally
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="authgroup">Group/Authgroup (optional)</Label>
              <Input
                type="text"
                id="authgroup"
                name="authgroup"
                placeholder="group-name"
                value={formData.authgroup}
                onChange={handleInputChange}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="protocol">Protocol</Label>
              <Select value={formData.protocol} onValueChange={(value) => setFormData(prev => ({ ...prev, protocol: value }))}>
                <SelectTrigger id="protocol">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anyconnect">AnyConnect (Cisco)</SelectItem>
                  <SelectItem value="nc">Juniper Network Connect</SelectItem>
                  <SelectItem value="gp">GlobalProtect (Palo Alto)</SelectItem>
                  <SelectItem value="pulse">Pulse Connect Secure</SelectItem>
                  <SelectItem value="f5">F5 Big-IP</SelectItem>
                  <SelectItem value="fortinet">Fortinet</SelectItem>
                  <SelectItem value="array">Array Networks</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Select the VPN protocol your server uses</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="serverCert">Server Certificate (optional)</Label>
              <Input
                type="text"
                id="serverCert"
                name="serverCert"
                placeholder="pin-sha256:xxxxx..."
                value={formData.serverCert}
                onChange={handleInputChange}
              />
              <p className="text-xs text-muted-foreground">Example: pin-sha256:AAAA1111BBB2222CCC3333DDD4444EEE5555FFF6666=</p>
            </div>

            <div className="mt-4 flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={handleSaveProfile}
              >
                Save Profile
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export default ConnectionForm;
