const statusPill = document.querySelector("#statusPill");
const inviteInput = document.querySelector("#inviteInput");
const copyButton = document.querySelector("#copyButton");
const networkNote = document.querySelector("#networkNote");
const nameInput = document.querySelector("#nameInput");
const joinButton = document.querySelector("#joinButton");
const leaveButton = document.querySelector("#leaveButton");
const muteButton = document.querySelector("#muteButton");
const pttButton = document.querySelector("#pttButton");
const meterBar = document.querySelector("#meterBar");
const peopleList = document.querySelector("#peopleList");
const peopleCount = document.querySelector("#peopleCount");
const remoteAudio = document.querySelector("#remoteAudio");
const toast = document.querySelector("#toast");

const defaultIceServers = [{ urls: ["stun:stun.l.google.com:19302"] }];
const roomId = getRoomId();
let inviteUrl = `${location.origin}/r/${encodeURIComponent(roomId)}`;

const state = {
  socket: null,
  localId: null,
  localStream: null,
  audioContext: null,
  meterSource: null,
  meterAnalyser: null,
  meterData: null,
  meterFrame: 0,
  peers: new Map(),
  peerVolumes: new Map(),
  preview: [],
  previewTimer: 0,
  iceServers: defaultIceServers,
  joined: false,
  connecting: false,
  muted: false,
  ptt: false,
  pttHeld: false,
  talking: false,
  lastPresence: { muted: false, talking: false },
  toastTimer: 0
};

inviteInput.value = inviteUrl;
nameInput.value = localStorage.getItem("tiny-voice-name") || `Player-${Math.floor(100 + Math.random() * 900)}`;
loadInviteLinks();
loadRoomPreview();
state.previewTimer = setInterval(() => {
  if (!state.joined && !state.connecting && document.visibilityState === "visible") {
    loadRoomPreview();
  }
}, 10_000);
render();

copyButton.addEventListener("click", copyInvite);
joinButton.addEventListener("click", joinVoice);
leaveButton.addEventListener("click", leaveVoice);
muteButton.addEventListener("click", toggleMute);
pttButton.addEventListener("click", togglePtt);
let nameDebounceTimer = 0;
let lastSentName = nameInput.value.trim();

nameInput.addEventListener("input", () => {
  clearTimeout(nameDebounceTimer);
  nameDebounceTimer = setTimeout(syncName, 300);
});

nameInput.addEventListener("change", syncName);

function syncName() {
  clearTimeout(nameDebounceTimer);
  const name = nameInput.value.trim();
  if (!name) return;

  localStorage.setItem("tiny-voice-name", name);

  if (name === lastSentName) {
    render();
    return;
  }
  lastSentName = name;

  if (state.joined && state.socket?.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify({ type: "name", name }));
  }
  render();
}

window.addEventListener("keydown", (event) => {
  if (!state.ptt || isTypingTarget(event.target)) return;
  if (event.code !== "KeyT" || event.repeat) return;
  event.preventDefault();
  state.pttHeld = true;
  applyTrackState();
});

window.addEventListener("keyup", (event) => {
  if (!state.ptt || event.code !== "KeyT") return;
  event.preventDefault();
  state.pttHeld = false;
  applyTrackState();
});

window.addEventListener("beforeunload", () => {
  if (state.socket?.readyState === WebSocket.OPEN) {
    state.socket.close();
  }
});

function getRoomId() {
  const match = location.pathname.match(/^\/r\/([^/]+)\/?$/);
  if (match) return normalizeRoom(decodeURIComponent(match[1]));

  const id = randomRoom();
  history.replaceState(null, "", `/r/${id}`);
  return id;
}

function normalizeRoom(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || randomRoom();
}

