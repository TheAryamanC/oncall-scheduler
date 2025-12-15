// Create PeerJS-based session
class SessionManager {
    constructor() {
        this.peer = null;
        this.sessionId = null;
        this.isHost = false;
        this.connections = new Map();
        this.preferences = new Map();
        this.callbacks = {
            onSessionStarted: null,
            onSessionEnded: null,
            onMemberConnected: null,
            onMemberDisconnected: null,
            onPreferencesReceived: null,
            onError: null
        };
    }

    // Generate a unique session ID
    generateSessionId() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let result = 'RAOD-';
        for (let i = 0; i < 6; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    // Start a new session as host
    startSession() {
        return new Promise((resolve, reject) => {
            this.sessionId = this.generateSessionId();
            this.isHost = true;

            // Create peer with session ID as the peer ID
            this.peer = new Peer(this.sessionId, {
                debug: 1
            });

            this.peer.on('open', (id) => {
                console.log('Session started with ID:', id);
                this.setupHostListeners();
                if (this.callbacks.onSessionStarted) {
                    this.callbacks.onSessionStarted(id);
                }
                resolve(id);
            });

            this.peer.on('error', (err) => {
                console.error('PeerJS error:', err);
                // If session ID is taken, generate a new one and retry
                if (err.type === 'unavailable-id') {
                    this.sessionId = this.generateSessionId();
                    this.peer.destroy();
                    this.startSession().then(resolve).catch(reject);
                } else {
                    if (this.callbacks.onError) {
                        this.callbacks.onError(err);
                    }
                    reject(err);
                }
            });
        });
    }

    // Set up listeners for incoming connections
    setupHostListeners() {
        this.peer.on('connection', (conn) => {
            console.log('Incoming connection from:', conn.peer);

            conn.on('open', () => {
                // Send session info (date range) to newly connected member
                const startDate = document.getElementById('startDate')?.value;
                const endDate = document.getElementById('endDate')?.value;
                
                conn.send({
                    type: 'session-info',
                    startDate: startDate,
                    endDate: endDate
                });
            });

            conn.on('data', (data) => {
                this.handleMessage(conn, data);
            });

            conn.on('close', () => {
                this.handleDisconnection(conn.peer);
            });

            conn.on('error', (err) => {
                console.error('Connection error:', err);
            });
        });
    }

    // Handle incoming messages from members
    handleMessage(conn, data) {
        console.log('Received message:', data);

        switch (data.type) {
            case 'join':
                // Validate that this RA exists in the setup list
                const joiningEmail = data.email.toLowerCase().trim();
                const joiningName = data.name.trim();
                
                // Check against the scheduler's RA list
                const validRA = window.scheduler && window.scheduler.people.find(p => 
                    p.email.toLowerCase() === joiningEmail && 
                    p.name.toLowerCase() === joiningName.toLowerCase()
                );
                
                if (!validRA) {
                    console.warn(`Rejected join attempt: ${joiningName} <${joiningEmail}> not found in RA list`);
                    conn.send({
                        type: 'join-ack',
                        success: false,
                        message: 'Your name and email do not match any RA in this session. Please check your details and try again.'
                    });
                    conn.close();
                    return;
                }
                
                // Check if this RA is already connected (only one connection per RA)
                let alreadyConnected = false;
                this.connections.forEach((info, peerId) => {
                    if (info.email.toLowerCase() === joiningEmail) {
                        alreadyConnected = true;
                    }
                });
                
                if (alreadyConnected) {
                    console.warn(`Rejected duplicate connection for: ${joiningEmail}`);
                    conn.send({
                        type: 'join-ack',
                        success: false,
                        message: 'You are already connected to this session from another window or device.'
                    });
                    conn.close();
                    return;
                }
                
                // Register the new member (validation passed)
                this.connections.set(conn.peer, {
                    name: data.name,
                    email: joiningEmail,
                    connection: conn,
                    hasSubmitted: false
                });

                if (this.callbacks.onMemberConnected) {
                    this.callbacks.onMemberConnected({
                        peerId: conn.peer,
                        name: data.name,
                        email: joiningEmail
                    });
                }

                conn.send({
                    type: 'join-ack',
                    success: true,
                    message: 'Connected to session'
                });
                break;

            case 'preferences':
                // Store the submitted preferences
                this.preferences.set(data.email, {
                    preferred: data.preferred || [],
                    unavailable: data.unavailable || []
                });

                // Mark member as having submitted
                const memberInfo = this.connections.get(conn.peer);
                if (memberInfo) {
                    memberInfo.hasSubmitted = true;
                }

                // Notify callback
                if (this.callbacks.onPreferencesReceived) {
                    this.callbacks.onPreferencesReceived({
                        email: data.email,
                        name: memberInfo?.name || 'Unknown',
                        preferred: data.preferred,
                        unavailable: data.unavailable
                    });
                }

                // Send acknowledgment
                conn.send({
                    type: 'preferences-ack',
                    success: true,
                    message: 'Preferences received!'
                });
                break;

            default:
                console.log('Unknown message type:', data.type);
        }
    }

    // Handle member disconnection
    handleDisconnection(peerId) {
        const memberInfo = this.connections.get(peerId);
        this.connections.delete(peerId);

        if (memberInfo && this.callbacks.onMemberDisconnected) {
            this.callbacks.onMemberDisconnected({
                peerId: peerId,
                name: memberInfo.name,
                email: memberInfo.email
            });
        }
    }

    // End the current session
    endSession() {
        if (!this.isHost || !this.peer) return;

        // Notify all members that session is ending
        this.connections.forEach((info, peerId) => {
            try {
                info.connection.send({
                    type: 'session-ended',
                    message: 'The host has ended the session'
                });
                info.connection.close();
            } catch (e) {
                console.error('Error closing connection:', e);
            }
        });

        // Clean up
        this.peer.destroy();
        this.peer = null;
        this.sessionId = null;
        this.isHost = false;
        this.connections.clear();

        if (this.callbacks.onSessionEnded) {
            this.callbacks.onSessionEnded();
        }
    }

    // Get the session link for sharing
    getSessionLink() {
        if (!this.sessionId) return null;
        
        const baseUrl = window.location.href.replace(/\/[^\/]*$/, '');
        return `${baseUrl}/member.html?session=${this.sessionId}`;
    }

    // Get all submitted preferences
    getAllPreferences() {
        const result = {};
        this.preferences.forEach((prefs, email) => {
            result[email] = prefs;
        });
        return result;
    }

    // Get number of connected members
    getConnectedCount() {
        return this.connections.size;
    }

    // Get list of connected members
    getConnectedMembers() {
        const members = [];
        this.connections.forEach((info, peerId) => {
            members.push({
                peerId,
                name: info.name,
                email: info.email,
                hasSubmitted: info.hasSubmitted
            });
        });
        return members;
    }

    // Check if a member has submitted preferences
    hasSubmitted(email) {
        return this.preferences.has(email);
    }

    // Register an event callback
    on(event, callback) {
        if (this.callbacks.hasOwnProperty(event)) {
            this.callbacks[event] = callback;
        }
    }
}

// Member session class
class MemberSession {
    constructor() {
        this.peer = null;
        this.connection = null;
        this.sessionId = null;
        this.myInfo = null;
        this.sessionInfo = null;
        this.callbacks = {
            onConnected: null,
            onDisconnected: null,
            onSessionInfo: null,
            onPreferencesAck: null,
            onError: null,
            onSessionEnded: null
        };
    }

