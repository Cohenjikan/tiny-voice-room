import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 4173);
const roomTtlMs = Number(process.env.ROOM_TTL_MS || 24 * 60 * 60 * 1000);
const maxPayloadBytes = 1024 * 1024;
const socketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const rooms = new Map();
const clients = new Map();

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"]
]);

const defaultIceServers = [
  { urls: ["stun:stun.l.google.com:19302", "stun:global.stun.twilio.com:3478"] }
];

function getIceServers() {
  const raw = process.env.ICE_SERVERS?.trim();
  if (!raw) return defaultIceServers;

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : defaultIceServers;
  } catch {
    return raw
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean)
      .map((url) => ({ urls: [url] }));
  }
}

function randomId(bytes = 8) {
  return crypto.randomBytes(bytes).toString("hex");
}

function sanitizeRoom(room) {
  return String(room || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || randomId(4);
}

function sanitizeName(name) {
  return String(name || "Player")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 32) || "Player";
}

function getLanHosts() {
  const candidates = [];

  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      candidates.push(entry.address);
    }
  }

  return candidates.sort((left, right) => {
    const score = (address) => {
      if (address.startsWith("192.168.")) return 0;
      if (address.startsWith("10.")) return 1;
      if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) return 2;
      return 3;
    };

    return score(left) - score(right) || left.localeCompare(right);
  });
}

function requestOrigin(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const hostHeader = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${port}`;
  return `${proto}://${hostHeader}`;
}

function publicPeer(client) {
  return {
    id: client.id,
    name: client.name,
    muted: client.muted,
    talking: client.talking
  };
}

function getRoom(roomId) {
  const id = sanitizeRoom(roomId);
  let room = rooms.get(id);
  if (!room) {
    room = {
      id,
      clients: new Map(),
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      expiresAt: null
    };
    rooms.set(id, room);
  }
  room.lastActiveAt = Date.now();
  room.expiresAt = null;
  return room;
}

function broadcast(roomId, message, exceptId = null) {
  const room = rooms.get(roomId);
  if (!room) return;

  for (const client of room.clients.values()) {
    if (client.id !== exceptId) {
      sendJson(client, message);
    }
  }
}

function leaveRoom(client) {
  if (!client.roomId) return;

  const room = rooms.get(client.roomId);
  if (room) {
    room.clients.delete(client.id);
    room.lastActiveAt = Date.now();
    broadcast(room.id, { type: "peer-left", id: client.id });

    if (room.clients.size === 0) {
      room.expiresAt = Date.now() + roomTtlMs;
    }
  }

  client.roomId = null;
}

function joinRoom(client, payload) {
  const room = getRoom(payload.room);
  const name = sanitizeName(payload.name);

  leaveRoom(client);

  client.roomId = room.id;
  client.name = name;
  client.muted = Boolean(payload.muted);
  client.talking = false;
  room.clients.set(client.id, client);

  const peers = [...room.clients.values()]
    .filter((peer) => peer.id !== client.id)
    .map(publicPeer);

  sendJson(client, {
    type: "welcome",
    id: client.id,
    room: room.id,
    peers,
    iceServers: getIceServers()
  });

  broadcast(room.id, { type: "peer-joined", peer: publicPeer(client) }, client.id);
}

function sendSignal(client, payload) {
  const room = rooms.get(client.roomId);
  if (!room || !payload.target) return;

  const target = room.clients.get(String(payload.target));
  if (!target) return;

  sendJson(target, {
    type: "signal",
    source: client.id,
    description: payload.description || null,
    candidate: payload.candidate || null
  });
}

function updatePresence(client, payload) {
  if (!client.roomId) return;

  client.muted = Boolean(payload.muted);
  client.talking = Boolean(payload.talking);

  broadcast(client.roomId, {
    type: "presence",
    id: client.id,
    muted: client.muted,
    talking: client.talking
  }, client.id);
}

function updateName(client, payload) {
  if (!client.roomId) return;

  const name = sanitizeName(payload.name);
  if (name === client.name) return;

  client.name = name;
  broadcast(client.roomId, { type: "name", id: client.id, name }, client.id);
}

function handleClientMessage(client, text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    sendJson(client, { type: "error", message: "Invalid JSON." });
    return;
  }

  switch (payload.type) {
    case "join":
      joinRoom(client, payload);
      break;
    case "signal":
      sendSignal(client, payload);
      break;
    case "presence":
      updatePresence(client, payload);
      break;
    case "name":
      updateName(client, payload);
      break;
    case "ping":
      sendJson(client, { type: "pong", now: Date.now() });
      break;
    default:
      sendJson(client, { type: "error", message: "Unknown message type." });
  }
}

