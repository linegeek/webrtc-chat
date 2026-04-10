const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = new Map();

wss.on("connection", (ws) => {
  let currentRoom = null;

  ws.on("message", (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    if (data.type === "join") {
      const roomId = data.roomId;
      currentRoom = roomId;

      if (!rooms.has(roomId)) {
        rooms.set(roomId, []);
      }

      const clients = rooms.get(roomId);
      clients.push(ws);

      if (clients.length > 2) {
        ws.send(JSON.stringify({ type: "full" }));
        clients.pop();
        return;
      }

      ws.send(JSON.stringify({ type: "joined", peerCount: clients.length }));

      if (clients.length === 2) {
        clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: "ready" }));
          }
        });
      }
      return;
    }

    if (!currentRoom || !rooms.has(currentRoom)) return;

    const clients = rooms.get(currentRoom);
    for (const client of clients) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    }
  });

  ws.on("close", () => {
    if (!currentRoom || !rooms.has(currentRoom)) return;

    const clients = rooms.get(currentRoom).filter((client) => client !== ws);

    if (clients.length === 0) {
      rooms.delete(currentRoom);
    } else {
      rooms.set(currentRoom, clients);
      clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: "peer-left" }));
        }
      });
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});