    // Connect to a session as member
    connect(sessionId, name, email) {
        return new Promise((resolve, reject) => {
            this.sessionId = sessionId;
            this.myInfo = { name, email };

            // Create peer with auto-generated ID (member doesn't need specific ID)
            this.peer = new Peer(undefined, {
                debug: 1
            });

            this.peer.on('open', (id) => {
                console.log('My peer ID:', id);

                // Connect to the host (session ID is the host's peer ID)
                this.connection = this.peer.connect(sessionId, {
                    reliable: true
                });

                this.connection.on('open', () => {
                    console.log('Connected to session:', sessionId);

                    // Send join message with our info
                    this.connection.send({
                        type: 'join',
                        name: name,
                        email: email
                    });

                    resolve(id);
                });

                this.connection.on('data', (data) => {
                    this.handleMessage(data);
                });

                this.connection.on('close', () => {
                    console.log('Connection closed');
                    if (this.callbacks.onDisconnected) {
                        this.callbacks.onDisconnected();
                    }
                });

                this.connection.on('error', (err) => {
                    console.error('Connection error:', err);
                    if (this.callbacks.onError) {
                        this.callbacks.onError(err);
                    }
                    reject(err);
                });

                setTimeout(() => {
                    if (!this.connection || !this.connection.open) {
                        reject(new Error('Connection timeout - session may not exist'));
                    }
                }, 10000);
            });

            this.peer.on('error', (err) => {
                console.error('PeerJS error:', err);
                if (err.type === 'peer-unavailable') {
                    reject(new Error('Session not found. Please check the session ID.'));
                } else {
                    if (this.callbacks.onError) {
                        this.callbacks.onError(err);
                    }
                    reject(err);
                }
            });
        });
    }

