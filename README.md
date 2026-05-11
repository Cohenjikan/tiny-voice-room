# Tiny Voice Room

A minimal WebRTC voice room: no accounts, share a URL to join, audio only. Made for hopping into a quick voice call with friends — not yet another meeting app.

[简体中文说明](#简体中文) ↓

## Features

- URL is the room — just share a link to invite
- No sign-up, no database; room state lives in memory
- Native browser WebRTC, P2P mesh audio
- Server only relays WebSocket signaling (audio never touches the server)
- Per-peer volume slider
- Mute / push-to-talk (hold `T`)
- Single Node file, zero runtime dependencies

## Run

Requires Node 20+.

```bash
npm start
```

Open <http://localhost:4173>. It will redirect to a random room id. You can also visit `http://localhost:4173/r/<room-name>` directly to enter a named room.

`npm run check` runs a syntax check.

## Environment variables

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

## Deployment

Browsers only grant microphone access in a secure context (`localhost` or HTTPS). Any internet-facing deployment must serve over HTTPS.

Typical topology:

```
Browser ──HTTPS──▶ Reverse proxy ──HTTP──▶ Node (127.0.0.1:4173)
```

### nginx

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

### Caddy

```caddy
voice.example.com {
    reverse_proxy 127.0.0.1:4173
}
```

Caddy forwards WebSocket by default and provisions Let's Encrypt certificates automatically.

### systemd

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

## Limitations

- Mesh topology — every additional participant adds upstream/downstream load to every browser. Recommended ≤ 6 people.
- Without TURN, peers behind strict NAT may fail to connect. Run your own coturn if you need reliable cross-network calls.
- No room password, kick, recording, or chat — intentionally kept simple.
- Room state is in-memory only; restarting the server clears everything.

## License

MIT

---

## 简体中文

极简 WebRTC 语音房间：无账号、发链接进房、纯语音。适合朋友开黑、远程协作时挂着说话用，不做"会议"。

### 特点

- URL 即房间，发链接就能进
- 无注册、无数据库，房间状态全在内存
- 浏览器原生 WebRTC，P2P mesh 音频，服务端不转发媒体流
- 服务端仅做 WebSocket 信令,Node 原生 `http` 实现,零运行时依赖
- 每人独立音量条
- 静音 / 按键说话（按住 `T`）

### 运行

需要 Node 20+。

```bash
npm start
```

打开 <http://localhost:4173>，会自动跳到一个随机房间号。也可以直接访问 `http://localhost:4173/r/<room-name>` 进入指定房间。

`npm run check` 跑语法检查。

### 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `4173` | 监听端口 |
| `ROOM_TTL_MS` | `86400000` | 空房间多久后清理（毫秒） |
| `ICE_SERVERS` | 公共 STUN | STUN/TURN 列表 |

### 部署

浏览器对麦克风权限要求安全上下文：`localhost` 或 HTTPS。对外部署必须走 HTTPS。

典型架构：

```
浏览器 ──HTTPS──▶ 反向代理 ──HTTP──▶ Node (127.0.0.1:4173)
```

nginx / Caddy / systemd 的配置示例见上方英文章节。

### 当前限制

- Mesh 拓扑,每多一个人都增加每个浏览器的上下行带宽,建议房间人数 ≤ 6。
- 没配 TURN 时,两端都在严格 NAT 后可能连不上;异地稳定通话建议自部署 coturn。
- 没有房间密码、踢人、录音、聊天 —— 故意保持简单。
- 房间状态只在内存,服务重启后清空。
