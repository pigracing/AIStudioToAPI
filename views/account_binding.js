document.addEventListener('DOMContentLoaded', () => {
    const vncContainer = document.getElementById('vnc-container');
    const saveButton = document.getElementById('save-button');
    const keyboardButton = document.getElementById('keyboard-button');
    const backspaceButton = document.getElementById('backspace-button');
    let rfb;

    // Disable buttons initially
    keyboardButton.disabled = true;
    backspaceButton.disabled = true;

    // --- Reliable VNC Cleanup on Page Unload ---
    window.addEventListener('unload', () => {
        // Use sendBeacon for reliable, asynchronous, non-blocking cleanup requests on page exit.
        if (navigator.sendBeacon) {
            navigator.sendBeacon('/api/cleanup_vnc', new Blob());
        }
    });

    vncContainer.innerHTML = '<p>Loading VNC client library...</p>';

    import('https://esm.sh/@novnc/novnc@1.4.0/lib/rfb.js')
        .then(module => {
            const RFB = module.default;
            vncContainer.innerHTML = '<p>Requesting VNC session...</p>';

            // Pass initial dimensions to the backend
            const initialWidth = vncContainer.clientWidth;
            const initialHeight = vncContainer.clientHeight;
            console.log(`[VNC] Sending initial dimensions to backend: ${initialWidth}x${initialHeight}`);

            fetch('/api/start_vnc_session', {
                body: JSON.stringify({ height: initialHeight, width: initialWidth }),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            })
                .then(response => {
                    if (!response.ok) {
                        return response.json().then(err => {
                            throw new Error(err.error || `Server responded with ${response.status}`);
                        });
                    }
                    return response.json();
                })
                .then(data => {
                    if (data.error) {
                        throw new Error(data.error);
                    }
                    vncContainer.innerHTML = ''; // Clear message

                    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
                    const wsUrl = `${protocol}://${window.location.host}/vnc`;

                    console.log(`[VNC] Connecting to ${wsUrl}...`);

                    const rfbOptions = {
                        shared: true,
                    };
                    if (data.password) {
                        rfbOptions.credentials = { password: data.password };
                    }

                    rfb = new RFB(vncContainer, wsUrl, rfbOptions);

                    rfb.addEventListener('connect', () => {
                        console.log('[VNC] Successfully connected.');
                        vncContainer.style.border = '2px solid green';
                        saveButton.disabled = false;
                        // Enable buttons on connect
                        keyboardButton.disabled = false;
                        backspaceButton.disabled = false;
                    });

                    rfb.addEventListener('disconnect', e => {
                        console.log('[VNC] Disconnected.');
                        const reason = e.detail && e.detail.clean ? 'Session closed normally.'
                            : (e.detail && e.detail.reason ? e.detail.reason : 'Connection dropped unexpectedly.');
                        vncContainer.innerHTML = `
                            <div style="padding: 20px; text-align: center;">
                                <p style="font-size: 1.2em; margin-bottom: 10px;">VNC session has been closed.</p>
                                <p style="color:gray; font-size: 0.9em; margin-bottom: 20px;">Reason: ${reason}</p>
                                <button onclick="location.reload()" style="padding: 10px 20px; font-size: 1em; cursor: pointer;">Reload Page</button>
                            </div>`;
                        vncContainer.style.border = '1px solid #ccc';
                        saveButton.disabled = true;
                        // Disable buttons on disconnect
                        keyboardButton.disabled = true;
                        backspaceButton.disabled = true;
                    });

                    rfb.addEventListener('securityfailure', e => {
                        console.error('[VNC] Security failure:', e);
                        vncContainer.innerHTML = `<p style="color: red;"><b>VNC Authentication Failed.</b><br>The password was rejected by the server.</p><p><button onclick="location.reload()">Reload Page</button></p>`;
                        saveButton.disabled = true;
                        // Disable buttons on failure
                        keyboardButton.disabled = true;
                        backspaceButton.disabled = true;
                    });

                    rfb.scaleViewport = true;
                    rfb.resizeSession = false;
                })
                .catch(error => {
                    console.error('Error starting VNC session:', error);
                    vncContainer.innerHTML = `
                        <div style="padding: 20px; text-align: center; color: red;">
                            <p style="font-size: 1.2em; margin-bottom: 10px;"><b>Failed to start VNC session</b></p>
                            <p style="margin-bottom: 10px;">${error.message}</p>
                            <p style="color:gray; font-size: 0.9em; margin-bottom: 20px;">This feature requires Linux with <code>Xvfb</code>, <code>x11vnc</code>, and <code>websockify</code> installed.</p>
                            <button onclick="location.reload()" style="padding: 10px 20px; font-size: 1em; cursor: pointer;">Reload Page</button>
                        </div>`;
                });
        })
        .catch(err => {
            console.error('Failed to load noVNC library:', err);
            vncContainer.innerHTML = `<p style="color: red;"><b>Failed to load VNC client library.</b><br>Error: ${err.message}<br><br>Please check your internet connection.</p>`;
        });

    // Use prompt() to get text input from the user
    keyboardButton.addEventListener('click', () => {
        if (!rfb) return;

        const text = prompt('Enter text to send to the remote screen:', '');
        if (text !== null) {
            // Send each character
            for (let i = 0; i < text.length; i++) {
                const char = text[i];
                const code = char.charCodeAt(0);
                rfb.sendKey(code, char, true);
                rfb.sendKey(code, char, false);
            }
        }
    });

    backspaceButton.addEventListener('click', () => {
        if (!rfb) return;

        // Send a single backspace event
        rfb.sendKey(0xFF08, 'Backspace', true);
        rfb.sendKey(0xFF08, 'Backspace', false);
    });

    const saveAuth = (accountName = null) => {
        saveButton.disabled = true;
        saveButton.textContent = 'Saving and closing...';

        const body = accountName ? JSON.stringify({ accountName }) : null;
        const headers = accountName ? { 'Content-Type': 'application/json' } : {};

        fetch('/api/save_auth', {
            body,
            headers,
            method: 'POST',
        })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    alert(`Account "${data.accountName}" saved successfully!`);
                    sessionStorage.setItem('newAuthInfo', JSON.stringify(data));
                    window.location.href = '/';
                } else if (data.reason === 'email_fetch_failed') {
                    const manualAccountName = prompt('Could not automatically detect email. Please enter a name for this account:', '');
                    if (manualAccountName) {
                        saveAuth(manualAccountName);
                    } else {
                        alert('Save cancelled.');
                        saveButton.disabled = false;
                        saveButton.textContent = 'Save and Close Session';
                    }
                } else {
                    alert(`Failed to save authentication: ${data.error}`);
                    saveButton.disabled = false;
                    saveButton.textContent = 'Save and Close Session';
                }
            })
            .catch(error => {
                console.error('Error saving auth file:', error);
                alert('An error occurred while saving the auth file: ' + error.message + '.');
                saveButton.disabled = false;
                saveButton.textContent = 'Save and Close Session';
            });
    };

    saveButton.addEventListener('click', () => {
        saveAuth();
    });
});
