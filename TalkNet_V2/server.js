const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Simple room structure - just track who's in which room
let rooms = {}; // { roomName: [socketId1, socketId2, ...] }
let socketToRoom = {}; // { socketId: roomName }

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('join_room', (roomName) => {
        console.log(`Socket ${socket.id} joining room ${roomName}`);

        // Initialize room if needed
        if (!rooms[roomName]) {
            rooms[roomName] = [];
        }
        
        // Add socket to room
        rooms[roomName].push(socket.id);
        socketToRoom[socket.id] = roomName;
        socket.join(roomName);

        // Get other peers in the room
        const otherPeers = rooms[roomName].filter(id => id !== socket.id);
        
        // Send existing peers to the new user
        socket.emit('existing_peers', otherPeers);

        // Notify others about new user
        socket.to(roomName).emit('user_joined', socket.id);

        // Signaling
        socket.on('offer', (payload) => {
            io.to(payload.target).emit('offer', {
                sdp: payload.sdp,
                sender: socket.id
            });
        });

        socket.on('answer', (payload) => {
            io.to(payload.target).emit('answer', {
                sdp: payload.sdp,
                sender: socket.id
            });
        });

        socket.on('ice_candidate', (payload) => {
            io.to(payload.target).emit('ice_candidate', {
                candidate: payload.candidate,
                sender: socket.id
            });
        });

        // Handle disconnect
        socket.on('disconnect', () => {
            const room = socketToRoom[socket.id];
            if (room && rooms[room]) {
                rooms[room] = rooms[room].filter(id => id !== socket.id);
                delete socketToRoom[socket.id];
                socket.to(room).emit('user_left', socket.id);
                
                if (rooms[room].length === 0) {
                    delete rooms[room];
                }
            }
        });
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});