function randomRoom() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function socketUrl() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws`;
}

async function copyInvite() {
  try {
    await navigator.clipboard.writeText(inviteUrl);
    showToast("邀请链接已复制");
  } catch {
    inviteInput.select();
    document.execCommand("copy");
    showToast("邀请链接已复制");
  }
}

async function loadRoomPreview() {
  if (state.joined || state.connecting) return;
  try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    if (state.joined || state.connecting) return;
    state.preview = Array.isArray(data.peers) ? data.peers : [];
    render();
  } catch {}
}

async function loadInviteLinks() {
  try {
    const response = await fetch(`/api/links?room=${encodeURIComponent(roomId)}`, { cache: "no-store" });
    const links = await response.json();
    const lanUrl = links.lan?.[0]?.url;

    if (isLoopbackHost(location.hostname) && lanUrl) {
      inviteUrl = lanUrl;
      inviteInput.value = inviteUrl;
      showNetworkNote(`其他设备请用局域网链接：${lanUrl}`);
      return;
    }

    if (!window.isSecureContext && !isLoopbackHost(location.hostname)) {
      showNetworkNote("当前页面可用于打开房间，但麦克风通常需要 HTTPS；手机真机通话建议用 HTTPS 域名或隧道。");
    }
  } catch {
    if (isLoopbackHost(location.hostname)) {
      showNetworkNote("其他设备不能使用 127.0.0.1，需要改用这台电脑的局域网 IP。");
    }
  }
}

async function joinVoice() {
  if (state.joined || state.connecting) return;

  if (!window.isSecureContext && !isLoopbackHost(location.hostname)) {
    setStatus("error", "需要 HTTPS");
    showToast("手机/局域网 HTTP 页面通常不能打开麦克风，请用 HTTPS 域名或隧道。");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("error", "麦克风不可用");
    showToast("当前浏览器没有开放麦克风 API，请检查 HTTPS、浏览器和权限设置。");
    return;
  }

  setStatus("connecting", "连接中");
  state.connecting = true;
  render();

  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });

    setupLocalMeter(state.localStream);
    connectSocket();
  } catch (error) {
    state.connecting = false;
    setStatus("error", "麦克风错误");
    showToast(error?.message || "无法打开麦克风");
    stopLocalStream();
    render();
  }
}

function connectSocket() {
  const socket = new WebSocket(socketUrl());
  state.socket = socket;

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({
      type: "join",
      room: roomId,
      name: nameInput.value.trim() || "Player",
      muted: state.muted
    }));
  });

  socket.addEventListener("message", async (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    await handleServerMessage(message);
  });

  socket.addEventListener("close", () => {
    if (state.joined || state.connecting) {
      showToast("信令连接已断开");
    }
    resetConnection(false);
  });

  socket.addEventListener("error", () => {
    setStatus("error", "连接错误");
  });
}

async function handleServerMessage(message) {
  switch (message.type) {
    case "welcome":
      state.localId = message.id;
      state.iceServers = Array.isArray(message.iceServers) ? message.iceServers : defaultIceServers;
      state.joined = true;
      state.connecting = false;
      state.lastPresence = { muted: false, talking: false };
      setStatus("ready", "已加入");
      applyTrackState();

      for (const peer of message.peers) {
        ensurePeer(peer, true);
      }
      render();
      break;

    case "peer-joined":
      ensurePeer(message.peer, false);
      render();
      break;

    case "peer-left":
      removePeer(message.id);
      render();
      break;

    case "presence":
      updatePeerPresence(message);
      render();
      break;

    case "name":
      updatePeerName(message);
      render();
      break;

    case "signal":
      await handleSignal(message);
      break;

    case "error":
      showToast(message.message || "服务器错误");
      break;
  }
}

function ensurePeer(peerInfo, initiator) {
  if (!peerInfo?.id || peerInfo.id === state.localId) return null;

  let peer = state.peers.get(peerInfo.id);
  if (peer) {
    if (peerInfo.name) peer.name = peerInfo.name;
    if (peerInfo.muted !== undefined) peer.muted = Boolean(peerInfo.muted);
    if (peerInfo.talking !== undefined) peer.talking = Boolean(peerInfo.talking);
    return peer;
  }

  const pc = new RTCPeerConnection({ iceServers: state.iceServers });
  peer = {
    id: peerInfo.id,
    name: peerInfo.name || "Player",
    muted: Boolean(peerInfo.muted),
    talking: Boolean(peerInfo.talking),
    pc,
    audio: null,
    pendingCandidates: [],
    status: "connecting"
  };
  state.peers.set(peer.id, peer);

  for (const track of state.localStream?.getTracks() || []) {
    pc.addTrack(track, state.localStream);
  }

  pc.addEventListener("icecandidate", (event) => {
    if (event.candidate) {
      sendSignal(peer.id, { candidate: event.candidate });
    }
  });

  pc.addEventListener("track", (event) => {
    attachRemoteStream(peer, event.streams[0]);
  });

  pc.addEventListener("connectionstatechange", () => {
    peer.status = pc.connectionState;
    render();
  });

  if (initiator) {
    makeOffer(peer).catch(() => {
      peer.status = "failed";
      render();
    });
  }

  return peer;
}

async function makeOffer(peer) {
  const offer = await peer.pc.createOffer({ offerToReceiveAudio: true });
  await peer.pc.setLocalDescription(offer);
  sendSignal(peer.id, { description: peer.pc.localDescription });
}

async function handleSignal(message) {
  const peer = ensurePeer({ id: message.source }, false);
  if (!peer) return;

  if (message.description) {
    const description = new RTCSessionDescription(message.description);
    await peer.pc.setRemoteDescription(description);

    for (const candidate of peer.pendingCandidates.splice(0)) {
      await peer.pc.addIceCandidate(candidate).catch(() => {});
    }

    if (description.type === "offer") {
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      sendSignal(peer.id, { description: peer.pc.localDescription });
    }
  }

  if (message.candidate) {
    const candidate = new RTCIceCandidate(message.candidate);
    if (peer.pc.remoteDescription) {
      await peer.pc.addIceCandidate(candidate).catch(() => {});
    } else {
      peer.pendingCandidates.push(candidate);
    }
  }
}

function sendSignal(target, payload) {
  if (state.socket?.readyState !== WebSocket.OPEN) return;
  state.socket.send(JSON.stringify({
    type: "signal",
    target,
    ...payload
  }));
}

function attachRemoteStream(peer, stream) {
  if (peer.audio) {
    peer.audio.srcObject = stream;
    return;
  }

  const audio = document.createElement("audio");
  audio.autoplay = true;
  audio.playsInline = true;
  audio.srcObject = stream;
  audio.dataset.peer = peer.id;
  audio.volume = state.peerVolumes.get(peer.id) ?? 1;
  remoteAudio.append(audio);
  peer.audio = audio;
}

function setPeerVolume(peerId, value) {
  const clamped = Math.max(0, Math.min(1, value));
  state.peerVolumes.set(peerId, clamped);
  const peer = state.peers.get(peerId);
  if (peer?.audio) peer.audio.volume = clamped;
}

function removePeer(id) {
  const peer = state.peers.get(id);
  if (!peer) return;

  peer.pc.close();
  peer.audio?.remove();
  state.peers.delete(id);
}

function updatePeerPresence(message) {
  const peer = state.peers.get(message.id);
  if (!peer) return;

  peer.muted = Boolean(message.muted);
  peer.talking = Boolean(message.talking);
}

function updatePeerName(message) {
  const peer = state.peers.get(message.id);
  if (!peer) return;

  const name = String(message.name || "").trim();
  if (name) peer.name = name;
}

function toggleMute() {
  state.muted = !state.muted;
  if (state.muted) state.pttHeld = false;
  applyTrackState();
  render();
}

function togglePtt() {
  state.ptt = !state.ptt;
  state.pttHeld = false;
  applyTrackState();
  render();
}

function effectiveMuted() {
  if (!state.joined || state.muted) return true;
  if (state.ptt && !state.pttHeld) return true;
  return false;
}

function applyTrackState() {
  const enabled = !effectiveMuted();
  for (const track of state.localStream?.getAudioTracks() || []) {
    track.enabled = enabled;
  }

  sendPresence({ muted: !enabled, talking: enabled && state.talking });
}

function sendPresence(next = {}) {
  const payload = {
    muted: Boolean(next.muted),
    talking: Boolean(next.talking)
  };

  if (
    payload.muted === state.lastPresence.muted &&
    payload.talking === state.lastPresence.talking
  ) {
    return;
  }

  state.lastPresence = payload;

  if (state.socket?.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify({ type: "presence", ...payload }));
  }
}

function setupLocalMeter(stream) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  state.audioContext = new AudioContextClass();
  state.meterSource = state.audioContext.createMediaStreamSource(stream);
  state.meterAnalyser = state.audioContext.createAnalyser();
  state.meterAnalyser.fftSize = 512;
  state.meterData = new Uint8Array(state.meterAnalyser.frequencyBinCount);
  state.meterSource.connect(state.meterAnalyser);

  tickMeter();
}

function tickMeter() {
  if (!state.meterAnalyser) return;

  state.meterAnalyser.getByteTimeDomainData(state.meterData);

  let sum = 0;
  for (const value of state.meterData) {
    const centered = (value - 128) / 128;
    sum += centered * centered;
  }

  const rms = Math.sqrt(sum / state.meterData.length);
  const level = Math.min(1, rms * 5);
  meterBar.style.width = `${Math.round(level * 100)}%`;

  const nextTalking = !effectiveMuted() && level > 0.12;
  if (nextTalking !== state.talking) {
    state.talking = nextTalking;
    sendPresence({ muted: effectiveMuted(), talking: state.talking });
    render();
  }

  state.meterFrame = requestAnimationFrame(tickMeter);
}

function leaveVoice() {
  resetConnection(true);
}

function resetConnection(showIdle) {
  for (const peer of state.peers.values()) {
    peer.pc.close();
    peer.audio?.remove();
  }

  state.peers.clear();

  if (state.socket && state.socket.readyState <= WebSocket.OPEN) {
    state.socket.close();
  }

  state.socket = null;
  state.localId = null;
  state.joined = false;
  state.connecting = false;
  state.muted = false;
  state.pttHeld = false;
  state.talking = false;
  state.lastPresence = { muted: false, talking: false };

  stopLocalStream();
  stopMeter();

  if (showIdle) {
    setStatus("idle", "离线");
    state.preview = [];
    loadRoomPreview();
  }

  render();
}

function stopLocalStream() {
  for (const track of state.localStream?.getTracks() || []) {
    track.stop();
  }
  state.localStream = null;
}

function stopMeter() {
  if (state.meterFrame) {
    cancelAnimationFrame(state.meterFrame);
    state.meterFrame = 0;
  }
  state.audioContext?.close().catch(() => {});
  state.audioContext = null;
  state.meterSource = null;
  state.meterAnalyser = null;
  state.meterData = null;
  meterBar.style.width = "0%";
}

function setStatus(stateName, text) {
  statusPill.dataset.state = stateName;
  statusPill.textContent = text;
}

function render() {
  joinButton.disabled = state.joined || state.connecting;
  leaveButton.disabled = !state.joined && !state.connecting;
  muteButton.disabled = !state.joined;
  pttButton.disabled = !state.joined;
  muteButton.setAttribute("aria-pressed", String(state.muted));
  pttButton.setAttribute("aria-pressed", String(state.ptt));

  const mutedNow = state.joined && effectiveMuted();
  muteButton.textContent = mutedNow ? "已静音" : "静音";
  pttButton.textContent = state.ptt ? "按键说话 · 开" : "按键说话";

  const people = [];
  if (state.joined || state.connecting) {
    people.push({
      id: state.localId || "local",
      name: `${nameInput.value.trim() || "Player"}（你）`,
      muted: effectiveMuted(),
      talking: state.talking,
      status: state.connecting ? "connecting" : "connected"
    });
    for (const peer of state.peers.values()) {
      people.push(peer);
    }
  } else {
    for (const peer of state.preview) {
      people.push({
        id: peer.id,
        name: peer.name || "Player",
        muted: Boolean(peer.muted),
        talking: Boolean(peer.talking),
        status: "preview"
      });
    }
  }

  peopleCount.textContent = String(people.length);

  const existing = new Map();
  for (const li of peopleList.children) {
    existing.set(li.dataset.id, li);
  }

  const next = [];
  for (const person of people) {
    let li = existing.get(person.id);
    if (li) {
      existing.delete(person.id);
      updatePersonItem(li, person);
    } else {
      li = createPersonItem(person);
    }
    next.push(li);
  }

  for (const li of existing.values()) li.remove();
  peopleList.replaceChildren(...next);
}

function createPersonItem(person) {
  const item = document.createElement("li");
  item.className = "person";
  item.dataset.id = person.id;

  const avatar = document.createElement("div");
  avatar.className = "avatar";

  const main = document.createElement("div");
  main.className = "person-main";

  const name = document.createElement("div");
  name.className = "person-name";

  const stateLine = document.createElement("div");
  stateLine.className = "person-state";

  main.append(name, stateLine);
  item.append(avatar, main);

  if (isRemotePerson(person)) {
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.step = "1";
    slider.className = "person-volume";
    slider.title = "音量";
    slider.value = String(Math.round((state.peerVolumes.get(person.id) ?? 1) * 100));
    slider.addEventListener("input", () => {
      setPeerVolume(person.id, Number(slider.value) / 100);
    });
    item.append(slider);
  }

  updatePersonItem(item, person);
  return item;
}

function updatePersonItem(item, person) {
  item.dataset.talking = String(Boolean(person.talking));
  item.dataset.muted = String(Boolean(person.muted));
  item.querySelector(".avatar").textContent = initials(person.name);
  item.querySelector(".person-name").textContent = person.name;
  item.querySelector(".person-state").textContent = personStateText(person);
}

function isRemotePerson(person) {
  return person.id !== "local" && person.id !== state.localId;
}

function personStateText(person) {
  if (person.status === "connecting") return "连接中";
  if (person.muted) return "静音";
  if (person.talking) return "说话中";
  if (person.status === "failed") return "连接失败";
  return "在线";
}

function initials(name) {
  const cleaned = String(name || "P").replace("（你）", "").trim();
  return cleaned.slice(0, 2).toUpperCase();
}

function showToast(message) {
  toast.textContent = message;
  toast.dataset.show = "true";
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    toast.dataset.show = "false";
  }, 1800);
}

function showNetworkNote(message) {
  networkNote.hidden = false;
  networkNote.textContent = message;
}

function isLoopbackHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isTypingTarget(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
}
