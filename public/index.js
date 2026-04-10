// native-file-system-adapter: ponyfill for showSaveFilePicker that works in
// Chrome/Edge (native FSAPI), Firefox/Safari (service-worker stream), and
// any browser as a last resort (constructing-blob / in-memory).
import { showSaveFilePicker } from "https://cdn.jsdelivr.net/npm/native-file-system-adapter/mod.js";

const statusEl = document.getElementById("status");
const messagesEl = document.getElementById("messages");
const roomInput = document.getElementById("roomInput");
const joinBtn = document.getElementById("joinBtn");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const fileInput = document.getElementById("fileInput");
const sendFileBtn = document.getElementById("sendFileBtn");

let socket;
let pc;
let dataChannel;
let isInitiator = false;

// ── File transfer: sender state ────────────────────────────────────────────────
// Resolved/rejected when the receiver accepts or declines the file offer.
let pendingFileAcceptResolve = null;
let pendingFileAcceptReject  = null;

// ── File transfer: receiver state ─────────────────────────────────────────────
let incomingFileMeta          = null;  // metadata for the in-progress receive
let incomingWritable          = null;  // FSAPI WritableStream (streaming-to-disk path)
let incomingChunks            = [];    // in-memory fallback chunk accumulator
let incomingBytesReceived     = 0;
let useStreamingSave          = false; // true when FSAPI writable is open

// ── Progress bar state ────────────────────────────────────────────────────────
let transferStartTime  = 0;  // Date.now() when the active transfer began
let lastProgressUpdate = 0;  // Date.now() of the last DOM update (throttle)

// ── Constants ─────────────────────────────────────────────────────────────────
const CHUNK_SIZE          = 64  * 1024;        // 64 KB — safe for all browsers
const BUFFER_HIGH_THRESHOLD = 4  * 1024 * 1024; // pause sending above 4 MB buffered
const BUFFER_LOW_THRESHOLD  = 1  * 1024 * 1024; // resume sending below 1 MB buffered

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

// Register the self-hosted service worker that native-file-system-adapter
// uses to stream large files directly to disk in browsers without the native
// File System Access API (e.g. Firefox, Safari).
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((err) => {
    console.warn("SW registration failed — streaming fallback may buffer in RAM:", err);
  });
}

