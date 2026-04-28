const fs = require('fs');
let code = fs.readFileSync('public/js/host.js', 'utf8');

// remove closePeer
code = code.replace(/closePeer\(cameraId\);/g, '');

// update removeCamera stream logic
code = code.replace(/const stream = tileRef\.video\.srcObject;/g, 'const stream = null;');
code = code.replace(/tileRef\.video\.srcObject = null;/g, 'tileRef.video.src = "";');
code = code.replace(/if \(tileRef\.remoteStream\) {[\s\S]*?tileRef\.remoteStream = null;\s*}/g, '');

// And we forgot to make the video element an image inside createCameraTile! Let's do that.
code = code.replace(/const video = document\.createElement\("video"\);[\s\S]*?video\.addEventListener\("error", \(\) => \{/g, 
  \const video = document.createElement("img");
    video.className = "camera-view";
    video.style.objectFit = "cover";
    video.style.width = "100%";
    video.style.height = "100%";
    
    video.addEventListener("error", () => {\);

code = code.replace(/video\.autoplay = true;\s*video\.playsInline = true;\s*video\.muted = true;/g, '');

fs.writeFileSync('public/js/host.js', code);
console.log('done2');
