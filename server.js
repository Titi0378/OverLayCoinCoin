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
});

const PORT = Number(process.env.PORT || 3000);
const rooms = new Map();
const DEFAULT_ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
];

function parseCsvEnv(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildRtcConfig() {
  const iceServers = [...DEFAULT_ICE_SERVERS];
  const turnUrls = parseCsvEnv(process.env.TURN_URLS);
  const hasTurn = turnUrls.length > 0;

  if (hasTurn) {
    const turnServer = {
      urls: turnUrls,
    };

    if (process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
      turnServer.username = process.env.TURN_USERNAME;
      turnServer.credential = process.env.TURN_CREDENTIAL;
    }

    iceServers.push(turnServer);
  }

  const poolSize = Number.parseInt(process.env.ICE_CANDIDATE_POOL_SIZE || "10", 10);
  const iceCandidatePoolSize = Number.isFinite(poolSize) && poolSize > 0 ? poolSize : 10;
  const requestedPolicy = process.env.ICE_TRANSPORT_POLICY === "relay" ? "relay" : "all";
  const iceTransportPolicy = hasTurn ? requestedPolicy : "all";

  return {
    iceServers,
    iceCandidatePoolSize,
    iceTransportPolicy,
  };
}

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

  socket.on("host-offer", ({ cameraId, sdp } = {}) => {
    if (socket.data.role !== "host") {
      return;
    }

    const room = rooms.get(socket.data.roomId || "");
    if (!room || !room.cameras.has(cameraId) || !sdp) {
      return;
    }

    io.to(cameraId).emit("host-offer", {
      sdp,
    });
  });

  socket.on("camera-answer", ({ sdp } = {}) => {
    if (socket.data.role !== "camera") {
      return;
    }

    const room = rooms.get(socket.data.roomId || "");
    if (!room || !room.hostId || !sdp) {
      return;
    }

    io.to(room.hostId).emit("camera-answer", {
      cameraId: socket.id,
      sdp,
    });
  });

  socket.on("ice-candidate-to-camera", ({ cameraId, candidate } = {}) => {
    if (socket.data.role !== "host") {
      return;
    }

    const room = rooms.get(socket.data.roomId || "");
    if (!room || !room.cameras.has(cameraId) || !candidate) {
      return;
    }

    io.to(cameraId).emit("ice-candidate-to-camera", {
      candidate,
    });
  });

  socket.on("ice-candidate-to-host", ({ candidate } = {}) => {
    if (socket.data.role !== "camera") {
      return;
    }

    const room = rooms.get(socket.data.roomId || "");
    if (!room || !room.hostId || !candidate) {
      return;
    }

    io.to(room.hostId).emit("ice-candidate-to-host", {
      cameraId: socket.id,
      candidate,
    });
  });

  socket.on("disconnect", () => {
    releaseSocketRole(socket, true);
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

app.get("/rtc-config", (_req, res) => {
  res.json(buildRtcConfig());
});

app.use(express.static(path.join(__dirname, "public")));

server.listen(PORT, () => {
  console.log(`Coincoin control room started on http://localhost:${PORT}`);
});