function formatSize(bytes) {
  if (bytes < 1024)                  return `${bytes} B`;
  if (bytes < 1024 * 1024)           return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function logMessage(text, type = "system") {
  const div = document.createElement("div");
  div.className = `msg ${type}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function setChatEnabled(enabled) {
  messageInput.disabled = !enabled;
  sendBtn.disabled = !enabled;
  fileInput.disabled = !enabled;
  sendFileBtn.disabled = !enabled;
}

function createPeerConnection() {
  pc = new RTCPeerConnection(rtcConfig);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.send(JSON.stringify({
        type: "candidate",
        candidate: event.candidate
      }));
    }
  };

  pc.ondatachannel = (event) => {
    dataChannel = event.channel;
    setupDataChannel();
  };

  pc.onconnectionstatechange = () => {
    setStatus(`Connection state: ${pc.connectionState}`);
    if (pc.connectionState === "connected") {
      setChatEnabled(true);
      logMessage("P2P connection established");
    }
  };
}

function setupDataChannel() {
  // Receive binary data as ArrayBuffer instead of Blob
  dataChannel.binaryType = "arraybuffer";

  dataChannel.onopen = () => {
    setStatus("Data channel open");
    setChatEnabled(true);
    logMessage("Chat channel is ready");
  };

  dataChannel.onmessage = (event) => {
    if (typeof event.data === "string") {
      let parsed = null;
      try { parsed = JSON.parse(event.data); } catch (_) {}

      if (parsed && parsed.type === "file-meta") {
        // ── Incoming file offer ──────────────────────────────────────────────
        incomingFileMeta      = parsed;
        incomingBytesReceived = 0;
        incomingChunks        = [];
        incomingWritable      = null;
        useStreamingSave      = false;
        showIncomingFileUI(parsed);

      } else if (parsed && parsed.type === "file-accept") {
        // ── Peer accepted our file offer — start streaming ───────────────────
        if (pendingFileAcceptResolve) {
          pendingFileAcceptResolve();
          pendingFileAcceptResolve = null;
          pendingFileAcceptReject  = null;
        }

      } else if (parsed && parsed.type === "file-cancel") {
        // ── Peer declined our file offer ─────────────────────────────────────
        if (pendingFileAcceptReject) {
          pendingFileAcceptReject(new Error("Peer declined the file transfer"));
          pendingFileAcceptResolve = null;
          pendingFileAcceptReject  = null;
        }

      } else {
        // Plain text chat message
        logMessage(`Peer: ${event.data}`, "peer");
      }

    } else if (event.data instanceof ArrayBuffer) {
      // ── Binary chunk for the active incoming transfer ────────────────────
      if (!incomingFileMeta) return;

      incomingBytesReceived += event.data.byteLength;

      if (useStreamingSave && incomingWritable) {
        // Always pass Uint8Array: FSAPI accepts it, StreamSaver requires it.
        incomingWritable.write(new Uint8Array(event.data)).catch((err) => {
          logMessage(`❌ Disk write error: ${err.message}`, "system");
        });
      } else {
        incomingChunks.push(event.data);
      }

      updateTransferProgress(incomingBytesReceived, incomingFileMeta.size);

      if (incomingBytesReceived >= incomingFileMeta.size) {
        receiveFile();
      }
    }
  };

  dataChannel.onclose = () => {
    setChatEnabled(false);
    logMessage("Chat channel closed");
  };
}

// ── showIncomingFileUI / hideIncomingFileUI ────────────────────────────────────
function showIncomingFileUI(meta) {
  document.getElementById("incomingFileInfo").textContent =
    `📥 Incoming file: "${meta.filename}" (${formatSize(meta.size)})`;
  document.getElementById("incomingFileUI").style.display = "block";
}

function hideIncomingFileUI() {
  document.getElementById("incomingFileUI").style.display = "none";
}

// ── Transfer progress bar ─────────────────────────────────────────────────────
const progressEl     = document.getElementById("transferProgress");
const progressLabel  = document.getElementById("transferProgressLabel");
const progressBar    = document.getElementById("transferProgressBar");
const progressText   = document.getElementById("transferProgressText");

function showTransferProgress(direction, filename, total) {
  progressLabel.textContent = `${direction === "send" ? "📤 Sending" : "📥 Receiving"} "${filename}"`;
  progressBar.value         = 0;
  progressBar.max           = total;
  progressText.textContent  = `0% · 0 B of ${formatSize(total)}`;
  progressEl.style.display  = "flex";
  transferStartTime  = Date.now();
  lastProgressUpdate = 0;
}

// Throttled to at most one DOM update every 250 ms (safe for 64 KB × 80 000 chunks).
// The final chunk (loaded === total) always updates immediately.
function updateTransferProgress(loaded, total) {
  const now = Date.now();
  if (now - lastProgressUpdate < 250 && loaded < total) return;
  lastProgressUpdate = now;

  const pct     = total > 0 ? Math.floor((loaded / total) * 100) : 0;
  const elapsed = (now - transferStartTime) / 1000;          // seconds
  const speed   = elapsed > 0.5 ? loaded / elapsed : 0;      // avg bytes/s (stable after 0.5 s)

  progressBar.value        = loaded;
  progressText.textContent = `${pct}% · ${formatSize(loaded)} of ${formatSize(total)}` +
    (speed > 0 ? ` · ${formatSize(Math.round(speed))}/s` : "");
}

function hideTransferProgress() {
  progressEl.style.display = "none";
}

// ── acceptIncomingFile — called by the "Accept & Save" button ─────────────────
// Uses native-file-system-adapter's showSaveFilePicker ponyfill, which
// automatically selects the best available method in priority order:
//
//   1. 'native'                — native File System Access API (Chrome/Edge 86+)
//                                User picks a save location via OS dialog.
//   2. 'sw-transferable-stream'— our self-hosted sw.js intercepts a fetch and
//      'sw-message-channel'      pipes chunks straight to the browser download
//                                manager (Firefox, Safari, older Chrome).
//                                Streams to disk with no RAM accumulation.
//
// 'constructing-blob' is intentionally excluded — it buffers everything in RAM,
// which defeats the purpose for large files.  If even the SW methods are
// unavailable, we catch the error and fall back to our own in-memory path with
// a warning.
async function acceptIncomingFile() {
  if (!incomingFileMeta) return;
  hideIncomingFileUI();

  try {
    const handle = await showSaveFilePicker({
      suggestedName: incomingFileMeta.filename,
      _preferredMethods: ["native", "sw-transferable-stream", "sw-message-channel"]
    });
    incomingWritable = await handle.createWritable();
    useStreamingSave = true;
    logMessage(`💾 Streaming "${incomingFileMeta.filename}" directly to disk...`, "system");
  } catch (err) {
    if (err.name === "AbortError") {
      // User dismissed the native save dialog (Chrome/Edge) — cancel transfer
      dataChannel.send(JSON.stringify({ type: "file-cancel" }));
      incomingFileMeta = null;
      return;
    }
    // All streaming methods unavailable — fall back to in-memory accumulation
    incomingChunks = [];
    useStreamingSave = false;
    logMessage(`⚠️ Streaming unavailable (${err.message}) — receiving into memory. Very large files may fail.`, "system");
  }

  showTransferProgress("receive", incomingFileMeta.filename, incomingFileMeta.size);
  dataChannel.send(JSON.stringify({ type: "file-accept" }));
}

// ── declineIncomingFile — called by the "Decline" button ─────────────────────
function declineIncomingFile() {
  if (!incomingFileMeta) return;
  hideIncomingFileUI();
  dataChannel.send(JSON.stringify({ type: "file-cancel" }));
  logMessage(`❌ Declined "${incomingFileMeta.filename}"`, "system");
  incomingFileMeta = null;
}

// ── receiveFile — called when the last byte of a transfer arrives ─────────────
async function receiveFile() {
  const meta    = incomingFileMeta;
  const chunks  = incomingChunks;
  const writable = incomingWritable;
  const wasStreaming = useStreamingSave;

  // Reset state so the next transfer can start immediately
  incomingFileMeta      = null;
  incomingChunks        = [];
  incomingWritable      = null;
  incomingBytesReceived = 0;
  useStreamingSave      = false;

  hideTransferProgress();

  if (wasStreaming && writable) {
    // ── Streaming path: just close the writable — data is already on disk ──
    try {
      await writable.close();
      logMessage(`✅ "${meta.filename}" (${formatSize(meta.size)}) saved to disk!`, "system");
    } catch (err) {
      logMessage(`❌ Error finalising "${meta.filename}": ${err.message}`, "system");
      console.error(err);
    }
  } else {
    // ── In-memory fallback: assemble chunks → Blob → download link ─────────
    try {
      const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
      const merged = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
      }

      const blob = new Blob([merged], { type: meta.fileType || "application/octet-stream" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = meta.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      logMessage(`✅ "${meta.filename}" (${formatSize(meta.size)}) received and downloaded!`, "system");
    } catch (err) {
      logMessage(`❌ Error saving "${meta.filename}": ${err.message}`, "system");
      console.error(err);
    }
  }
}

// ── sendFile ──────────────────────────────────────────────────────────────────
// Streams the file to the peer in CHUNK_SIZE slices without ever loading the
// whole file into memory, supporting files of any size (5 GB+).
async function sendFile() {
  const file = fileInput.files[0];
  if (!file || !dataChannel || dataChannel.readyState !== "open") return;

  sendFileBtn.disabled = true;
  fileInput.disabled   = true;

  try {
    // 1. Advertise the file — receiver shows an Accept / Decline prompt
    dataChannel.send(JSON.stringify({
      type:     "file-meta",
      filename: file.name,
      fileType: file.type,
      size:     file.size
    }));
    logMessage(`📤 Offering "${file.name}" (${formatSize(file.size)}) — waiting for peer to accept…`, "system");

    // 2. Wait for the receiver to accept (or reject) via the handshake message
    await new Promise((resolve, reject) => {
      pendingFileAcceptResolve = resolve;
      pendingFileAcceptReject  = reject;
    });

    showTransferProgress("send", file.name, file.size);
    logMessage(`Sending "${file.name}" (${formatSize(file.size)})…`, "self");

    // 3. Use bufferedAmountLowThreshold for efficient, event-driven backpressure
    //    instead of polling with setTimeout.
    dataChannel.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD;
    let drainResolve = null;
    dataChannel.onbufferedamountlow = () => {
      if (drainResolve) { drainResolve(); drainResolve = null; }
    };

    // 4. Stream the file one slice at a time — only CHUNK_SIZE bytes in RAM at once
    let offset = 0;

    while (offset < file.size) {
      // Apply backpressure: wait for the send buffer to drain before writing more
      if (dataChannel.bufferedAmount > BUFFER_HIGH_THRESHOLD) {
        await new Promise(r => { drainResolve = r; });
      }

      const slice  = file.slice(offset, Math.min(offset + CHUNK_SIZE, file.size));
      const buffer = await slice.arrayBuffer();
      dataChannel.send(buffer);
      offset += buffer.byteLength;

      updateTransferProgress(offset, file.size);

      // Yield so the browser can process other events (UI stays responsive)
      await new Promise(r => setTimeout(r, 0));
    }

    dataChannel.onbufferedamountlow = null;
    hideTransferProgress();
    logMessage(`✅ "${file.name}" sent successfully!`, "self");

  } catch (err) {
    hideTransferProgress();
    logMessage(`❌ Error sending "${file.name}": ${err.message}`, "system");
    console.error(err);
    pendingFileAcceptResolve = null;
    pendingFileAcceptReject  = null;
  }

  fileInput.value      = "";
  sendFileBtn.disabled = false;
  fileInput.disabled   = false;
}

async function makeOffer() {
  createPeerConnection();

  dataChannel = pc.createDataChannel("chat");
  setupDataChannel();

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.send(JSON.stringify({
    type: "offer",
    offer
  }));
}

async function handleOffer(offer) {
  createPeerConnection();

  await pc.setRemoteDescription(new RTCSessionDescription(offer));

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.send(JSON.stringify({
    type: "answer",
    answer
  }));
}

async function handleAnswer(answer) {
  await pc.setRemoteDescription(new RTCSessionDescription(answer));
}

async function handleCandidate(candidate) {
  try {
    if (pc) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  } catch (error) {
    console.error("Error adding ICE candidate:", error);
  }
}

joinBtn.addEventListener("click", () => {
  const roomId = roomInput.value.trim();
  if (!roomId) return;

  socket = new WebSocket(`ws://${window.location.host}`);

  socket.onopen = () => {
    socket.send(JSON.stringify({
      type: "join",
      roomId
    }));
    setStatus(`Joined room: ${roomId}`);
  };

  socket.onmessage = async (event) => {
    const data = JSON.parse(event.data);

    switch (data.type) {
      case "full":
        setStatus("Room is full");
        logMessage("This room already has 2 peers");
        break;

      case "joined":
        isInitiator = data.peerCount === 1;
        logMessage(isInitiator ? "Waiting for another peer..." : "Joined as second peer");
        break;

      case "ready":
        if (isInitiator && !pc) {
          await makeOffer();
        }
        break;

      case "offer":
        await handleOffer(data.offer);
        break;

      case "answer":
        await handleAnswer(data.answer);
        break;

      case "candidate":
        await handleCandidate(data.candidate);
        break;

      case "peer-left":
        setStatus("Peer left");
        setChatEnabled(false);
        logMessage("Peer disconnected");
        break;

      default:
        break;
    }
  };

  socket.onclose = () => {
    setStatus("Disconnected from signaling server");
    setChatEnabled(false);
  };

  joinBtn.disabled = true;
  roomInput.disabled = true;
});

sendBtn.addEventListener("click", () => {
  const text = messageInput.value.trim();
  if (!text || !dataChannel || dataChannel.readyState !== "open") return;

  dataChannel.send(text);
  logMessage(`You: ${text}`, "self");
  messageInput.value = "";
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    sendBtn.click();
  }
});

sendFileBtn.addEventListener("click", () => {
  sendFile();
});

document.getElementById("acceptFileBtn").addEventListener("click", () => {
  acceptIncomingFile();
});

document.getElementById("declineFileBtn").addEventListener("click", () => {
  declineIncomingFile();
});