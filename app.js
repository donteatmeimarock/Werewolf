// UI Elements
const lobbyMenu = document.getElementById('lobby-menu');
const lobbyPlayers = document.getElementById('lobby-players');
const roomDisplay = document.getElementById('room-display');
const playerList = document.getElementById('player-list');
const playerCount = document.getElementById('player-count');
const startBtn = document.getElementById('start-btn');
const waitingMsg = document.getElementById('waiting-msg');
const errorMsg = document.getElementById('error-msg');
const hostBtn = document.getElementById('host-btn');
const joinBtn = document.getElementById('join-btn');
const playerNameInput = document.getElementById('player-name');
const roomCodeInput = document.getElementById('room-code');

const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const myRoleDisplay = document.getElementById('my-role');
const phaseIndicator = document.getElementById('phase-indicator');
const systemMessage = document.getElementById('system-message');
const playersGrid = document.getElementById('players-grid');
const actionPanel = document.getElementById('action-panel');
const actionTitle = document.getElementById('action-title');
const actionDesc = document.getElementById('action-desc');
const targetButtons = document.getElementById('target-buttons');
const gameOverScreen = document.getElementById('game-over-screen');
const winnerText = document.getElementById('winner-text');
const winnerDesc = document.getElementById('winner-desc');

// PeerJS Networking State
let peer = null;
let hostConn = null; // Used by clients to communicate with host
let clientConns = {}; // Used by host to communicate with clients
let isHost = false;
let myId = null;
let myName = null;
let currentRoomCode = null;

// Game State (Synced to clients, managed by Host)
let players = [];
let myRole = null;
let isAlive = true;
let currentPhase = 'lobby';

// Host-Only Game State
let gameState = {
    phase: 'lobby',
    nightActions: {},
    votes: {}
};

const ROLES = ['werewolf', 'healer', 'guard', 'villager', 'villager', 'villager', 'villager', 'villager', 'villager', 'villager'];
const MAX_PLAYERS = 10;
const BOTS = ['Bot_Alpha', 'Bot_Beta', 'Bot_Gamma', 'Bot_Delta', 'Bot_Epsilon', 'Bot_Zeta', 'Bot_Eta', 'Bot_Theta', 'Bot_Iota', 'Bot_Kappa'];

// Helper: Show error
function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.remove('hidden');
    setTimeout(() => errorMsg.classList.add('hidden'), 3000);
}

// Generate random 4-letter room code
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function getPeerId(code) {
    return 'werewolf-pixel-game-' + code;
}

// -----------------------------------------------------------------------------
// Initialization: Host
// -----------------------------------------------------------------------------
hostBtn.addEventListener('click', () => {
    myName = playerNameInput.value.trim() || 'Host';
    currentRoomCode = generateRoomCode();
    myId = 'host';
    isHost = true;
    
    peer = new Peer(getPeerId(currentRoomCode));
    
    peer.on('open', (id) => {
        showLobby(currentRoomCode);
        
        // Add Host to players list
        players.push({ id: myId, name: myName, isBot: false, alive: true, connId: null });
        updateLobbyUI();
    });
    
    peer.on('connection', (conn) => {
        if (gameState.phase !== 'lobby' || players.length >= MAX_PLAYERS) {
            conn.on('open', () => conn.send({ type: 'error', message: 'Game already in progress or full' }));
            setTimeout(() => conn.close(), 1000);
            return;
        }

        conn.on('data', (data) => {
            if (data.type === 'join') {
                const clientId = Math.random().toString(36).substr(2, 9);
                clientConns[clientId] = conn;
                conn.clientId = clientId;
                
                players.push({ id: clientId, name: data.name || 'Player', isBot: false, alive: true, connId: conn.peer });
                broadcast({ type: 'room_update', players, hostId: myId });
                updateLobbyUI();
            } else if (data.type === 'night_action' || data.type === 'vote') {
                handleClientAction(conn.clientId, data);
            }
        });
        
        conn.on('close', () => handleClientDisconnect(conn.clientId));
    });
    
    peer.on('error', (err) => {
        showError("Peer Connection Error: " + err.message);
    });
});

