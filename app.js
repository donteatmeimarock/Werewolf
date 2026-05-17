const socket = io();

// UI Elements
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const lobbyPlayers = document.getElementById('lobby-players');
const playerList = document.getElementById('player-list');
const playerCount = document.getElementById('player-count');
const startBtn = document.getElementById('start-btn');
const waitingMsg = document.getElementById('waiting-msg');
const errorMsg = document.getElementById('error-msg');
const joinBtn = document.getElementById('join-btn');
const playerNameInput = document.getElementById('player-name');
const roomCodeInput = document.getElementById('room-code');

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

// State
let myId = null;
let roomCode = null;
let myRole = null;
let isAlive = true;
let currentPhase = 'lobby';
let players = [];

// Helper: Show error
function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.remove('hidden');
    setTimeout(() => errorMsg.classList.add('hidden'), 3000);
}

// Join Game
joinBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    const code = roomCodeInput.value.trim().toUpperCase();
    if (!name || !code) {
        showError("Name and Room Code required.");
        return;
    }
    roomCode = code;
    socket.emit('join_room', { roomCode, playerName: name });
});

// Start Game
startBtn.addEventListener('click', () => {
    socket.emit('start_game', roomCode);
});

// Socket Events
socket.on('connect', () => {
    myId = socket.id;
});

socket.on('error', (msg) => {
    showError(msg);
});

socket.on('room_update', ({ players: currentPlayers, host }) => {
    players = currentPlayers;
    lobbyPlayers.classList.remove('hidden');
    
    playerList.innerHTML = '';
    players.forEach(p => {
        const li = document.createElement('li');
        li.textContent = p.name + (p.id === host ? ' 👑' : '');
        playerList.appendChild(li);
    });
    
    playerCount.textContent = `${players.length}/10`;
    
    if (myId === host) {
        startBtn.classList.remove('hidden');
        waitingMsg.classList.add('hidden');
    } else {
        startBtn.classList.add('hidden');
        waitingMsg.classList.remove('hidden');
    }
});

socket.on('game_start', ({ role, players: initialPlayers }) => {
    myRole = role;
    players = initialPlayers;
    isAlive = true;
    
    lobbyScreen.classList.remove('active');
    gameScreen.classList.remove('hidden');
    gameScreen.classList.add('active');
    
    myRoleDisplay.textContent = `ROLE: ${role.toUpperCase()}`;
    myRoleDisplay.className = `role-badge role-${role}`;
    
    renderPlayers();
});

socket.on('phase_change', (data) => {
    currentPhase = data.phase;
    phaseIndicator.textContent = `PHASE: ${currentPhase.replace('_', ' ').toUpperCase()}`;
    systemMessage.textContent = data.message;
    
    // Reset action panel
    actionPanel.classList.add('hidden');
    targetButtons.innerHTML = '';
    
    if (currentPhase.startsWith('night')) {
        document.body.classList.add('night-time');
    } else {
        document.body.classList.remove('night-time');
    }

    if (!isAlive && currentPhase !== 'day_guard') return; // Dead players can't act, except guard if just died

    if (currentPhase === 'night_werewolf' && myRole === 'werewolf') {
        showActionPanel("WEREWOLF ACTION", "Select a villager to eliminate.", getAliveTargets());
    } else if (currentPhase === 'night_healer' && myRole === 'healer') {
        showActionPanel("HEALER ACTION", "Select someone to heal (blind choice).", getAllTargets());
    } else if (currentPhase === 'day_guard' && myRole === 'guard' && data.guardId === myId) {
        showActionPanel("GUARD LAST STAND", "You were killed! Take someone down with you.", getAliveTargets());
    } else if (currentPhase === 'day_voting' && isAlive) {
        showActionPanel("VILLAGE VOTE", "Vote for the suspected werewolf.", getAliveTargets());
    }
});

socket.on('night_result', ({ message, deadPlayers }) => {
    systemMessage.textContent = message;
    updateDeadPlayers(deadPlayers);
});

socket.on('vote_result', ({ message, votedOut, deadPlayers }) => {
    systemMessage.textContent = message;
    updateDeadPlayers(deadPlayers);
});

socket.on('game_over', ({ winner, players: finalPlayers }) => {
    actionPanel.classList.add('hidden');
    gameOverScreen.classList.remove('hidden');
    players = finalPlayers; // show all roles
    renderPlayers(true); // render with roles visible
    
    if (winner === 'werewolf') {
        winnerText.textContent = "WEREWOLF WINS!";
        winnerText.style.color = "var(--werewolf-color)";
        winnerDesc.textContent = "The village was devoured.";
    } else {
        winnerText.textContent = "VILLAGERS WIN!";
        winnerText.style.color = "var(--villager-color)";
        winnerDesc.textContent = "The werewolf was defeated.";
    }
});

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
            roleEl.textContent = p.role.toUpperCase();
            roleEl.style.fontSize = '10px';
            roleEl.style.marginTop = '5px';
            roleEl.style.color = `var(--${p.role}-color)`;
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
                socket.emit('vote', { roomCode, targetId: t.id });
                actionDesc.textContent = `Voted for ${t.name}. Waiting for others...`;
            } else {
                socket.emit('night_action', { roomCode, targetId: t.id });
                actionDesc.textContent = `Action submitted. Waiting for dawn...`;
            }
            targetButtons.innerHTML = ''; // hide buttons
        };
        targetButtons.appendChild(btn);
    });
}
