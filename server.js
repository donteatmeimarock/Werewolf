const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Game Constants
const ROLES = ['werewolf', 'healer', 'guard', 'villager', 'villager', 'villager', 'villager', 'villager', 'villager', 'villager'];
const MAX_PLAYERS = 10;
const BOTS = ['Bot_Alpha', 'Bot_Beta', 'Bot_Gamma', 'Bot_Delta', 'Bot_Epsilon', 'Bot_Zeta', 'Bot_Eta', 'Bot_Theta', 'Bot_Iota', 'Bot_Kappa'];

// In-memory store
const rooms = {};

// Helper: Shuffle array
function shuffle(array) {
    let currentIndex = array.length, randomIndex;
    while (currentIndex !== 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
    }
    return array;
}

// Check Win Conditions
// Returns: 'villagers' or 'werewolf' or null
function checkWinCondition(roomCode) {
    const room = rooms[roomCode];
    const alivePlayers = room.players.filter(p => p.alive);
    const aliveWerewolves = alivePlayers.filter(p => p.role === 'werewolf').length;

    if (aliveWerewolves === 0) {
        return 'villagers'; // Werewolf is dead
    }

    if (alivePlayers.length <= 3 && aliveWerewolves >= 1 && room.phase !== 'voting') {
        // "If there are three players left, (one is a werewolf) and the villagers fail to vote the werewolf out, then the werewolf wins"
        // If we are at 3 players and it's not the voting phase (e.g. night just ended or voting just ended and they failed to vote out werewolf)
        return 'werewolf';
    }

    return null;
}

function getAlivePlayers(roomCode) {
    return rooms[roomCode].players.filter(p => p.alive).map(p => ({ id: p.id, name: p.name }));
}