// -----------------------------------------------------------------------------
// Initialization: Client
// -----------------------------------------------------------------------------
joinBtn.addEventListener('click', () => {
    myName = playerNameInput.value.trim() || 'Player';
    currentRoomCode = roomCodeInput.value.trim().toUpperCase();
    
    if (!currentRoomCode) {
        showError("Room Code required.");
        return;
    }
    
    peer = new Peer();
    
    peer.on('open', (id) => {
        hostConn = peer.connect(getPeerId(currentRoomCode));
        
        hostConn.on('open', () => {
            hostConn.send({ type: 'join', name: myName });
            showLobby(currentRoomCode);
        });
        
        hostConn.on('data', (data) => {
            handleServerMessage(data);
        });
        
        hostConn.on('close', () => {
            showError("Connection to host lost.");
        });
    });
    
    peer.on('error', (err) => {
        showError("Failed to connect: " + err.message);
    });
});

// -----------------------------------------------------------------------------
// UI Functions
// -----------------------------------------------------------------------------
function showLobby(code) {
    lobbyMenu.classList.add('hidden');
    lobbyPlayers.classList.remove('hidden');
    roomDisplay.textContent = `Room: ${code}`;
    
    if (isHost) {
        startBtn.classList.remove('hidden');
        waitingMsg.classList.add('hidden');
    } else {
        startBtn.classList.add('hidden');
        waitingMsg.classList.remove('hidden');
    }
}

function updateLobbyUI() {
    playerList.innerHTML = '';
    players.forEach(p => {
        const li = document.createElement('li');
        li.textContent = p.name + (p.id === 'host' ? ' 👑' : '');
        playerList.appendChild(li);
    });
    playerCount.textContent = `${players.length}/10`;
}

// -----------------------------------------------------------------------------
// Client Logic (Receiving from Host)
// -----------------------------------------------------------------------------
function handleServerMessage(data) {
    switch (data.type) {
        case 'error':
            showError(data.message);
            break;
        case 'room_update':
            players = data.players;
            updateLobbyUI();
            break;
        case 'game_start':
            myRole = data.role;
            players = data.players;
            myId = data.myId;
            isAlive = true;
            
            lobbyScreen.classList.remove('active');
            gameScreen.classList.remove('hidden');
            gameScreen.classList.add('active');
            
            myRoleDisplay.textContent = `ROLE: ${myRole.toUpperCase()}`;
            myRoleDisplay.className = `role-badge role-${myRole}`;
            
            renderPlayers();
            break;
        case 'phase_change':
            currentPhase = data.phase;
            phaseIndicator.textContent = `PHASE: ${currentPhase.replace('_', ' ').toUpperCase()}`;
            systemMessage.textContent = data.message;
            
            actionPanel.classList.add('hidden');
            targetButtons.innerHTML = '';
            
            if (currentPhase.startsWith('night')) {
                document.body.classList.add('night-time');
            } else {
                document.body.classList.remove('night-time');
            }

            if (!isAlive && currentPhase !== 'day_guard') return; // Dead players can't act

            if (currentPhase === 'night_werewolf' && myRole === 'werewolf') {
                showActionPanel("WEREWOLF ACTION", "Select a villager to eliminate.", getAliveTargets());
            } else if (currentPhase === 'night_healer' && myRole === 'healer') {
                showActionPanel("HEALER ACTION", "Select someone to heal (blind choice).", getAllTargets());
            } else if (currentPhase === 'day_guard' && myRole === 'guard' && data.guardId === myId) {
                showActionPanel("GUARD LAST STAND", "You were killed! Take someone down with you.", getAliveTargets());
            } else if (currentPhase === 'day_voting' && isAlive) {
                showActionPanel("VILLAGE VOTE", "Vote for the suspected werewolf.", getAliveTargets());
            }
            break;
        case 'night_result':
        case 'vote_result':
            systemMessage.textContent = data.message;
            updateDeadPlayers(data.deadPlayers);
            break;
        case 'game_over':
            actionPanel.classList.add('hidden');
            gameOverScreen.classList.remove('hidden');
            players = data.players;
            renderPlayers(true); // render with roles visible
            
            if (data.winner === 'werewolf') {
                winnerText.textContent = "WEREWOLF WINS!";
                winnerText.style.color = "var(--werewolf-color)";
                winnerDesc.textContent = "The village was devoured.";
            } else {
                winnerText.textContent = "VILLAGERS WIN!";
                winnerText.style.color = "var(--villager-color)";
                winnerDesc.textContent = "The werewolf was defeated.";
            }
            break;
    }
}

