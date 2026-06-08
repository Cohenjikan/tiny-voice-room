<div align="center">

# Tiny Voice Room

### The URL **is** the room. Send the link, start talking.

A no-account, link-first **WebRTC voice room** for quick game comms — share a URL, talk peer-to-peer, no signup and no database, all in **one dependency-free Node file**.

[![License: MIT](https://img.shields.io/github/license/Cohenjikan/tiny-voice-room?color=brightgreen)](https://github.com/Cohenjikan/tiny-voice-room/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Runtime deps](https://img.shields.io/badge/runtime%20deps-0-success)](https://github.com/Cohenjikan/tiny-voice-room/blob/main/package.json)
[![Audio](https://img.shields.io/badge/audio-P2P%20mesh-blue)](#features)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white)](https://github.com/Cohenjikan/tiny-voice-room/blob/main/Dockerfile)
[![GitHub stars](https://img.shields.io/github/stars/Cohenjikan/tiny-voice-room?style=social)](https://github.com/Cohenjikan/tiny-voice-room/stargazers)

**English** · [简体中文](README.zh-CN.md)

<img src="docs/assets/screenshot.png" alt="Tiny Voice Room — a connected room with the invite link, member list, and per-peer volume controls" width="100%">

<sub> <a href="docs/assets/promo.mp4">Watch the 30-second promo</a></sub>

</div>

> **Voice chat for gaming with friends — no account, no install, no Discord.**
> Audio flows browser-to-browser; the tiny Node process only shuttles signaling, so it never sees or stores your media. Rooms live in memory and vanish when everyone leaves.

---

## Why Tiny Voice Room?

You and a couple of friends want to talk while you game. Spinning up Discord, making everyone sign in, or booking a "meeting" is overkill. Tiny Voice Room is the opposite of a heavyweight meeting app:

- **The URL is the room.** Paste a link, you're talking. No lobby, no account, no app to install.
- **True peer-to-peer audio.** The server relays signaling only — your voice goes browser-to-browser and never touches it.
- **Zero runtime dependencies.** No `node_modules`, no supply chain. One readable server file you can audit in a sitting.
- **No database.** Rooms are pure in-memory state, garbage-collected after they empty. Nothing to provision or back up.
- **Deliberately minimal.** No password, kick, recording, video, or chat — by design.

---

## Quickstart

> Requires **Node 20+**. There is nothing to `npm install` — there are no dependencies.

```bash
git clone https://github.com/Cohenjikan/tiny-voice-room.git
cd tiny-voice-room
npm start
```

Then open **<http://localhost:4173>** — it lands you in a fresh random room (`/r/<id>`). Share that URL and you're done.

Want a named room? Go straight to **`http://localhost:4173/r/squad-night`** — any name works.

```bash
npm run check   # optional: node --check syntax pass, no deps needed
```

> [!TIP]
> Testing across devices on your LAN? The app detects loopback hosts and surfaces your machine's **LAN IP** in the invite box automatically — share that link so phones and other PCs can actually connect.

<div align="center">
<img src="docs/assets/onboarding.png" alt="A fresh room with the invite link ready to copy and a Join button" width="78%">
</div>

---

## Features

### The URL is the room
Invite by pasting a link — no signup, no lobby, no app to install. Visiting `/` silently drops you into a fresh random room; share `/r/<name>` for a named one. The room id lives entirely in the address bar.

<img src="docs/assets/feature-1.png" alt="The invite link field with a one-click copy button, a LAN-link hint, and the Join button" width="100%">

### Peer-to-peer mesh audio — the server never sees the media
Audio flows browser-to-browser over a full mesh of `RTCPeerConnection`s. The Node process only relays SDP/ICE signaling, so it **can't record or eavesdrop** and stays light. (Standard WebRTC DTLS-SRTP encrypts the media in transit — this isn't an extra app-layer E2EE guarantee, it just means your voice never passes through the server.)

<img src="docs/assets/feature-2.png" alt="A connected room: invite link on the left, the member list with connected peers on the right" width="100%">

### Per-peer volume, mute, and push-to-talk
Balance loud and quiet friends individually with a per-row volume slider. Mute instantly, or flip on push-to-talk and **hold `T`** to talk only when you mean to. Live mic-level meter shows you when you're actually being heard.

<img src="docs/assets/feature-3.png" alt="Members panel showing per-peer volume sliders and talking, online, and muted states" width="100%">

### Built to self-host
Zero runtime dependencies and a single hand-rolled-WebSocket server file. Configurable STUN/TURN for real networks, a `/healthz` endpoint, a drop-in `Dockerfile`, and documented nginx / Caddy / systemd recipes.

<img src="docs/assets/feature-4.png" alt="The control strip: mute and push-to-talk buttons next to a live mic-level meter" width="100%">

| Feature | What you get |
|---|---|
| **Link-first rooms** | `/` → random room, `/r/<name>` → named room, copy-to-invite |
| **P2P mesh audio** | Browser-to-browser; server is signaling-only |
| **Zero runtime deps** | One server file, hand-rolled WS on `node:http` |
| **No database** | In-memory rooms, GC'd after `ROOM_TTL_MS` (default 24h) |
| **Per-peer audio control** | Volume slider, mute, push-to-talk (hold `T`) |
| **STUN/TURN config** | Public STUN by default; point at your own TURN |
| **LAN-aware invites** | Auto LAN-IP link + pre-join room preview |
| **Container/proxy ready** | Dockerfile, `/healthz`, HTTPS reverse-proxy recipes |

---

## Configuration

All configuration is via environment variables — no config file.

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `0.0.0.0` | Listen address |
| `PORT` | `4173` | Listen port |
| `ROOM_TTL_MS` | `86400000` | How long an empty room is kept before garbage collection (ms) |
| `ICE_SERVERS` | public STUN | STUN/TURN server list |

`ICE_SERVERS` accepts either a comma-separated list of URLs, or a JSON array:

```json
[
  { "urls": ["stun:stun.l.google.com:19302"] },
  {
    "urls": ["turn:turn.example.com:3478"],
    "username": "user",
    "credential": "pass"
  }
]
```

---

## Deployment

Browsers only grant microphone access in a **secure context** (`localhost` or HTTPS), so any internet-facing deployment **must serve over HTTPS** — typically via a reverse proxy.

```
Browser ──HTTPS──▶ Reverse proxy ──HTTP──▶ Node (127.0.0.1:4173)
```

<details>
<summary><b> Docker</b></summary>

```bash
docker build -t tiny-voice-room .
docker run --rm -p 4173:4173 tiny-voice-room
```

The bundled image is `node:24-alpine` and `EXPOSE`s `4173`.
</details>

<details>
<summary><b>nginx</b></summary>

```nginx
server {
    listen 80;
    server_name voice.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name voice.example.com;
    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        proxy_buffering off;
    }
}
```
</details>

<details>
<summary><b>Caddy</b></summary>

```caddy
voice.example.com {
    reverse_proxy 127.0.0.1:4173
}
```

Caddy forwards WebSocket by default and provisions Let's Encrypt certificates automatically.
</details>

<details>
<summary><b>systemd</b></summary>

```ini
[Unit]
Description=Tiny Voice Room
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/tinyvoice
Environment=HOST=127.0.0.1
Environment=PORT=4173
ExecStart=/usr/bin/node /opt/tinyvoice/server.mjs
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```
</details>

A `GET /healthz` returns `{ "ok": true, "rooms": N, "clients": N }` for liveness checks.

---

## Honest limitations

This is a small, focused tool. Know what it is — and isn't:

- ** Mesh topology.** Every extra participant adds upstream **and** downstream load to *every* browser. Recommended **≤ 6 people**. It is not a "meeting" app.
- ** HTTPS required off localhost.** Mic access needs a secure context. Any internet-facing deployment must serve over HTTPS (e.g. via a reverse proxy).
- ** Strict NAT needs TURN.** Without a TURN server, two peers both behind strict NAT may fail to connect. Run your own [coturn](https://github.com/coturn/coturn) for reliable cross-network calls.
- ** Rooms are ephemeral.** State is in-memory only — restarting the server clears all rooms and participants. There are no accounts or profiles; identity is just an editable nickname in `localStorage`.
- ** Intentionally missing.** No password, kick, recording, chat, video, or screen share. These are omitted by design, not on a roadmap.
- ** UI language.** The shipped interface is **Simplified Chinese** (`lang="zh-CN"`); this README is bilingual but the in-app labels are not English (yet).
- ** JS-driven redirect.** The random-room redirect happens client-side (`history.replaceState`), not as a server HTTP redirect — with JavaScript disabled, `/` won't auto-route.

---

## Project layout

```
server.mjs        # the entire server: HTTP + hand-rolled WebSocket signaling, zero deps
public/
  index.html      # room UI
  app.js          # WebRTC mesh, controls, room logic
  styles.css      # styling
Dockerfile        # node:24-alpine, EXPOSE 4173
```

> [!NOTE]
> The **server** is one file, but the app also ships a `public/` directory. "One dependency-free Node file" refers to the server.

---

## Contributing

Issues and PRs welcome. The codebase is deliberately tiny and dependency-free — please keep it that way: `npm run check` should pass, and no runtime dependencies.

## License

[MIT](LICENSE) © Cohenjikan
