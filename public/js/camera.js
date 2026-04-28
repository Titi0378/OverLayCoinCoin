(() => {
  const socket = io({
    maxHttpBufferSize: 1e8
  });
  const urlParams = new URLSearchParams(window.location.search);

  const roomId = sanitizeRoomId(urlParams.get("room"));
  const cameraLabel = sanitizeLabel(urlParams.get("label"), `Camera-${Math.random().toString(36).slice(2, 6)}`);

  const roomCodeEl = document.getElementById("roomCode");
  const cameraNameEl = document.getElementById("cameraName");
  const localVideoEl = document.getElementById("localVideo");
  const cameraStatusEl = document.getElementById("cameraStatus");
  const signalStatusEl = document.getElementById("signalStatus");
  const switchCameraBtn = document.getElementById("switchCameraBtn");
  const permissionGateEl = document.getElementById("permissionGate");
  const permissionHintEl = document.getElementById("permissionHint");
  const enableCameraBtn = document.getElementById("enableCameraBtn");

  let localStream = null;
  let sendInterval = null;
  let currentFacingMode = "environment";
  let preparingMediaPromise = null;
  let isSocketConnected = false;
  let isRegistered = false;
  let hasLocalMedia = false;

  const secureMediaContext = window.isSecureContext || isLoopbackHostname(window.location.hostname);

  roomCodeEl.textContent = roomId;
  cameraNameEl.textContent = cameraLabel;

  if (!secureMediaContext) {
    setPermissionHint(
      "Camera on another device needs HTTPS (or localhost). Use an HTTPS tunnel like ngrok or Cloudflare.",
      true
    );
    setCameraStatus("Non-secure context detected", true);
  } else {
    setPermissionHint('Click "Enable camera" then accept browser permission.', false);
    setCameraStatus("Waiting for camera permission", false);
  }

  setSignalStatus("Connecting signaling...", false);
  showPermissionGate();

  socket.on("connect", () => {
    isSocketConnected = true;
    isRegistered = false;
    setSignalStatus("Signaling connected", false);
    maybeRegisterCamera();
  });

  socket.on("disconnect", async () => {
    isSocketConnected = false;
    isRegistered = false;
    setSignalStatus("Signaling offline", true);
    setCameraStatus("Disconnected from signaling", true);
    await closePeer();
  });

  socket.on("camera-registered", () => {
    isRegistered = true;
    setCameraStatus("Camera ready. Waiting for host", false);
  });

  socket.on("waiting-host", () => {
    setCameraStatus("Waiting for host dashboard", false);
  });

  socket.on("host-ready", () => {
    setCameraStatus("Host online. Starting to stream", false);
    startStreaming();
  });

  socket.on("host-left", async () => {
    setCameraStatus("Host disconnected", true);
    stopStreaming();
  });

  enableCameraBtn.addEventListener("click", async () => {
    await requestCameraAccess();
  });

  switchCameraBtn.addEventListener("click", async () => {
    if (!hasLocalMedia) {
      await requestCameraAccess();
      return;
    }

    const nextFacing = currentFacingMode === "environment" ? "user" : "environment";
    try {
      setCameraStatus(`Switching to ${nextFacing} camera`, false);
      currentFacingMode = nextFacing;
      await createOrUpdateLocalStream(currentFacingMode);
      hasLocalMedia = true;
      setCameraStatus(peer ? "Camera switched while streaming" : "Camera switched", false);
    } catch (error) {
      console.error("Could not switch camera:", error);
      currentFacingMode = currentFacingMode === "environment" ? "user" : "environment";
      setCameraStatus("Cannot switch camera", true);
    }
  });

  window.addEventListener("beforeunload", () => {
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }

    if (peer) {
      peer.close();
    }
  });

  function sanitizeRoomId(value) {
    const normalized = String(value || "")
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 64);

    return normalized || "coincoin-party";
  }

  function sanitizeLabel(value, fallback) {
    const normalized = String(value || "")
      .trim()
      .replace(/[^a-zA-Z0-9 _-]/g, "")
      .slice(0, 32);

    return normalized || fallback;
  }

  function setSignalStatus(text, isError) {
    signalStatusEl.textContent = text;
    signalStatusEl.style.borderColor = isError
      ? "rgba(255, 79, 115, 0.55)"
      : "rgba(255, 255, 255, 0.08)";
  }

  function setCameraStatus(text, isError) {
    cameraStatusEl.textContent = text;
    cameraStatusEl.style.borderColor = isError
      ? "rgba(255, 79, 115, 0.55)"
      : "rgba(255, 255, 255, 0.08)";
  }

  function normalizeRtcConfig(payload) {
    if (!payload || !Array.isArray(payload.iceServers)) {
      return defaultRtcConfig;
    }

    const poolSize = Number.parseInt(payload.iceCandidatePoolSize || "10", 10);
    const iceCandidatePoolSize = Number.isFinite(poolSize) && poolSize > 0 ? poolSize : defaultRtcConfig.iceCandidatePoolSize;
    const iceTransportPolicy = payload.iceTransportPolicy === "relay" ? "relay" : "all";

    return {
      iceServers: payload.iceServers,
      iceCandidatePoolSize,
      iceTransportPolicy,
    };
  }

  async function loadRtcConfig() {
    try {
      const response = await fetch("/rtc-config", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`RTC config HTTP ${response.status}`);
      }

      const payload = await response.json();
      rtcConfig = normalizeRtcConfig(payload);
    } catch (error) {
      console.warn("Could not load RTC config:", error);
      rtcConfig = defaultRtcConfig;
    }
  }

  function ensureRtcConfig() {
    if (!rtcConfigPromise) {
      rtcConfigPromise = loadRtcConfig();
    }

    return rtcConfigPromise;
  }

  function isLoopbackHostname(hostname) {
    const safeHostname = String(hostname || "").toLowerCase();
    return safeHostname === "localhost" || safeHostname === "127.0.0.1" || safeHostname === "::1";
  }

  function setPermissionHint(text, isError) {
    permissionHintEl.textContent = text;
    permissionHintEl.classList.toggle("is-error", Boolean(isError));
  }

  function showPermissionGate() {
    permissionGateEl.hidden = false;
    switchCameraBtn.disabled = true;
  }

  function hidePermissionGate() {
    permissionGateEl.hidden = true;
    switchCameraBtn.disabled = false;
  }

  function maybeRegisterCamera() {
    if (!isSocketConnected || !hasLocalMedia || isRegistered) {
      return;
    }

    socket.emit("register-camera", {
      roomId,
      label: cameraLabel,
    });
  }

  function describeMediaError(error) {
    if (!secureMediaContext) {
      return "Camera access blocked: open this page in HTTPS (or localhost) to get browser permission.";
    }

    const name = error && error.name ? error.name : "";

    if (name === "NotAllowedError" || name === "SecurityError") {
      return "Camera access denied. Accept permission in browser settings and retry.";
    }

    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "No camera device found on this phone/computer.";
    }

    if (name === "NotReadableError" || name === "TrackStartError") {
      return "Camera is already used by another app/tab.";
    }

    return "Could not start camera. Retry and check browser camera permissions.";
  }

  async function requestCameraAccess() {
    enableCameraBtn.disabled = true;
    setCameraStatus("Requesting camera permission", false);

    try {
      await ensureMedia();
      hasLocalMedia = true;
      hidePermissionGate();
      setPermissionHint("Camera authorized. Stream is ready.", false);
      maybeRegisterCamera();
      setCameraStatus(isRegistered ? "Camera ready. Waiting for host" : "Linking camera to signaling", false);
    } catch (error) {
      hasLocalMedia = false;
      showPermissionGate();
      const message = describeMediaError(error);
      setPermissionHint(message, true);
      setCameraStatus(message, true);
      console.error("Camera permission failed:", error);
    } finally {
      enableCameraBtn.disabled = false;
    }
  }

  async function ensureMedia() {
    if (localStream) {
      return localStream;
    }

    if (!preparingMediaPromise) {
      preparingMediaPromise = createOrUpdateLocalStream(currentFacingMode).finally(() => {
        preparingMediaPromise = null;
      });
    }

    return preparingMediaPromise;
  }

  async function createOrUpdateLocalStream(facingMode) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Media devices not available");
    }

    const constraints = {
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        aspectRatio: { ideal: 16 / 9 },
        frameRate: { ideal: 30, max: 30 },
        facingMode: { ideal: facingMode },
      },
      audio: false,
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);

    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }

    localStream = stream;
    localVideoEl.srcObject = localStream;

    await localVideoEl.play().catch(() => {
      return undefined;
    });

    if (peer) {
      const videoSender = peer
        .getSenders()
        .find((sender) => sender.track && sender.track.kind === "video");
      const nextVideoTrack = localStream.getVideoTracks()[0];

      if (videoSender && nextVideoTrack) {
        await videoSender.replaceTrack(nextVideoTrack);
      }
    }

    setCameraStatus("Camera ready", false);

    return localStream;
  }

  async function rebuildPeer() {
    await ensureRtcConfig();
    await closePeer();

    peer = new RTCPeerConnection(rtcConfig);

    localStream.getTracks().forEach((track) => {
      peer.addTrack(track, localStream);
    });

    peer.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      socket.emit("ice-candidate-to-host", {
        candidate: event.candidate,
      });
    };

    peer.onconnectionstatechange = () => {
      const state = peer.connectionState;

      if (state === "connected") {
        setCameraStatus("Streaming to host", false);
      } else if (state === "connecting") {
        setCameraStatus("Connecting stream", false);
      } else if (state === "disconnected" || state === "failed") {
        setCameraStatus("Stream link lost", true);
      } else if (state === "closed") {
        setCameraStatus("Stream closed", true);
      }
    };
  }

  async function closePeer() {
    if (!peer) {
      return;
    }

    try {
      peer.onicecandidate = null;
      peer.onconnectionstatechange = null;
      peer.close();
    } catch (error) {
      console.warn("Could not close camera peer:", error);
    }

    peer = null;
  }
})();




