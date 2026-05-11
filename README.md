# Tiny Voice Room

极简 WebRTC 语音房间：无账号、发链接进房、纯语音。适合开黑、远程协作时后台挂着用，不做"会议"。

## 特点

- URL 即房间，发链接就能进
- 无注册、无数据库，房间状态全在内存
- 浏览器原生 WebRTC，P2P mesh 音频，服务端不转发媒体流
- 服务端仅做 WebSocket 信令，Node 原生 `http` 实现，零运行时依赖
- 每人独立音量条
- 静音 / 按键说话（PTT，按 T 键）

## 运行

需要 Node 20+。

```bash
npm start
```

打开 <http://localhost:4173>，会自动跳到一个随机房间号。也可以直接访问 `http://localhost:4173/r/<room-name>` 进入指定房间。

`npm run check` 跑语法检查。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `4173` | 监听端口 |
| `ROOM_TTL_MS` | `86400000` | 空房间多久后清理（毫秒） |
| `ICE_SERVERS` | 公共 STUN | STUN/TURN 列表 |

`ICE_SERVERS` 可填逗号分隔的 URL，或完整 JSON：

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

## 部署

浏览器对麦克风权限要求安全上下文：`localhost` 或 HTTPS。任何对外可用的部署都需要 HTTPS。

典型架构：

```
Browser ──HTTPS──▶ 反向代理 ──HTTP──▶ Node (127.0.0.1:4173)
```

### nginx 示例

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

### Caddy 示例

```caddy
voice.example.com {
    reverse_proxy 127.0.0.1:4173
}
```

Caddy 默认透传 WebSocket，并自动签 Let's Encrypt 证书。

### systemd 示例

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

## 当前限制

- Mesh 拓扑，每多一个人都增加每个浏览器的上下行带宽，建议房间人数 ≤ 6。
- 没配 TURN 时，两端都在严格 NAT 后可能连不上；异地稳定通话建议自部署 coturn。
- 没有房间密码、踢人、录音、聊天 —— 故意保持简单。
- 房间状态只在内存，服务重启后清空。

## License

MIT