function encodeFrame(data, opcode = 0x1) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  const length = payload.length;
  let header;

  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length <= 0xffff) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

function sendJson(client, message) {
  if (client.socket.destroyed) return;

  try {
    client.socket.write(encodeFrame(JSON.stringify(message)));
  } catch {
    client.socket.destroy();
  }
}

function sendClose(client, code = 1000, reason = "") {
  const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
  payload.writeUInt16BE(code, 0);
  payload.write(reason, 2);
  client.socket.write(encodeFrame(payload, 0x8));
  client.socket.end();
}

function handleFrame(client, opcode, payload) {
  if (opcode === 0x8) {
    client.socket.end();
    return;
  }

  if (opcode === 0x9) {
    client.socket.write(encodeFrame(payload, 0xA));
    return;
  }

  if (opcode === 0x1) {
    handleClientMessage(client, payload.toString("utf8"));
  }
}

function consumeFrames(client) {
  let buffer = client.buffer;

  while (buffer.length >= 2) {
    const byte1 = buffer[0];
    const byte2 = buffer[1];
    const opcode = byte1 & 0x0f;
    const masked = (byte2 & 0x80) === 0x80;
    let length = byte2 & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (buffer.length < offset + 2) break;
      length = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (buffer.length < offset + 8) break;
      const bigLength = buffer.readBigUInt64BE(offset);
      if (bigLength > BigInt(maxPayloadBytes)) {
        sendClose(client, 1009, "Payload too large.");
        return;
      }
      length = Number(bigLength);
      offset += 8;
    }

    if (length > maxPayloadBytes) {
      sendClose(client, 1009, "Payload too large.");
      return;
    }

    const maskBytes = masked ? 4 : 0;
    const frameEnd = offset + maskBytes + length;
    if (buffer.length < frameEnd) break;

    let payload = buffer.subarray(offset + maskBytes, frameEnd);
    if (masked) {
      const mask = buffer.subarray(offset, offset + 4);
      payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
    }

    handleFrame(client, opcode, payload);
    buffer = buffer.subarray(frameEnd);
  }

  client.buffer = buffer;
}

function attachWebSocket(req, socket) {
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash("sha1")
    .update(key + socketGuid)
    .digest("base64");

  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    ""
  ].join("\r\n"));

  const client = {
    id: randomId(6),
    socket,
    buffer: Buffer.alloc(0),
    roomId: null,
    name: "Player",
    muted: false,
    talking: false
  };

  clients.set(client.id, client);

  socket.on("data", (chunk) => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    consumeFrames(client);
  });

  socket.on("close", () => {
    leaveRoom(client);
    clients.delete(client.id);
  });

  socket.on("error", () => {
    leaveRoom(client);
    clients.delete(client.id);
  });
}

async function sendFile(res, filePath) {
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes.get(path.extname(filePath)) || "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": "no-store"
    });
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Internal server error");
  }
}

async function handleHttp(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, clients: clients.size }));
    return;
  }

  const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/?$/);
  if (roomMatch) {
    const id = sanitizeRoom(decodeURIComponent(roomMatch[1]));
    const room = rooms.get(id);
    const peers = room ? [...room.clients.values()].map(publicPeer) : [];
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify({ id, count: peers.length, peers }));
    return;
  }

  if (url.pathname === "/api/links") {
    const room = sanitizeRoom(url.searchParams.get("room"));
    const lan = getLanHosts().map((hostAddress) => ({
      host: hostAddress,
      url: `http://${hostAddress}:${port}/r/${encodeURIComponent(room)}`
    }));

    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify({
      room,
      current: `${requestOrigin(req)}/r/${encodeURIComponent(room)}`,
      lan
    }));
    return;
  }

  if (url.pathname === "/" || /^\/r\/[^/]+\/?$/.test(url.pathname)) {
    await sendFile(res, path.join(publicDir, "index.html"));
    return;
  }

  const requestedPath = decodeURIComponent(url.pathname);
  const filePath = path.resolve(publicDir, `.${requestedPath}`);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  await sendFile(res, filePath);
}

const server = http.createServer((req, res) => {
  handleHttp(req, res).catch(() => {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Internal server error");
  });
});

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }

  attachWebSocket(req, socket);
});

setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    if (room.clients.size === 0 && room.expiresAt && room.expiresAt <= now) {
      rooms.delete(roomId);
    }
  }
}, 60_000).unref();

server.listen(port, host, () => {
  console.log(`Tiny Voice Room listening on http://${host}:${port}`);
});
