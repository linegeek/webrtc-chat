# WebRTC P2P Chat

A browser-based, peer-to-peer chat application with file transfer. Two users share a **Room ID** and connect directly to each other via WebRTC — the server is only involved in the initial handshake (signaling).

---

## Features

- **Peer-to-peer messaging** — text is sent directly between browsers over an RTCDataChannel; it never touches the server after the connection is established
- **File transfer** — chunked streaming (64 KB slices) with backpressure control so arbitrarily large files can be sent without loading them entirely into RAM
- **Accept / Decline dialog** — the receiving peer is shown the file name and size before the transfer starts
- **Transfer progress bar** — live percentage and byte-count display while a file is in flight
- **Room-based routing** — up to two peers per room; a third join attempt is rejected immediately
- **Dark mode** — ships dark by default (toggleable via the `app-dark` CSS class)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Signaling server | Node.js · Express 5 · `ws` WebSocket library · TypeScript |
| Frontend | Vue 3 · TypeScript · Vite · PrimeVue 4 (Aura/Sky theme) · PrimeFlex |
| Containerisation | Docker (multi-stage) · Docker Compose |

---

## Project Structure

```
webrtc-chat/
├── src/
│   └── server.ts          # Signaling server (Express + WebSocket)
├── frontend/
│   └── src/
│       ├── components/    # Vue SFCs: JoinScreen, ChatApp, ChatHeader,
│       │                  #           MessageLog, ChatInput, IncomingFileDialog
│       └── composables/
│           ├── useWebRTC.ts        # Core WebRTC + signaling logic
│           ├── webrtcConstants.ts  # Chunk sizes, buffer thresholds, ICE config
│           ├── webrtcTypes.ts      # Shared TypeScript interfaces
│           └── webrtcUtils.ts      # formatSize helper, SW registration
├── Dockerfile
├── docker-compose.yml
├── package.json           # Root — server scripts & dependencies
└── frontend/package.json  # Frontend scripts & dependencies
```

---

## Getting Started

### Prerequisites

- **Node.js 18+** (Node 24 recommended — matches the Docker image)
- npm

### Development

Run the signaling server and the Vite dev server in separate terminals:

```bash
# Terminal 1 — signaling server (ts-node, hot-reloads on file save via nodemon if added)
npm run dev

# Terminal 2 — Vue frontend with HMR
cd frontend
npm run dev
```

The frontend dev server proxies WebSocket connections to the signaling server automatically via Vite's `server.proxy` configuration. Open two browser tabs to `http://localhost:5173`, enter the same Room ID in both, and start chatting.

### Production Build

```bash
# Build both the frontend (Vite) and the server (tsc) in one step
npm run build

# Start the production server (serves the compiled frontend as static files)
npm start
```

The server listens on **port 3000** and serves the compiled Vue app from `frontend/dist/`.

---

## Docker

### Build & run with Docker Compose

```bash
# Set the host port via the PORT environment variable (defaults to 3000)
PORT=3000 docker compose up --build
```

### Build & run manually

```bash
docker build -t webrtc-chat .
docker run -p 3000:3000 webrtc-chat
```

The Dockerfile uses a three-stage build:
1. **frontend-build** — installs frontend deps and runs `vite build`
2. **server-build** — compiles the TypeScript server with `tsc`
3. **runtime** — production Node image with only the compiled artefacts and production dependencies

---

## How It Works

```
Browser A                 Signaling Server              Browser B
   |                           |                            |
   |── join(roomId) ──────────>|                            |
   |<─ joined(peerCount:1) ────|                            |
   |                           |<──── join(roomId) ─────────|
   |<─ ready ──────────────────|─────────────── ready ─────>|
   |                           |                            |
   |── offer ─────────────────>|──────────────────────────>|
   |<─────────────────────── answer ───────────────────────|
   |<──────────────── ICE candidates ──────────────────────|
   |                           |                            |
   |════════ RTCDataChannel (P2P) ══════════════════════════|
   |  text messages & file chunks flow directly, no server  |
```

Once the `RTCPeerConnection` reaches the `connected` state the signaling server is no longer involved. STUN is provided by Google's public server (`stun:stun.l.google.com:19302`).

---

## Scripts Reference

| Command | Description |
|---|---|
| `npm run dev` | Start the signaling server via `ts-node` |
| `npm run build` | Build frontend (Vite) **and** server (tsc) |
| `npm run build:frontend` | Build only the Vue frontend |
| `npm run build:server` | Compile only the TypeScript server |
| `npm start` | Run the compiled production server |
| `cd frontend && npm run dev` | Start the Vite dev server |
| `cd frontend && npm run preview` | Preview the production frontend build |
