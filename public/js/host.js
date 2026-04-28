(() => {
  

  const socket = io({ maxHttpBufferSize: 1e8 });
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = sanitizeRoomId(urlParams.get("room"));
  const defaultMusicUrl = "https://music.rubbersoul.uk/#/party";
  const initialMusicUrl = urlParams.get("music") || localStorage.getItem("coincoin_music_url") || defaultMusicUrl;
  const initialLyricsOffsetMs = clampLyricsOffset(
    Number.parseInt(localStorage.getItem("coincoin_lyrics_offset_ms") || "0", 10)
  );

  const roomCodeEl = document.getElementById("roomCode");
  const hostConnectionBadgeEl = document.getElementById("hostConnectionBadge");
  const cameraCountBadgeEl = document.getElementById("cameraCountBadge");
  const cameraGridEl = document.getElementById("cameraGrid");
  const emptyStateEl = document.getElementById("emptyState");
  const projectionModeBtn = document.getElementById("projectionModeBtn");
  const fullscreenBtn = document.getElementById("fullscreenBtn");
  const clearFocusBtn = document.getElementById("clearFocusBtn");
  const overlayLayerEl = document.getElementById("overlayLayer");
  const overlayListEl = document.getElementById("overlayList");
  const musicFormEl = document.getElementById("musicForm");
  const musicUrlInputEl = document.getElementById("musicUrlInput");
  const lyricsOffsetRangeEl = document.getElementById("lyricsOffsetRange");
  const lyricsOffsetValueEl = document.getElementById("lyricsOffsetValue");
  const musicFrameEl = document.getElementById("musicFrame");

  
  const cameraTiles = new Map();
  const activeOverlays = new Map();
  const overlayCatalog = new Map();
  const videoHealthTimeoutMs = 8000;

  let focusedCameraId = null;
  let lyricsOffsetMs = initialLyricsOffsetMs;

  roomCodeEl.textContent = roomId;

  bootstrapViewModeControls();
  bootstrapLyricsSyncControls();
  bootstrapMusicInput();
  loadOverlayManifest();
  

  socket.on("connect", () => {
    setHostStatus("Signaling connected", false);
    socket.emit("register-host", { roomId });
  });

  socket.on("disconnect", () => {
    setHostStatus("Signaling offline", true);
  });

  socket.on("connect_error", () => {
    setHostStatus("Connection failed", true);
  });

  socket.on("host-registered", ({ cameras = [] } = {}) => {
    setHostStatus(`Host live in room ${roomId}`, false);
    updateCameraCount(cameras.length);
  });

  socket.on("existing-cameras", ({ cameras = [] } = {}) => {
    cameras.forEach((camera) => {
      void upsertCamera(camera);
    });
  });

  socket.on("camera-joined", (camera) => {
    void upsertCamera(camera);
  });

  socket.on("camera-left", ({ cameraId } = {}) => {
    removeCamera(cameraId);
  });

  

  socket.on("host-replaced", () => {
    setHostStatus("Another host took this room", true);
  });

  clearFocusBtn.addEventListener("click", () => {
    focusedCameraId = null;
    applyFocusMode();
  });

  projectionModeBtn.addEventListener("click", () => {
    const willEnable = !document.body.classList.contains("projection-mode");
    setProjectionMode(willEnable);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !document.body.classList.contains("projection-mode")) {
      return;
    }

    event.preventDefault();
    setProjectionMode(false);

    if (document.fullscreenElement) {
      void document.exitFullscreen().catch((error) => {
        console.warn("Could not exit fullscreen after leaving projection mode:", error);
      });
    }
  });

  fullscreenBtn.addEventListener("click", () => {
    void toggleFullscreen();
  });

  document.addEventListener("fullscreenchange", () => {
    syncFullscreenButtonLabel();
  });

  musicFormEl.addEventListener("submit", (event) => {
    event.preventDefault();
    const rawUrl = String(musicUrlInputEl.value || "").trim();
    applyMusicUrl(rawUrl);
  });

  function sanitizeRoomId(value) {
    const normalized = String(value || "")
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 64);

    return normalized || "coincoin-party";
  }

  function sanitizeLabel(value, fallback = "Camera") {
    const normalized = String(value || "")
      .trim()
      .replace(/[^a-zA-Z0-9 _-]/g, "")
      .slice(0, 32);

    return normalized || fallback;
  }

  function clampLyricsOffset(value) {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(-5000, Math.min(5000, Math.trunc(value)));
  }

  function bootstrapViewModeControls() {
    setProjectionMode(false);
    syncFullscreenButtonLabel();
  }

  function setProjectionMode(enabled) {
    document.body.classList.toggle("projection-mode", Boolean(enabled));
    projectionModeBtn.textContent = enabled ? "Edit mode" : "Projection mode";
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.warn("Fullscreen request failed:", error);
    }
  }

  function syncFullscreenButtonLabel() {
    fullscreenBtn.textContent = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
  }

  function bootstrapLyricsSyncControls() {
    lyricsOffsetRangeEl.value = String(lyricsOffsetMs);
    updateLyricsOffsetLabel();

    lyricsOffsetRangeEl.addEventListener("input", () => {
      lyricsOffsetMs = clampLyricsOffset(Number.parseInt(lyricsOffsetRangeEl.value || "0", 10));
      lyricsOffsetRangeEl.value = String(lyricsOffsetMs);
      localStorage.setItem("coincoin_lyrics_offset_ms", String(lyricsOffsetMs));
      updateLyricsOffsetLabel();
      dispatchLyricsOffset();
    });

    musicFrameEl.addEventListener("load", () => {
      dispatchLyricsOffset();
    });
  }

  function updateLyricsOffsetLabel() {
    const prefix = lyricsOffsetMs > 0 ? "+" : "";
    lyricsOffsetValueEl.textContent = `${prefix}${lyricsOffsetMs} ms`;
  }

  function dispatchLyricsOffset() {
    if (!musicFrameEl.contentWindow || musicFrameEl.src === "about:blank") {
      return;
    }

    musicFrameEl.contentWindow.postMessage(
      {
        type: "coincoin:set-lyrics-offset-ms",
        value: lyricsOffsetMs,
      },
      "*"
    );
  }

  function setHostStatus(text, isError) {
    hostConnectionBadgeEl.textContent = text;
    hostConnectionBadgeEl.style.borderColor = isError
      ? "rgba(255, 79, 115, 0.55)"
      : "rgba(255, 255, 255, 0.08)";
  }

  function updateCameraCount(count) {
    cameraCountBadgeEl.textContent = `${count} camera${count > 1 ? "s" : ""}`;
  }

  function resolveColumns(count) {
    if (count <= 1) {
      return 1;
    }
    if (count === 2) {
      return 2;
    }
    if (count <= 4) {
      return 2;
    }
    if (count <= 9) {
      return 3;
    }

    return 4;
  }

  function updateGridState() {
    const count = cameraTiles.size;
    cameraGridEl.dataset.count = String(count);
    cameraGridEl.style.setProperty("--camera-columns", String(resolveColumns(count)));
    emptyStateEl.hidden = count > 0;
    updateCameraCount(count);
  }

  function setTileState(cameraId, state, message) {
    const tileRef = cameraTiles.get(cameraId);
    if (!tileRef) {
      return;
    }

    tileRef.tile.dataset.linkState = state;
    tileRef.stateLabel.textContent = message;
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

  function hasPlayableVideo(video) { return !!video.src; }

  function clearHealthCheck(cameraId) {
    const tileRef = cameraTiles.get(cameraId);
    if (!tileRef || !tileRef.healthTimeoutId) {
      return;
    }

    window.clearTimeout(tileRef.healthTimeoutId);
    tileRef.healthTimeoutId = null;
  }

  function scheduleHealthCheck(cameraId) {
    const tileRef = cameraTiles.get(cameraId);
    if (!tileRef) {
      return;
    }

    clearHealthCheck(cameraId);

    tileRef.healthTimeoutId = window.setTimeout(() => {
      const currentTile = cameraTiles.get(cameraId);
      if (!currentTile || hasPlayableVideo(currentTile.video)) {
        return;
      }

      if (currentTile.restartAttempts < 1) {
        currentTile.restartAttempts += 1;
        setTileState(cameraId, "pending", "Retrying stream");
        void restartIce(cameraId);
        scheduleHealthCheck(cameraId);
        return;
      }

      setTileState(cameraId, "error", "No video");
    }, videoHealthTimeoutMs);
  }

  function applyFocusMode() {
    const hasFocus = Boolean(focusedCameraId) && cameraTiles.has(focusedCameraId);

    if (!hasFocus) {
      focusedCameraId = null;
    }

    cameraGridEl.classList.toggle("focus-mode", hasFocus);
    clearFocusBtn.disabled = !hasFocus;

    cameraTiles.forEach(({ tile }, cameraId) => {
      tile.classList.toggle("is-focused", hasFocus && cameraId === focusedCameraId);
    });
  }

  function toggleFocus(cameraId) {
    focusedCameraId = focusedCameraId === cameraId ? null : cameraId;
    applyFocusMode();
  }

  function createCameraTile(cameraId, label) {
    const tile = document.createElement("article");
    tile.className = "camera-tile";
    tile.dataset.cameraId = cameraId;
    tile.dataset.linkState = "pending";
    tile.style.setProperty("--stagger", `${Math.min(cameraTiles.size * 55, 340)}ms`);

    const video = document.createElement("img");
    video.className = "camera-view";
    video.style.objectFit = "cover";
    video.style.width = "100%";
    video.style.height = "100%";
    
    video.addEventListener("error", () => {
      setTileState(cameraId, "error", "Video error");
    });

    const hud = document.createElement("div");
    hud.className = "camera-hud";

    const nameLabel = document.createElement("span");
    nameLabel.className = "camera-name";
    nameLabel.textContent = sanitizeLabel(label, `Camera-${cameraId.slice(0, 4)}`);

    const stateLabel = document.createElement("span");
    stateLabel.className = "camera-state";

    const stateDot = document.createElement("span");
    stateDot.className = "state-dot";

    const stateText = document.createElement("span");
    stateText.textContent = "Waiting for stream";

    stateLabel.append(stateDot, stateText);
    hud.append(nameLabel, stateLabel);

    tile.append(video, hud);

    tile.addEventListener("click", () => {
      toggleFocus(cameraId);
    });

    cameraGridEl.append(tile);

    cameraTiles.set(cameraId, {
      tile,
      video,
      remoteStream: null,
      healthTimeoutId: null,
      restartAttempts: 0,
      nameLabel,
      stateLabel: stateText,
    });

    setTileState(cameraId, "pending", "Connecting");
    updateGridState();
    applyFocusMode();
  }

  async function upsertCamera(camera) {
    if (!camera || !camera.cameraId) {
      return;
    }

    const cameraId = camera.cameraId;
    const safeLabel = sanitizeLabel(camera.label, `Camera-${cameraId.slice(0, 4)}`);

    if (!cameraTiles.has(cameraId)) {
      createCameraTile(cameraId, safeLabel);
    } else {
      cameraTiles.get(cameraId).nameLabel.textContent = safeLabel;
    }

    setTileState(cameraId, "ready", "Attente de flux");
  }

  function removeCamera(cameraId) {
    if (!cameraTiles.has(cameraId)) {
      return;
    }

    clearHealthCheck(cameraId);

    

    const tileRef = cameraTiles.get(cameraId);
    const stream = null;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    tileRef.tile.remove();
    cameraTiles.delete(cameraId);

    if (focusedCameraId === cameraId) {
      focusedCameraId = null;
    }

    updateGridState();
    applyFocusMode();
  }

  async function loadOverlayManifest() {
    try {
      const response = await fetch("/overlays/manifest.json", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Manifest HTTP ${response.status}`);
      }

      const payload = await response.json();
      const overlays = Array.isArray(payload.overlays) ? payload.overlays : [];

      overlayListEl.innerHTML = "";
      overlayCatalog.clear();

      overlays.forEach((overlay) => {
        if (!overlay || !overlay.id || !overlay.src) {
          return;
        }

        overlayCatalog.set(overlay.id, overlay);

        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "overlay-chip";
        chip.textContent = overlay.label || overlay.id;
        chip.dataset.overlayId = overlay.id;

        chip.addEventListener("click", () => {
          const isActive = activeOverlays.has(overlay.id);
          if (isActive) {
            deactivateOverlay(overlay.id);
            chip.classList.remove("active");
            chip.classList.remove("is-missing");
            return;
          }

          const success = activateOverlay(overlay);
          if (success) {
            chip.classList.add("active");
            chip.classList.remove("is-missing");
          } else {
            chip.classList.add("is-missing");
          }
        });

        overlayListEl.append(chip);
      });

      if (!overlayCatalog.size) {
        overlayListEl.innerHTML = "<span class='small-note'>No overlays in manifest</span>";
      }
    } catch (error) {
      console.warn("Overlay manifest not loaded:", error);
      overlayListEl.innerHTML = "<span class='small-note'>Cannot read /overlays/manifest.json</span>";
    }
  }

  function activateOverlay(overlay) {
    if (!overlay || !overlay.id || !overlay.src) {
      return false;
    }

    const image = document.createElement("img");
    image.className = "overlay-image";
    image.src = overlay.src;
    image.alt = overlay.label || overlay.id;

    const position = overlay.position || {};
    const allowedKeys = ["top", "left", "right", "bottom", "width", "height", "opacity"];

    allowedKeys.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(position, key)) {
        image.style[key] = String(position[key]);
      }
    });

    if (!image.style.top && !image.style.bottom) {
      image.style.top = "0";
    }

    if (!image.style.left && !image.style.right) {
      image.style.left = "0";
    }

    if (!image.style.width && !image.style.height) {
      image.style.width = "100%";
      image.style.height = "100%";
    }

    image.addEventListener("error", () => {
      const chip = overlayListEl.querySelector(`[data-overlay-id='${overlay.id}']`);
      if (chip) {
        chip.classList.remove("active");
        chip.classList.add("is-missing");
      }
      deactivateOverlay(overlay.id);
    });

    overlayLayerEl.append(image);
    activeOverlays.set(overlay.id, image);

    return true;
  }

  function deactivateOverlay(overlayId) {
    const image = activeOverlays.get(overlayId);
    if (image) {
      image.remove();
    }
    activeOverlays.delete(overlayId);
  }

  function normalizeMusicUrl(raw) {
    const value = String(raw || "").trim();

    if (!value) {
      return "about:blank";
    }

    if (/^https?:\/\//i.test(value) || value.startsWith("/")) {
      return value;
    }

    if (/^[\w.-]+\.[a-z]{2,}/i.test(value)) {
      return `https://${value}`;
    }

    return "about:blank";
  }

  function buildMusicFrameUrl(baseUrl) {
    if (baseUrl === "about:blank") {
      return baseUrl;
    }

    try {
      const parsed = new URL(baseUrl, window.location.origin);
      parsed.searchParams.set("lyricsOffsetMs", String(lyricsOffsetMs));
      return parsed.toString();
    } catch (error) {
      console.warn("Could not append lyricsOffsetMs to URL:", error);
      return baseUrl;
    }
  }

  function applyMusicUrl(rawUrl) {
    const safeUrl = normalizeMusicUrl(rawUrl);
    musicFrameEl.src = buildMusicFrameUrl(safeUrl);

    if (safeUrl === "about:blank") {
      localStorage.removeItem("coincoin_music_url");
    } else {
      localStorage.setItem("coincoin_music_url", safeUrl);
    }

    musicUrlInputEl.value = safeUrl === "about:blank" ? "" : safeUrl;
  }

  function bootstrapMusicInput() {
    const safeUrl = normalizeMusicUrl(initialMusicUrl);
    musicUrlInputEl.value = safeUrl === "about:blank" ? "" : safeUrl;
    musicFrameEl.src = buildMusicFrameUrl(safeUrl);
  }
})();