function processPhase(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    let winner = checkWinCondition(roomCode);
    if (winner) {
        room.phase = 'game_over';
        io.to(roomCode).emit('game_over', { winner, players: room.players });
        return;
    }

    switch (room.phase) {
        case 'lobby':
            room.phase = 'night_werewolf';
            io.to(roomCode).emit('phase_change', { phase: 'night_werewolf', message: "Night falls. Everyone goes to sleep. The werewolf is waking up..." });
            triggerBots(roomCode);
            break;
            
        case 'night_werewolf':
            room.phase = 'night_healer';
            io.to(roomCode).emit('phase_change', { phase: 'night_healer', message: "The werewolf has made their choice. The healer is waking up..." });
            triggerBots(roomCode);
            break;
            
        case 'night_healer':
            // Resolve Night actions
            const killed = room.nightActions.werewolfTarget;
            const healed = room.nightActions.healerTarget;
            
            let diedThisNight = null;
            if (killed && killed !== healed) {
                const victim = room.players.find(p => p.id === killed);
                if (victim) {
                    victim.alive = false;
                    diedThisNight = victim;
                }
            }

            room.lastNightResult = { killed: killed && killed !== healed ? killed : null, healed };
            room.nightActions = {}; // Reset

            const msg = diedThisNight ? `${diedThisNight.name} was killed during the night!` : "No one died during the night!";
            io.to(roomCode).emit('night_result', { message: msg, deadPlayers: room.players.filter(p => !p.alive).map(p => p.id) });

            if (diedThisNight && diedThisNight.role === 'guard') {
                room.phase = 'day_guard';
                io.to(roomCode).emit('phase_change', { phase: 'day_guard', message: "The Guard was killed! They must now pick someone to take down with them.", guardId: diedThisNight.id });
                triggerBots(roomCode);
            } else {
                room.phase = 'day_voting';
                io.to(roomCode).emit('phase_change', { phase: 'day_voting', message: "It is daytime. Discuss and vote for the werewolf!", alivePlayers: getAlivePlayers(roomCode) });
                room.votes = {};
                triggerBots(roomCode);
            }
            break;

        case 'day_guard':
            // Guard killed someone
            const guardTargetId = room.nightActions.guardTarget;
            if (guardTargetId) {
                const target = room.players.find(p => p.id === guardTargetId);
                if (target) target.alive = false;
                io.to(roomCode).emit('night_result', { message: `The Guard took down ${target.name}!`, deadPlayers: room.players.filter(p => !p.alive).map(p => p.id) });
            }
            room.nightActions = {};
            
            winner = checkWinCondition(roomCode);
            if (winner) {
                room.phase = 'game_over';
                io.to(roomCode).emit('game_over', { winner, players: room.players });
                return;
            }

            room.phase = 'day_voting';
            io.to(roomCode).emit('phase_change', { phase: 'day_voting', message: "It is daytime. Discuss and vote for the werewolf!", alivePlayers: getAlivePlayers(roomCode) });
            room.votes = {};
            triggerBots(roomCode);
            break;
            
        case 'day_voting':
            // Tally votes
            const voteCounts = {};
            Object.values(room.votes).forEach(targetId => {
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
                const votedOut = room.players.find(p => p.id === votedOutId);
                votedOut.alive = false;
                io.to(roomCode).emit('vote_result', { message: `${votedOut.name} was voted out!`, votedOut: votedOut.id, deadPlayers: room.players.filter(p => !p.alive).map(p => p.id) });
            } else {
                io.to(roomCode).emit('vote_result', { message: `It was a tie! No one was voted out.`, deadPlayers: room.players.filter(p => !p.alive).map(p => p.id) });
            }

            winner = checkWinCondition(roomCode);
            if (winner) {
                room.phase = 'game_over';
                io.to(roomCode).emit('game_over', { winner, players: room.players });
                return;
            }

            // Next round
            setTimeout(() => {
                room.phase = 'night_werewolf';
                io.to(roomCode).emit('phase_change', { phase: 'night_werewolf', message: "Night falls again. The werewolf is waking up..." });
                triggerBots(roomCode);
            }, 5000);
            break;
    }
}

// Bot logic dispatcher
function triggerBots(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    room.players.forEach(p => {
        if (p.isBot && p.alive) {
            setTimeout(() => {
                if (rooms[roomCode].phase !== room.phase) return; // phase changed
                
                const aliveTarget = room.players.find(t => t.alive && t.id !== p.id)?.id;
                const deadTarget = room.players.find(t => !t.alive && t.id !== p.id)?.id;
                
                if (room.phase === 'night_werewolf' && p.role === 'werewolf') {
                    // Werewolf bot kills random alive person
                    const targets = room.players.filter(t => t.alive && t.id !== p.id);
                    if (targets.length > 0) {
                        const target = targets[Math.floor(Math.random() * targets.length)];
                        handleAction(roomCode, p.id, 'werewolf', target.id);
                    }
                } else if (room.phase === 'night_healer' && p.role === 'healer') {
                    // Healer bot revives random person (dead or alive)
                    const targets = room.players;
                    const target = targets[Math.floor(Math.random() * targets.length)];
                    handleAction(roomCode, p.id, 'healer', target.id);
                } else if (room.phase === 'day_guard' && p.role === 'guard' && !p.alive) {
                    // Guard bot just died, takes someone down
                    const targets = room.players.filter(t => t.alive);
                    if (targets.length > 0) {
                        const target = targets[Math.floor(Math.random() * targets.length)];
                        handleAction(roomCode, p.id, 'guard', target.id);
                    }
                } else if (room.phase === 'day_voting') {
                    // All bots vote
                    const targets = room.players.filter(t => t.alive && t.id !== p.id);
                    if (targets.length > 0) {
                        const target = targets[Math.floor(Math.random() * targets.length)];
                        handleVote(roomCode, p.id, target.id);
                    }
                }
            }, Math.random() * 3000 + 1000); // 1-4 seconds delay
        }
    });
}

function handleAction(roomCode, playerId, role, targetId) {
    const room = rooms[roomCode];
    if (!room) return;
    
    room.nightActions[`${role}Target`] = targetId;
    processPhase(roomCode);
}

function handleVote(roomCode, playerId, targetId) {
    const room = rooms[roomCode];
    if (!room) return;
    
    room.votes[playerId] = targetId;
    
    // Check if everyone alive has voted
    const aliveCount = room.players.filter(p => p.alive).length;
    if (Object.keys(room.votes).length >= aliveCount) {
        processPhase(roomCode);
    }
}


io.on('connection', (socket) => {
    socket.on('join_room', ({ roomCode, playerName }) => {
        socket.join(roomCode);
        
        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                id: roomCode,
                players: [],
                phase: 'lobby',
                nightActions: {},
                votes: {},
                host: socket.id
            };
        }

        const room = rooms[roomCode];
        
        if (room.players.length >= MAX_PLAYERS) {
            socket.emit('error', 'Room is full');
            return;
        }
        
        if (room.phase !== 'lobby') {
            socket.emit('error', 'Game already in progress');
            return;
        }

        const newPlayer = { id: socket.id, name: playerName || `Player_${socket.id.substring(0,4)}`, isBot: false, alive: true };
        room.players.push(newPlayer);
        
        io.to(roomCode).emit('room_update', { players: room.players, host: room.host });
    });

    socket.on('start_game', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.host !== socket.id || room.phase !== 'lobby') return;

        // Fill with bots
        let botIndex = 0;
        while (room.players.length < MAX_PLAYERS) {
            room.players.push({
                id: `bot_${Math.random().toString(36).substr(2, 9)}`,
                name: BOTS[botIndex % BOTS.length],
                isBot: true,
                alive: true
            });
            botIndex++;
        }

        // Assign Roles
        const shuffledRoles = shuffle([...ROLES].slice(0, room.players.length));
        room.players.forEach((p, i) => {
            p.role = shuffledRoles[i];
        });

        // Send roles to clients
        room.players.forEach(p => {
            if (!p.isBot) {
                io.to(p.id).emit('game_start', { 
                    role: p.role, 
                    players: room.players.map(pl => ({ id: pl.id, name: pl.name, alive: pl.alive })) 
                });
            }
        });

        processPhase(roomCode);
    });

    socket.on('night_action', ({ roomCode, targetId }) => {
        const room = rooms[roomCode];
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.alive && player.role !== 'guard') return;
        
        if (room.phase === 'night_werewolf' && player.role === 'werewolf') {
            handleAction(roomCode, socket.id, 'werewolf', targetId);
        } else if (room.phase === 'night_healer' && player.role === 'healer') {
            handleAction(roomCode, socket.id, 'healer', targetId);
        } else if (room.phase === 'day_guard' && player.role === 'guard' && !player.alive) {
            handleAction(roomCode, socket.id, 'guard', targetId);
        }
    });

    socket.on('vote', ({ roomCode, targetId }) => {
        const room = rooms[roomCode];
        if (!room || room.phase !== 'day_voting') return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.alive) return;

        handleVote(roomCode, socket.id, targetId);
    });

    socket.on('disconnect', () => {
        // Handle disconnect - For simplicity, if someone disconnects during a game, they just die
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                if (room.phase === 'lobby') {
                    room.players.splice(playerIndex, 1);
                    if (room.players.length === 0) {
                        delete rooms[roomCode];
                    } else {
                        if (room.host === socket.id) room.host = room.players[0].id;
                        io.to(roomCode).emit('room_update', { players: room.players, host: room.host });
                    }
                } else {
                    room.players[playerIndex].alive = false;
                    io.to(roomCode).emit('night_result', { message: `${room.players[playerIndex].name} disconnected and died.`, deadPlayers: room.players.filter(p => !p.alive).map(p => p.id) });
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