function sendToServer(msg) {
    if (isHost) {
        // If host, process directly
        if (msg.type === 'night_action' || msg.type === 'vote') {
            handleClientAction('host', msg);
        }
    } else {
        if (hostConn && hostConn.open) {
            hostConn.send(msg);
        }
    }
}

// -----------------------------------------------------------------------------
// Host Logic (Game State Machine)
// -----------------------------------------------------------------------------
startBtn.addEventListener('click', () => {
    if (!isHost) return;
    
    // Fill with bots
    let botIndex = 0;
    while (players.length < MAX_PLAYERS) {
        players.push({
            id: `bot_${Math.random().toString(36).substr(2, 9)}`,
            name: BOTS[botIndex % BOTS.length],
            isBot: true,
            alive: true
        });
        botIndex++;
    }

    // Assign Roles
    let shuffledRoles = [...ROLES];
    for (let i = shuffledRoles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledRoles[i], shuffledRoles[j]] = [shuffledRoles[j], shuffledRoles[i]];
    }
    
    players.forEach((p, i) => { p.role = shuffledRoles[i]; });

    // Send start to clients
    players.forEach(p => {
        if (!p.isBot) {
            if (p.id === 'host') {
                handleServerMessage({ type: 'game_start', role: p.role, players: getPublicPlayers(), myId: p.id });
            } else {
                sendToClient(p.id, { type: 'game_start', role: p.role, players: getPublicPlayers(), myId: p.id });
            }
        }
    });

    processPhase('night_werewolf');
});

function broadcast(msg) {
    players.forEach(p => {
        if (!p.isBot) {
            if (p.id === 'host') handleServerMessage(msg);
            else sendToClient(p.id, msg);
        }
    });
}

function sendToClient(clientId, msg) {
    if (clientConns[clientId] && clientConns[clientId].open) {
        clientConns[clientId].send(msg);
    }
}

function getPublicPlayers() {
    return players.map(p => ({ id: p.id, name: p.name, alive: p.alive }));
}

function checkWinCondition() {
    const alivePlayers = players.filter(p => p.alive);
    const aliveWerewolves = alivePlayers.filter(p => p.role === 'werewolf').length;

    if (aliveWerewolves === 0) return 'villagers';
    if (alivePlayers.length <= 3 && aliveWerewolves >= 1 && gameState.phase !== 'day_voting') return 'werewolf';
    return null;
}

