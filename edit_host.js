const fs = require('fs');

let hostJs = fs.readFileSync('public/js/host.js', 'utf8');

// remove rtcConfig
hostJs = hostJs.replace(/const defaultRtcConfig = \{[\s\S]+?let rtcConfigPromise = null;/g, '');
hostJs = hostJs.replace(/void ensureRtcConfig\(\);/g, '');
hostJs = hostJs.replace(/async function loadRtcConfig\(\) \{[\s\S]+?return rtcConfigPromise;\n  \}/g, '');

// update socket initialization
hostJs = hostJs.replace(/const socket = io\(\);/g, 'const socket = io({ maxHttpBufferSize: 1e8 });');

// Update createCameraTile to use img instead of video
hostJs = hostJs.replace(/const video = document\.createElement\("video"\);[\s\S]+?const overlayWrapper = document\.createElement\("div"\);/g, `const video = document.createElement("img");
    video.className = "camera-view";
    video.style.objectFit = "cover";
    video.style.width = "100%";
    video.style.height = "100%";
    
    const overlayWrapper = document.createElement("div");`);

// update video validation (hasPlayableVideo will just check if src is truthy)
hostJs = hostJs.replace(/function hasPlayableVideo\(video\) \{[\s\S]+?\}/g, 'function hasPlayableVideo(video) { return !!video.src; }');
  
// Replace WebRTC socket events with video-frame handler
const webrtcEventsRegex = /socket\.on\("camera-joined", async \(\{ cameraId, label \} = \{\}\) => \{[\s\S]+?socket\.on\("camera-left"/;

hostJs = hostJs.replace(webrtcEventsRegex, `socket.on("camera-joined", ({ cameraId, label } = {}) => {
    createCameraTile(cameraId, label);
  });

  socket.on("video-frame", ({ cameraId, frame }) => {
    const tile = cameraTiles.get(cameraId);
    if (!tile) return;
    
    tile.video.src = frame;
    setTileState(cameraId, "ready", "");
  });

  socket.on("camera-left"`);

hostJs = hostJs.replace(/socket\.on\("camera-answer"[\s\S]+?socket\.on\("ice-candidate-to-host"[\s\S]+?\}\);/g, '');

// Remove peer creation logic
hostJs = hostJs.replace(/function getOrCreatePeer\([\s\S]+?(?=\n\n  function bootstrapViewModeControls)/, '');

fs.writeFileSync('public/js/host.js', hostJs);
console.log("host.js modification complete");
