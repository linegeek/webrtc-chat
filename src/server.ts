import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";

interface ClientMessage {
  type: string;
  roomId?: string;
  [key: string]: unknown;
}

const app = express();
app.use(express.static(path.join(__dirname, "../public")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map<string, WebSocket[]>();

wss.on("connection", (ws: WebSocket) => {
  let currentRoom: string | null = null;

  ws.on("message", (message: Buffer | string) => {
    let data: ClientMessage;
    try {
      data = JSON.parse(message.toString()) as ClientMessage;
    } catch {
      return;
    }

    if (data.type === "join") {
      const roomId = data.roomId;
      if (!roomId) return;

      currentRoom = roomId;

      if (!rooms.has(roomId)) {
        rooms.set(roomId, []);
      }

      const clients = rooms.get(roomId)!;
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

    const clients = rooms.get(currentRoom)!;
    for (const client of clients) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    }
  });

  ws.on("close", () => {
    if (!currentRoom || !rooms.has(currentRoom)) return;

    const clients = rooms.get(currentRoom)!.filter((client) => client !== ws);

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
