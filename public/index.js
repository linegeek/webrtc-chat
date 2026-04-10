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

// File transfer state (receiver side)
let incomingFileMeta = null;
let incomingChunks = [];
let incomingBytesReceived = 0;
let lastLoggedReceivePercent = 0;

const CHUNK_SIZE = 64 * 1024; // 64 KB per chunk

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function compressData(arrayBuffer) {
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  writer.write(arrayBuffer);
  writer.close();

  const chunks = [];
  const reader = stream.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result.buffer;
}

async function decompressData(arrayBuffer) {
  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  writer.write(arrayBuffer);
  writer.close();

  const chunks = [];
  const reader = stream.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result.buffer;
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
      // Try to parse as file metadata first
      let parsed = null;
      try { parsed = JSON.parse(event.data); } catch (_) {}

      if (parsed && parsed.type === "file-meta") {
        // Start of an incoming file transfer
        incomingFileMeta = parsed;
        incomingChunks = [];
        incomingBytesReceived = 0;
        lastLoggedReceivePercent = 0;
        logMessage(
          `📥 Incoming file: "${parsed.filename}" (${formatSize(parsed.compressedSize)} compressed)`,
          "system"
        );
      } else {
        // Plain text chat message
        logMessage(`Peer: ${event.data}`, "peer");
      }
    } else if (event.data instanceof ArrayBuffer) {
      // Binary chunk belonging to the current file transfer
      if (!incomingFileMeta) return;

      incomingChunks.push(event.data);
      incomingBytesReceived += event.data.byteLength;

      // Log progress at 25 % milestones
      const progress = Math.floor((incomingBytesReceived / incomingFileMeta.compressedSize) * 100);
      const milestone = Math.floor(progress / 25) * 25;
      if (milestone > lastLoggedReceivePercent && milestone < 100) {
        logMessage(`Receiving "${incomingFileMeta.filename}": ${milestone}%`, "system");
        lastLoggedReceivePercent = milestone;
      }

      if (incomingBytesReceived >= incomingFileMeta.compressedSize) {
        receiveFile();
      }
    }
  };

  dataChannel.onclose = () => {
    setChatEnabled(false);
    logMessage("Chat channel closed");
  };
}

async function receiveFile() {
  // Snapshot and immediately clear state so a new transfer can start
  const meta = incomingFileMeta;
  const chunks = incomingChunks;
  incomingFileMeta = null;
  incomingChunks = [];
  incomingBytesReceived = 0;
  lastLoggedReceivePercent = 0;

  try {
    // Merge all received chunks into one contiguous buffer
    const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }

    logMessage(`Decompressing "${meta.filename}"...`, "system");
    const decompressed = await decompressData(merged.buffer);

    // Trigger a browser download on the receiving side
    const blob = new Blob([decompressed], { type: meta.fileType || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = meta.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    logMessage(
      `✅ "${meta.filename}" (${formatSize(decompressed.byteLength)}) received and downloaded!`,
      "system"
    );
  } catch (err) {
    logMessage(`❌ Error receiving "${meta.filename}": ${err.message}`, "system");
    console.error(err);
  }
}

async function sendFile() {
  const file = fileInput.files[0];
  if (!file || !dataChannel || dataChannel.readyState !== "open") return;

  // Disable controls during transfer
  sendFileBtn.disabled = true;
  fileInput.disabled = true;

  try {
    logMessage(`📤 Compressing "${file.name}" (${formatSize(file.size)})...`, "system");
    const arrayBuffer = await file.arrayBuffer();
    const compressed = await compressData(arrayBuffer);

    // 1. Send metadata so the receiver knows what is coming
    const meta = {
      type: "file-meta",
      filename: file.name,
      fileType: file.type,
      compressedSize: compressed.byteLength
    };
    dataChannel.send(JSON.stringify(meta));

    logMessage(
      `Sending "${file.name}" (${formatSize(compressed.byteLength)} compressed)...`,
      "self"
    );

    // 2. Send compressed data in 64 KB chunks with basic backpressure
    let offset = 0;
    let lastLoggedSendPercent = 0;
    const totalSize = compressed.byteLength;

    while (offset < totalSize) {
      // Pause when the send buffer is filling up
      if (dataChannel.bufferedAmount > CHUNK_SIZE * 8) {
        await new Promise(r => setTimeout(r, 50));
        continue;
      }

      const end = Math.min(offset + CHUNK_SIZE, totalSize);
      dataChannel.send(compressed.slice(offset, end));
      offset = end;

      // Log progress at 25 % milestones
      const progress = Math.floor((offset / totalSize) * 100);
      const milestone = Math.floor(progress / 25) * 25;
      if (milestone > lastLoggedSendPercent && milestone < 100) {
        logMessage(`Sending "${file.name}": ${milestone}%`, "system");
        lastLoggedSendPercent = milestone;
      }

      // Yield to the event loop between chunks for smoother UI
      if (offset < totalSize) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    logMessage(`✅ "${file.name}" sent successfully!`, "self");
  } catch (err) {
    logMessage(`❌ Error sending file: ${err.message}`, "system");
    console.error(err);
  }

  fileInput.value = "";
  sendFileBtn.disabled = false;
  fileInput.disabled = false;
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