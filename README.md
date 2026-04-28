# Coincoin Live Control Room

WebRTC + Socket.io app to stream multiple camera feeds to a single host dashboard with:

- Role landing page (Host or Camera)
- Dynamic host camera layout (1..N sources)
- Click to focus one camera, click again to go back to grid
- Dedicated music panel on the right side (300px, full height)
- Projection mode + fullscreen mode for clean output
- Lyrics offset control for music embeds (when supported by your Music Assistant page)
- Overlay architecture using transparent PNG assets and manifest

## Stack

- Frontend: HTML, CSS (Grid/Flex), Vanilla JS
- Signaling backend: Node.js + Express + Socket.io
- Video transport: WebRTC peer connections (camera -> host)
- ICE bootstrap: public STUN servers (Google)

## Run locally

```bash
npm install
npm run dev
```

Then open:

- http://localhost:3000

## Run in Docker

Build and start the container:

```bash
docker compose up --build
```

Or, with plain Docker:

```bash
docker build -t overlay-coincoin .
docker run --rm -p 3000:3000 -e PORT=3000 overlay-coincoin
```

Then open:

- http://localhost:3000

## No TURN (same LAN or VPN)

Without a TURN relay, WebRTC works only when host and cameras can reach each other directly (same Wi-Fi/LAN or a VPN like Tailscale/ZeroTier).

- Keep `ICE_TRANSPORT_POLICY` as `all` (default).
- Leave `TURN_URLS` empty.
- Use HTTPS for camera devices (or localhost on the same machine).

Docker (no TURN):

```bash
docker compose up --build
```

For phones or other camera devices on a LAN or public network, put HTTPS in front of the container. Browser camera access requires a secure context, so the container itself should be behind a reverse proxy or tunnel that terminates TLS.

## Docker compose with TURN (recommended for different networks)

When host and cameras are on different networks, you need a TURN relay. The compose stack now ships with coturn.

1) Copy the example env file and edit it:

```bash
copy .env.example .env
```

Fill in:

- `TURN_URLS` with your public domain or IP
- `TURN_REALM` and `TURN_EXTERNAL_IP`
- `TURN_USERNAME` / `TURN_CREDENTIAL`

2) Start the stack:

```bash
docker compose --profile turn up --build
```

3) Open firewall ports on the server:

- `3478/udp` and `3478/tcp`
- `49160-49200/udp` (relay media)


## Camera permission on phone / second device

Browsers allow camera access only in secure contexts (`https://`) or on `localhost`.

- `http://localhost:3000` works on the same machine.
- `http://<LAN-IP>:3000` usually blocks camera permission (no prompt).

To use phones over the network, expose your app through HTTPS (for example with ngrok or Cloudflare Tunnel).

## Important for production

For internet/mobile networks, add a TURN server to improve connectivity across NAT/firewalls.
Public STUN alone is often not enough for stable remote sessions.

## TURN relay (server hosted)

The app now fetches its RTC config from the server. If you run a TURN server on your host, set:

- `TURN_URLS` (comma-separated list)
- `TURN_USERNAME`
- `TURN_CREDENTIAL`
- `ICE_TRANSPORT_POLICY=relay` (optional, forces relay)

Example:

```bash
TURN_URLS="turn:your-domain:3478?transport=udp,turns:your-domain:5349?transport=tcp" \
TURN_USERNAME="coincoin" \
TURN_CREDENTIAL="change-me" \
ICE_TRANSPORT_POLICY=relay \
npm start
```

## Lyrics offset contract (Music Assistant embed)

Host page sends this message to the embedded iframe whenever the offset changes:

```json
{
	"type": "coincoin:set-lyrics-offset-ms",
	"value": 1200
}
```

The iframe URL also receives `lyricsOffsetMs` query param on load.
If your Music Assistant page listens to this message/param, you can slow down or delay lyrics display live.

## File map

- `server.js`: signaling server and room/role orchestration
- `public/index.html`: role selection landing page
- `public/host.html`: host dashboard with camera grid + music panel + overlays
- `public/camera.html`: camera sender page
- `public/js/host.js`: host WebRTC and UI logic
- `public/js/camera.js`: camera WebRTC sender logic
- `public/overlays/manifest.json`: overlay catalog
