const fs = require('fs');
let code = fs.readFileSync('public/js/host.js', 'utf8');

code = code.replace(/closePeer\(cameraId\);/g, '');
code = code.replace(/const stream = tileRef\.video\.srcObject;/g, 'const stream = null;');
code = code.replace(/tileRef\.video\.srcObject = null;/g, 'tileRef.video.src = "";');
code = code.replace(/if \(tileRef\.remoteStream\) {[\s\S]*?tileRef\.remoteStream = null;\s*}/g, '');

const replaceVideo = `const video = document.createElement("img");
    video.className = "camera-view";
    video.style.objectFit = "cover";
    video.style.width = "100%";
    video.style.height = "100%";
    
    video.addEventListener("error", () => {`;

code = code.replace(/const video = document\.createElement\("video"\);[\s\S]*?video\.addEventListener\("error", \(\) => \{/g, replaceVideo);

fs.writeFileSync('public/js/host.js', code);
console.log('done5');