function processPhase(newPhase) {
    let winner = checkWinCondition();
    if (winner) {
        gameState.phase = 'game_over';
        broadcast({ type: 'game_over', winner, players }); // Send all roles
        return;
    }

    gameState.phase = newPhase;
    let msg = "";

    switch (newPhase) {
        case 'night_werewolf':
            msg = "Night falls. Everyone goes to sleep. The werewolf is waking up...";
            break;
        case 'night_healer':
            msg = "The werewolf has made their choice. The healer is waking up...";
            break;
        case 'night_resolution':
            const killed = gameState.nightActions.werewolfTarget;
            const healed = gameState.nightActions.healerTarget;
            
            let diedThisNight = null;
            if (killed && killed !== healed) {
                const victim = players.find(p => p.id === killed);
                if (victim) {
                    victim.alive = false;
                    diedThisNight = victim;
                }
            }

            gameState.nightActions = {}; // Reset

            const resultMsg = diedThisNight ? `${diedThisNight.name} was killed during the night!` : "No one died during the night!";
            broadcast({ type: 'night_result', message: resultMsg, deadPlayers: players.filter(p => !p.alive).map(p => p.id) });

            if (diedThisNight && diedThisNight.role === 'guard') {
                processPhase('day_guard');
            } else {
                processPhase('day_voting');
            }
            return;

        case 'day_guard':
            const deadGuard = players.find(p => p.role === 'guard' && !p.alive);
            if (deadGuard) {
                broadcast({ type: 'phase_change', phase: 'day_guard', message: "The Guard was killed! They must now pick someone to take down with them.", guardId: deadGuard.id });
                triggerBots();
                return;
            }
            break;
            
        case 'guard_resolution':
            const guardTargetId = gameState.nightActions.guardTarget;
            if (guardTargetId) {
                const target = players.find(p => p.id === guardTargetId);
                if (target) target.alive = false;
                broadcast({ type: 'night_result', message: `The Guard took down ${target.name}!`, deadPlayers: players.filter(p => !p.alive).map(p => p.id) });
            }
            gameState.nightActions = {};
            
            winner = checkWinCondition();
            if (winner) {
                gameState.phase = 'game_over';
                broadcast({ type: 'game_over', winner, players });
                return;
            }

            processPhase('day_voting');
            return;

        case 'day_voting':
            msg = "It is daytime. Discuss and vote for the werewolf!";
            gameState.votes = {};
            break;

        case 'voting_resolution':
            const voteCounts = {};
            Object.values(gameState.votes).forEach(targetId => {
                voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
            });
            
            let maxVotes = 0;
            let votedOutId = null;
            let tie = false;

            for (const [id, count] of Object.entries(voteCounts)) {
                if (count > maxVotes) {
                    maxVotes = count;
                    votedOutId = id;
                    tie = false;
                } else if (count === maxVotes) {
                    tie = true;
                }
            }

            if (votedOutId && !tie) {
                const votedOut = players.find(p => p.id === votedOutId);
                votedOut.alive = false;
                broadcast({ type: 'vote_result', message: `${votedOut.name} was voted out!`, votedOut: votedOut.id, deadPlayers: players.filter(p => !p.alive).map(p => p.id) });
            } else {
                broadcast({ type: 'vote_result', message: `It was a tie! No one was voted out.`, deadPlayers: players.filter(p => !p.alive).map(p => p.id) });
            }

            winner = checkWinCondition();
            if (winner) {
                gameState.phase = 'game_over';
                broadcast({ type: 'game_over', winner, players });
                return;
            }

            setTimeout(() => { processPhase('night_werewolf'); }, 5000);
            return;
    }

    if (newPhase !== 'night_resolution' && newPhase !== 'guard_resolution' && newPhase !== 'voting_resolution') {
        let payload = { type: 'phase_change', phase: newPhase, message: msg };
        if (newPhase === 'day_guard') {
            payload.guardId = players.find(p => p.role === 'guard').id;
        }
        broadcast(payload);
        triggerBots();
    }
}

function handleClientAction(clientId, data) {
    if (gameState.phase === 'night_werewolf' && data.type === 'night_action') {
        gameState.nightActions.werewolfTarget = data.targetId;
        processPhase('night_healer');
    } else if (gameState.phase === 'night_healer' && data.type === 'night_action') {
        gameState.nightActions.healerTarget = data.targetId;
        processPhase('night_resolution');
    } else if (gameState.phase === 'day_guard' && data.type === 'night_action') {
        gameState.nightActions.guardTarget = data.targetId;
        processPhase('guard_resolution');
    } else if (gameState.phase === 'day_voting' && data.type === 'vote') {
        gameState.votes[clientId] = data.targetId;
        const aliveCount = players.filter(p => p.alive).length;
        if (Object.keys(gameState.votes).length >= aliveCount) {
            processPhase('voting_resolution');
        }
    }
}

function handleClientDisconnect(clientId) {
    const player = players.find(p => p.id === clientId);
    if (player) {
        if (gameState.phase === 'lobby') {
            players = players.filter(p => p.id !== clientId);
            broadcast({ type: 'room_update', players, hostId: myId });
            updateLobbyUI();
        } else {
            player.alive = false;
            broadcast({ type: 'night_result', message: `${player.name} disconnected and died.`, deadPlayers: players.filter(p => !p.alive).map(p => p.id) });
        }
    }
    delete clientConns[clientId];
}

