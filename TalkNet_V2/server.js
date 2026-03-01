import dotenv from "dotenv";
dotenv.config();

import express from "express";
import http from "http";
import { Server as SocketIo } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

// Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

const io = new SocketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// Room structures
let rooms = {};
let socketToRoom = {};

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on("join_room", ({ roomName, userName }) => {
    if (!roomName || !userName) {
      socket.emit("join_error", "Missing room name or user name.");
      return;
    }

    if (!rooms[roomName]) rooms[roomName] = {};

    rooms[roomName][socket.id] = {
      muted: false,
      videoOff: false,
      name: userName,
    };

    socketToRoom[socket.id] = roomName;
    socket.join(roomName);

    // Send existing peers
    const otherPeers = {};
    for (const id in rooms[roomName]) {
      if (id !== socket.id) {
        otherPeers[id] = rooms[roomName][id];
      }
    }

    socket.emit("existing_peers", otherPeers);

    // Notify others
    socket.to(roomName).emit("user_joined", {
      peerId: socket.id,
      userName,
      status: rooms[roomName][socket.id],
    });

    // ---- WebRTC Signaling ----
    socket.on("offer", ({ target, sdp }) => {
      io.to(target).emit("offer", { sender: socket.id, sdp });
    });

    socket.on("answer", ({ target, sdp }) => {
      io.to(target).emit("answer", { sender: socket.id, sdp });
    });

    socket.on("ice_candidate", ({ target, candidate }) => {
      if (target !== socket.id) {
        io.to(target).emit("ice_candidate", {
          sender: socket.id,
          candidate,
        });
      }
    });

    // ---- Status Update ----
    socket.on("update_status", (statusUpdate) => {
      const room = socketToRoom[socket.id];
      if (!room || !rooms[room]) return;

      Object.assign(rooms[room][socket.id], statusUpdate);

      socket.to(room).emit("peer_status_update", {
        peerId: socket.id,
        status: statusUpdate,
      });
    });

    // ---- Chat ----
    socket.on("chat_message", (message) => {
      const room = socketToRoom[socket.id];
      if (!room || !rooms[room]) return;

      const senderName = rooms[room][socket.id].name;
      const cleanMessage = String(message).trim();

      if (cleanMessage) {
        io.to(room).emit("chat_message", {
          senderId: socket.id,
          senderName,
          message: cleanMessage,
        });
      }
    });

    // ---- Leave / Disconnect ----
    const cleanUp = () => {
      const room = socketToRoom[socket.id];
      if (!room || !rooms[room]) return;

      delete rooms[room][socket.id];
      delete socketToRoom[socket.id];

      socket.leave(room);
      socket.to(room).emit("user_left", socket.id);

      if (Object.keys(rooms[room]).length === 0) {
        delete rooms[room];
      }
    };

    socket.on("leave_room", cleanUp);
    socket.on("disconnect", cleanUp);
  });

  socket.on("error", (err) => {
    console.error(`Socket error: ${err}`);
  });
});

// Serve index.html fallback
app.get("/*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

server.listen(PORT, () => {
  console.log(`Signaling server listening on *:${PORT}`);
});