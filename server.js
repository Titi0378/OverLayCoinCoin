const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: 1e8 // Permettre l'envoi de frames volumineuses
});

const PORT = Number(process.env.PORT || 3000);
const rooms = new Map();

function sanitizeRoomId(value) {
  const normalized = String(value || "")
    .trim()
    .slice(0, 64)
    .replace(/[^a-zA-Z0-9_-]/g, "");

  return normalized || "coincoin-party";
}

function sanitizeLabel(value, fallback = "Camera") {
  const normalized = String(value || "")
    .trim()
    .slice(0, 32)
    .replace(/[^a-zA-Z0-9 _-]/g, "");

  return normalized || fallback;
}

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      hostId: null,
      cameras: new Map(),
    });
  }

  return rooms.get(roomId);
}

function cleanRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  if (!room.hostId && room.cameras.size === 0) {
    rooms.delete(roomId);
  }
}

function releaseSocketRole(socket, notify = true) {
  const role = socket.data.role;
  const roomId = socket.data.roomId;

  if (!role || !roomId) {
    return;
  }

  const room = rooms.get(roomId);

  if (!room) {
    socket.data.role = null;
    socket.data.roomId = null;
    socket.data.label = null;
    return;
  }

  if (role === "host" && room.hostId === socket.id) {
    room.hostId = null;
    if (notify) {
      io.to(roomId).emit("host-left", { roomId });
    }
  }

  if (role === "camera" && room.cameras.has(socket.id)) {
    room.cameras.delete(socket.id);
    if (notify && room.hostId) {
      io.to(room.hostId).emit("camera-left", {
        cameraId: socket.id,
      });
    }
  }

  socket.leave(roomId);

  socket.data.role = null;
  socket.data.roomId = null;
  socket.data.label = null;

  cleanRoom(roomId);
}

io.on("connection", (socket) => {
  socket.data.role = null;
  socket.data.roomId = null;
  socket.data.label = null;

  socket.on("register-host", ({ roomId } = {}) => {
    const safeRoomId = sanitizeRoomId(roomId);

    releaseSocketRole(socket, false);

    const room = getOrCreateRoom(safeRoomId);

    if (room.hostId && room.hostId !== socket.id) {
      const previousHost = io.sockets.sockets.get(room.hostId);
      if (previousHost) {
        previousHost.emit("host-replaced", { roomId: safeRoomId });
        previousHost.disconnect(true);
      }
    }

    room.hostId = socket.id;

    socket.join(safeRoomId);
    socket.data.role = "host";
    socket.data.roomId = safeRoomId;

    const cameras = [...room.cameras.entries()].map(([cameraId, metadata]) => ({
      cameraId,
      label: metadata.label,
    }));

    socket.emit("host-registered", {
      roomId: safeRoomId,
      cameras,
    });

    socket.emit("existing-cameras", {
      roomId: safeRoomId,
      cameras,
    });

    io.to(safeRoomId).emit("host-ready", {
      roomId: safeRoomId,
    });
  });

  socket.on("register-camera", ({ roomId, label } = {}) => {
    const safeRoomId = sanitizeRoomId(roomId);
    const safeLabel = sanitizeLabel(label, `Camera-${socket.id.slice(0, 4)}`);

    releaseSocketRole(socket, false);

    const room = getOrCreateRoom(safeRoomId);

    room.cameras.set(socket.id, {
      label: safeLabel,
    });

    socket.join(safeRoomId);
    socket.data.role = "camera";
    socket.data.roomId = safeRoomId;
    socket.data.label = safeLabel;

    socket.emit("camera-registered", {
      roomId: safeRoomId,
      cameraId: socket.id,
      label: safeLabel,
    });

    if (room.hostId) {
      io.to(room.hostId).emit("camera-joined", {
        cameraId: socket.id,
        label: safeLabel,
      });
    } else {
      socket.emit("waiting-host", { roomId: safeRoomId });
    }
  });

  socket.on("video-frame", ({ roomId, frame } = {}) => {
    if (socket.data.role !== "camera") return;
    const safeRoomId = sanitizeRoomId(roomId);
    const room = rooms.get(safeRoomId);
    if (!room || !room.hostId || !frame) return;

    // Transmettre la frame à l'hôte
    io.to(room.hostId).emit("video-frame", {
      cameraId: socket.id,
      frame,
    });
  });

  socket.on("disconnect", () => {
    releaseSocketRole(socket, true);
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

app.use(express.static(path.join(__dirname, "public")));

server.listen(PORT, () => {
  console.log(`Coincoin control room started on http://localhost:${PORT}`);
});