    // Handle incoming messages from host
    handleMessage(data) {
        console.log('Received from host:', data);

        switch (data.type) {
            case 'session-info':
                // Store session info (date range)
                this.sessionInfo = {
                    startDate: data.startDate,
                    endDate: data.endDate
                };
                if (this.callbacks.onSessionInfo) {
                    this.callbacks.onSessionInfo(this.sessionInfo);
                }
                break;

            case 'join-ack':
                // Join was acknowledged or rejected
                if (data.success) {
                    if (this.callbacks.onConnected) {
                        this.callbacks.onConnected();
                    }
                } else {
                    // Join was rejected - show error
                    if (this.callbacks.onError) {
                        this.callbacks.onError({ message: data.message || 'Connection rejected' });
                    }
                    this.disconnect();
                }
                break;

            case 'preferences-ack':
                // Preferences were received
                if (this.callbacks.onPreferencesAck) {
                    this.callbacks.onPreferencesAck(data.success, data.message);
                }
                break;

            case 'session-ended':
                // Host ended the session
                if (this.callbacks.onSessionEnded) {
                    this.callbacks.onSessionEnded(data.message);
                }
                this.disconnect();
                break;

            default:
                console.log('Unknown message type:', data.type);
        }
    }

    // Submit preferences to host
    submitPreferences(preferred, unavailable) {
        if (!this.connection || !this.connection.open) {
            console.error('Not connected to session');
            return false;
        }

        this.connection.send({
            type: 'preferences',
            email: this.myInfo.email,
            preferred: preferred,
            unavailable: unavailable
        });

        return true;
    }

    // Disconnect from the session
    disconnect() {
        if (this.connection) {
            this.connection.close();
        }
        if (this.peer) {
            this.peer.destroy();
        }
        this.connection = null;
        this.peer = null;
    }

