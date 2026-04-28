const fs = require('fs');
let hostJs = fs.readFileSync('public/js/host.js', 'utf8');

hostJs = hostJs.replace(/const peers = new Map\(\);\\n/, '');

// Find functions related to webrtc and remove them
hostJs = hostJs.replace(/function getOrCreatePeer\([\\s\\S]*?function closePeer/g, 'function closePeer');
hostJs = hostJs.replace(/function closePeer\([\\s\\S]*?function setTileState/g, 'function setTileState');
hostJs = hostJs.replace(/closePeer\\(cameraId\\);/g, '');

// Update removeCameraTile
hostJs = hostJs.replace(/function removeCameraTile\\(cameraId\\) \\{[\\s\\S]*?\\}/, \unction removeCameraTile(cameraId) {
    const tile = cameraTiles.get(cameraId);
    if (!tile) return;
    tile.wrapper.remove();
    cameraTiles.delete(cameraId);
    toggleEmptyState();
  }\);

hostJs = hostJs.replace(/function rebuildCameraStream\\(cameraId\\) \\{[\\s\\S]*?\\}/, 'function rebuildCameraStream(cameraId) {}');
hostJs = hostJs.replace(/socket\\.on\\("camera-answer"[\\s\\S]*?\\}\\);\\n/g, '');
hostJs = hostJs.replace(/socket\\.on\\("ice-candidate-to-host"[\\s\\S]*?\\}\\);\\n/g, '');

// The previous edit missed the update of the socket.on("camera-joined") part because the regex was too complex
// I will just look for RTCPeerConnection and related

fs.writeFileSync('public/js/host.js', hostJs);
console.log('done');
