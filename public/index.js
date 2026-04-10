const statusEl = document.getElementById("status");
const messagesEl = document.getElementById("messages");
const roomInput = document.getElementById("roomInput");
const joinBtn = document.getElementById("joinBtn");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");

let socket;
let pc;
let dataChannel;
let isInitiator = false;

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

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
  dataChannel.onopen = () => {
    setStatus("Data channel open");
    setChatEnabled(true);
    logMessage("Chat channel is ready");
  };

  dataChannel.onmessage = (event) => {
    logMessage(`Peer: ${event.data}`, "peer");
  };

  dataChannel.onclose = () => {
    setChatEnabled(false);
    logMessage("Chat channel closed");
  };
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