    // Register an event callback
    on(event, callback) {
        if (this.callbacks.hasOwnProperty(event)) {
            this.callbacks[event] = callback;
        }
    }
}

// Global session manager instance
const sessionManager = new SessionManager();

// Start a new session
function startSession() {
    sessionManager.startSession()
        .then(sessionId => {
            updateSessionUI(true, sessionId);
            updateEmailLinks();
        })
        .catch(err => {
            alert('Failed to start session: ' + err.message);
        });
}

// End the current session
function endSession() {
    if (confirm('Are you sure you want to end this session? All connected members will be disconnected.')) {
        sessionManager.endSession();
        updateSessionUI(false);
    }
}

// Update session UI elements
function updateSessionUI(active, sessionId = null) {
    const sessionBar = document.getElementById('sessionBar');
    const sessionStatus = document.getElementById('sessionStatus');
    const sessionIdDisplay = document.getElementById('sessionId');
    const startBtn = document.getElementById('startSessionBtn');
    const endBtn = document.getElementById('endSessionBtn');
    const sessionNotStarted = document.getElementById('sessionNotStarted');
    const sessionActive = document.getElementById('sessionActive');
    const displaySessionId = document.getElementById('displaySessionId');

    if (active) {
        sessionStatus.className = 'session-status online';
        sessionStatus.textContent = '● Session Active';
        sessionIdDisplay.textContent = sessionId;
        startBtn.style.display = 'none';
        endBtn.style.display = 'inline-block';
        
        if (sessionNotStarted) sessionNotStarted.style.display = 'none';
        if (sessionActive) sessionActive.style.display = 'block';
        if (displaySessionId) displaySessionId.textContent = sessionId;
    } else {
        sessionStatus.className = 'session-status offline';
        sessionStatus.textContent = '● No Active Session';
        sessionIdDisplay.textContent = '';
        startBtn.style.display = 'inline-block';
        endBtn.style.display = 'none';
        
        if (sessionNotStarted) sessionNotStarted.style.display = 'block';
        if (sessionActive) sessionActive.style.display = 'none';
    }
}

// Update email links for RAs
function updateEmailLinks() {
    const emailLinksContainer = document.getElementById('emailLinks');
    const totalRACount = document.getElementById('totalRACount');
    
    if (!emailLinksContainer || !window.scheduler) return;
    
    const people = scheduler.getPeople();
    if (totalRACount) totalRACount.textContent = people.length;
    
    const sessionLink = sessionManager.getSessionLink();
    
    emailLinksContainer.innerHTML = people.map(person => {
        const personalLink = `${sessionLink}&email=${encodeURIComponent(person.email)}&name=${encodeURIComponent(person.name)}`;
        const mailtoLink = `mailto:${person.email}?subject=${encodeURIComponent('RAOD Preference Submission')}&body=${encodeURIComponent(`Hi ${person.name},\n\nPlease click the link below to submit your RAOD duty preferences:\n\n${personalLink}\n\nThe scheduling session is active now.\n\nThanks!`)}`;
        
        return `
            <div class="email-link-row">
                <span class="ra-name">${person.name}</span>
                <span class="ra-status" id="status-${person.email.replace(/[@.]/g, '-')}">Waiting</span>
                <a href="${mailtoLink}" class="btn btn-small btn-secondary">Email</a>
            </div>
        `;
    }).join('');
}

// Copy session link to clipboard
function copySessionLink() {
    const sessionLink = sessionManager.getSessionLink();
    navigator.clipboard.writeText(sessionLink).then(() => {
        alert('Session link copied to clipboard!');
    }).catch(() => {
        prompt('Copy this link:', sessionLink);
    });
}

// Event handlers for session manager
sessionManager.on('onMemberConnected', (member) => {
    console.log('Member connected:', member);
    updateConnectedList();
    updateMemberStatus(member.email, 'connected');
});

sessionManager.on('onMemberDisconnected', (member) => {
    console.log('Member disconnected:', member);
    updateConnectedList();
    updateMemberStatus(member.email, 'disconnected');
});

sessionManager.on('onPreferencesReceived', (data) => {
    console.log('Preferences received:', data);
    updateMemberStatus(data.email, 'submitted');
    updateSubmissionStatus();
    
    if (window.scheduler) {
        window.scheduler.setPersonPreferences(data.email, data.preferred, data.unavailable);
        updatePreferenceSummary();
    }
});

// Update connected members list UI
function updateConnectedList() {
    const container = document.getElementById('connectedRAs');
    const countDisplay = document.getElementById('connectedCount');
    
    if (!container) return;
    
    const members = sessionManager.getConnectedMembers();
    countDisplay.textContent = members.length;
    
    if (members.length === 0) {
        container.innerHTML = '<p class="muted">Waiting for RAs to connect...</p>';
        return;
    }
    
    container.innerHTML = members.map(m => `
        <div class="connected-member">
            <span class="member-indicator ${m.hasSubmitted ? 'submitted' : 'connected'}"></span>
            <span class="member-name">${m.name}</span>
            <span class="member-status">${m.hasSubmitted ? 'Submitted' : 'Connected'}</span>
        </div>
    `).join('');
}

// Update individual member status UI
function updateMemberStatus(email, status) {
    const statusId = `status-${email.replace(/[@.]/g, '-')}`;
    const statusEl = document.getElementById(statusId);
    
    if (!statusEl) return;
    
    switch (status) {
        case 'connected':
            statusEl.textContent = 'Connected';
            statusEl.className = 'ra-status connected';
            break;
        case 'submitted':
            statusEl.textContent = 'Submitted';
            statusEl.className = 'ra-status submitted';
            break;
        case 'disconnected':
            statusEl.textContent = 'Disconnected';
            statusEl.className = 'ra-status disconnected';
            break;
        default:
            statusEl.textContent = 'Waiting';
            statusEl.className = 'ra-status';
    }
}

// Update submission status summary UI
function updateSubmissionStatus() {
    const container = document.getElementById('submissionStatus');
    if (!container || !window.scheduler) return;
    
    const people = scheduler.getPeople();
    const submitted = people.filter(p => sessionManager.hasSubmitted(p.email));
    
    container.innerHTML = `
        <p><strong>${submitted.length}</strong> of <strong>${people.length}</strong> RAs have submitted preferences.</p>
        ${submitted.map(p => `<div class="submission-item">${p.name}</div>`).join('')}
    `;
}