// Bot Logic (Runs only on Host)
function triggerBots() {
    if (!isHost) return;

    players.forEach(p => {
        if (p.isBot && p.alive) {
            setTimeout(() => {
                if (gameState.phase === 'night_werewolf' && p.role === 'werewolf') {
                    const targets = players.filter(t => t.alive && t.id !== p.id);
                    if (targets.length > 0) {
                        const target = targets[Math.floor(Math.random() * targets.length)];
                        handleClientAction(p.id, { type: 'night_action', targetId: target.id });
                    }
                } else if (gameState.phase === 'night_healer' && p.role === 'healer') {
                    const targets = players;
                    const target = targets[Math.floor(Math.random() * targets.length)];
                    handleClientAction(p.id, { type: 'night_action', targetId: target.id });
                } else if (gameState.phase === 'day_voting') {
                    const targets = players.filter(t => t.alive && t.id !== p.id);
                    if (targets.length > 0) {
                        const target = targets[Math.floor(Math.random() * targets.length)];
                        handleClientAction(p.id, { type: 'vote', targetId: target.id });
                    }
                }
            }, Math.random() * 3000 + 1000);
        } else if (p.isBot && !p.alive && gameState.phase === 'day_guard' && p.role === 'guard') {
            setTimeout(() => {
                const targets = players.filter(t => t.alive);
                if (targets.length > 0) {
                    const target = targets[Math.floor(Math.random() * targets.length)];
                    handleClientAction(p.id, { type: 'night_action', targetId: target.id });
                }
            }, 2000);
        }
    });
}

// -----------------------------------------------------------------------------
// UI Rendering Functions
// -----------------------------------------------------------------------------
function renderPlayers(revealRoles = false) {
    playersGrid.innerHTML = '';
    players.forEach(p => {
        const card = document.createElement('div');
        card.className = `player-card ${!p.alive ? 'dead' : ''}`;
        card.id = `player-card-${p.id}`;
        
        const icon = document.createElement('div');
        icon.className = 'player-icon';
        icon.textContent = p.alive ? '👤' : '💀';
        
        const name = document.createElement('div');
        name.textContent = p.name + (p.id === myId ? ' (YOU)' : '');
        
        card.appendChild(icon);
        card.appendChild(name);
        
        if (revealRoles) {
            const roleEl = document.createElement('div');
            roleEl.textContent = (p.role || '???').toUpperCase();
            roleEl.style.fontSize = '10px';
            roleEl.style.marginTop = '5px';
            roleEl.style.color = p.role ? `var(--${p.role}-color)` : '#fff';
            card.appendChild(roleEl);
        }
        
        playersGrid.appendChild(card);
    });
}

function updateDeadPlayers(deadIds) {
    if (deadIds.includes(myId)) {
        isAlive = false;
        myRoleDisplay.textContent = `DEAD: ${myRole.toUpperCase()}`;
        myRoleDisplay.style.borderColor = 'var(--danger)';
    }
    
    players.forEach(p => {
        if (deadIds.includes(p.id)) p.alive = false;
    });
    
    renderPlayers();
}

function getAliveTargets() {
    return players.filter(p => p.alive && p.id !== myId);
}

function getAllTargets() {
    return players.filter(p => p.id !== myId);
}

function showActionPanel(title, desc, targets) {
    actionPanel.classList.remove('hidden');
    actionTitle.textContent = title;
    actionDesc.textContent = desc;
    
    if (currentPhase.startsWith('night')) {
        actionPanel.style.borderColor = `var(--${myRole}-color)`;
    } else {
        actionPanel.style.borderColor = '#fff';
    }

    targets.forEach(t => {
        const btn = document.createElement('button');
        btn.className = 'target-btn';
        btn.textContent = t.name + (!t.alive ? ' (DEAD)' : '');
        btn.onclick = () => {
            if (currentPhase === 'day_voting') {
                sendToServer({ type: 'vote', targetId: t.id });
                actionDesc.textContent = `Voted for ${t.name}. Waiting for others...`;
            } else {
                sendToServer({ type: 'night_action', targetId: t.id });
                actionDesc.textContent = `Action submitted. Waiting for dawn...`;
            }
            targetButtons.innerHTML = ''; // hide buttons
        };
        targetButtons.appendChild(btn);
    });
}
