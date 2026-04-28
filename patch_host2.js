const fs = require('fs');
let code = fs.readFileSync('public/js/host.js', 'utf8');

// Replace peer state map
code = code.replace(/const peers = new Map\(\);(?:.*?\n)*/g, '');

// Strip WebRTC functions
code = code.replace(/function getOrCreatePeer\(cameraId\) \{[\s\S]*?(?=function removeCameraTile)/g, '');
code = code.replace(/function createCameraStream\(cameraId\) \{[\s\S]*?(?=function rebuildCameraStream)/g, '');
code = code.replace(/function rebuildCameraStream\(cameraId\) \{[\s\S]*?(?=function closePeer)/g, '');
code = code.replace(/function closePeer\(cameraId\) \{[\s\S]*?(?=function setTileState)/g, '');

// Clean up socket.on events
code = code.replace(/socket\.on\("camera-answer", async \(\{ cameraId, sdp \} = \{\}\) => \{[\s\S]*?(?=socket\.on\("ice-candidate-to-host")/g, '');
code = code.replace(/socket\.on\("ice-candidate-to-host", async \(\{ cameraId, candidate \} = \{\}\) => \{[\s\S]*?(?=socket\.on\("disconnect")/g, '');

code = code.replace(/socket\.on\("camera-joined", async \(\{ cameraId, label \} = \{\}\) => \{[\s\S]*?(?=socket\.on\("camera-left",)/g, 
`socket.on("camera-joined", ({ cameraId, label } = {}) => {
    createCameraTile(cameraId, label);
  });

  socket.on("video-frame", ({ cameraId, frame }) => {
    const tile = cameraTiles.get(cameraId);
    if (!tile) return;
    tile.video.src = frame;
    setTileState(cameraId, "ready", "Connecté");
  });\n\n  `);

code = code.replace(/await createCameraStream\(cameraId\);/g, '');
code = code.replace(/await closePeer\(cameraId\);/g, '');

code = code.replace(/function removeCameraTile\(cameraId\) \{[\s\S]*?(?=function reloadEmptyState)/g, `function removeCameraTile(cameraId) {
    const tile = cameraTiles.get(cameraId);
    if (!tile) return;

    tile.wrapper.remove();
    cameraTiles.delete(cameraId);

    if (focusedCameraId === cameraId) {
      focusedCameraId = null;
      applyFocusMode();
    }

    toggleEmptyState();
  }\n\n  `);

fs.writeFileSync('public/js/host.js', code);
console.log('host.js patched successfully!');
