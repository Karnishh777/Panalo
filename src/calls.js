// 1:1 voice and video calls over WebRTC.
//
// Signaling rides on Supabase Realtime Broadcast, so there's no separate
// signaling server: each client listens on a channel named after its own user
// id, and a caller joins the callee's channel just long enough to send.
// Conversation ids and user ids are UUIDs, so channel names aren't guessable.
//
// NAT traversal uses public STUN only. That covers most home and office
// networks; connections that need a relay (symmetric NAT — common on some
// mobile carriers) will fail until a TURN service is added, and the UI says so
// plainly rather than spinning forever.
import { supabaseClient } from "./client.js";
import { state } from "./state.js";
import { el, showToast, setAvatar } from "./util.js";
import { icon } from "./icons.js";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
];

const RING_TIMEOUT_MS = 35000;
// How often the caller re-announces while ringing, so a callee who comes online
// mid-ring still receives the offer.
const RING_REANNOUNCE_MS = 3000;

// ---- Call history ----
// A finished call is written into the conversation as an ordinary (encrypted)
// message, so history lives with the chat it belongs to and needs no new table.
// Only the caller writes it, so a call never appears twice.
const CALL_MARKER = /^\[\[call:(voice|video):(completed|missed|declined|failed):(\d+)\]\]$/;

export function callMarker(kind, status, seconds) {
  return `[[call:${kind}:${status}:${Math.max(0, Math.round(seconds))}]]`;
}

export function parseCall(text) {
  const m = typeof text === "string" ? text.trim().match(CALL_MARKER) : null;
  if (!m) return null;
  return { kind: m[1], status: m[2], seconds: Number(m[3]) };
}

export function describeCall(text) {
  const c = parseCall(text);
  if (!c) return text;
  const kind = c.kind === "video" ? "Video call" : "Voice call";
  if (c.status === "completed") return `${kind} · ${formatDuration(c.seconds)}`;
  if (c.status === "missed") return `Missed ${kind.toLowerCase()}`;
  if (c.status === "declined") return `Declined ${kind.toLowerCase()}`;
  return `${kind} failed`;
}

export function formatDuration(secs) {
  const mm = Math.floor(secs / 60);
  const ss = secs % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

let logger = null;
export function setCallLogger(fn) {
  logger = fn;
}

let myChannel = null;
let pc = null;
let localStream = null;
let remoteStream = null;
let ringTimer = null;
let ringRepeat = null;
let durationTimer = null;
let callStartedAt = 0;
// Candidates can arrive before the remote description is set; hold them.
let pendingCandidates = [];

// null when idle. { peerId, peerName, peerAvatar, video, incoming, offer }
let call = null;

const $ = (id) => document.getElementById(id);

// ---- Signaling ----
async function signal(peerId, event, payload) {
  const ch = supabaseClient.channel(`call:${peerId}`);
  // Never await this forever: a channel that never reports SUBSCRIBED would
  // otherwise hang hang-up and teardown along with it.
  await new Promise((resolve) => {
    const done = setTimeout(resolve, 4000);
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(done);
        resolve();
      }
    });
  });
  try {
    await ch.send({ type: "broadcast", event, payload: { ...payload, from: state.currentUser.id } });
  } catch {
    /* the call teardown continues regardless */
  }
  // Give the message a moment to flush before tearing the channel down.
  setTimeout(() => supabaseClient.removeChannel(ch), 1200);
}

export function startCalls() {
  if (myChannel || !state.currentUser) return;
  myChannel = supabaseClient
    .channel(`call:${state.currentUser.id}`)
    .on("broadcast", { event: "offer" }, ({ payload }) => onOffer(payload))
    .on("broadcast", { event: "answer" }, ({ payload }) => onAnswer(payload))
    .on("broadcast", { event: "ice" }, ({ payload }) => onRemoteCandidate(payload))
    .on("broadcast", { event: "end" }, () => endCall(false, "Call ended"))
    .on("broadcast", { event: "decline" }, () => endCall(false, "Call declined"))
    .on("broadcast", { event: "busy" }, () => endCall(false, "They're on another call"))
    .subscribe();
}

export function stopCalls() {
  endCall(false);
  if (myChannel) {
    supabaseClient.removeChannel(myChannel);
    myChannel = null;
  }
}

// ---- Peer connection ----
function createPeer(peerId) {
  const conn = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  conn.onicecandidate = (e) => {
    if (e.candidate) signal(peerId, "ice", { candidate: e.candidate });
  };

  conn.ontrack = (e) => {
    remoteStream = e.streams[0];
    const remote = $("call-remote");
    remote.srcObject = remoteStream;
    remote.play?.().catch(() => {});
    setStatus("Connected");
    startDuration();
  };

  conn.onconnectionstatechange = () => {
    if (conn.connectionState === "failed") {
      // One ICE restart, then give up with an honest message.
      if (!conn._restarted) {
        conn._restarted = true;
        setStatus("Reconnecting…");
        restartIce(peerId);
      } else {
        endCall(true, "Couldn't connect — this network needs a TURN relay.");
      }
    } else if (conn.connectionState === "disconnected") {
      setStatus("Reconnecting…");
    } else if (conn.connectionState === "connected") {
      setStatus("Connected");
    }
  };

  return conn;
}

async function restartIce(peerId) {
  try {
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    await signal(peerId, "offer", { sdp: offer, video: call?.video, restart: true });
  } catch {
    endCall(true, "Reconnection failed");
  }
}

async function getMedia(video) {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: video ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
  } catch (err) {
    if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
      showToast("Microphone/camera permission was blocked — allow it in your browser's site settings.");
    } else if (err && err.name === "NotFoundError") {
      showToast(video ? "No camera found on this device." : "No microphone found on this device.");
    } else {
      showToast("Could not start your microphone or camera.");
    }
    return null;
  }
}

// ---- Outgoing ----
export async function startCall(peer, wantVideo) {
  if (call) {
    showToast("You're already on a call.");
    return;
  }
  if (!peer?.id) {
    showToast("Calls are for direct chats only.");
    return;
  }
  call = {
    peerId: peer.id,
    peerName: peer.name,
    peerAvatar: peer.avatar,
    video: wantVideo,
    incoming: false,
    conversationId: peer.conversationId || null,
  };
  openOverlay("Calling…");

  localStream = await getMedia(wantVideo);
  if (!localStream) return endCall(false);
  attachLocal();

  pc = createPeer(peer.id);
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const payload = { sdp: offer, video: wantVideo, name: state.currentUsername };
  await signal(peer.id, "offer", payload);

  // Signaling is a live broadcast: someone who isn't connected yet simply never
  // hears it. Re-announcing while the phone rings means a person who opens the
  // app mid-call still sees it, instead of the call ringing into nothing.
  ringRepeat = setInterval(() => {
    if (!call || call.answered) return;
    signal(peer.id, "offer", payload);
  }, RING_REANNOUNCE_MS);

  ringTimer = setTimeout(() => endCall(true, "No answer"), RING_TIMEOUT_MS);
}

// ---- Incoming ----
async function onOffer(payload) {
  // A renegotiation for the call already in progress (ICE restart).
  if (call && payload.restart && pc && payload.from === call.peerId) {
    await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    signal(call.peerId, "answer", { sdp: answer });
    return;
  }
  // The caller re-announces every few seconds while ringing; a repeat from the
  // peer we're already ringing with is that, not a second caller. Treating it
  // as "busy" would hang up the very call being announced.
  if (call && call.peerId === payload.from) return;

  if (call) {
    signal(payload.from, "busy", {});
    return;
  }

  call = {
    peerId: payload.from,
    peerName: payload.name || "Someone",
    video: !!payload.video,
    incoming: true,
    offer: payload.sdp,
  };
  openOverlay(payload.video ? "Incoming video call" : "Incoming voice call", true);
  ringTimer = setTimeout(() => endCall(true, "Missed call"), RING_TIMEOUT_MS);
}

async function acceptCall() {
  if (!call?.incoming) return;
  clearTimeout(ringTimer);
  $("call-answer-row").classList.add("hidden");
  // Swap the ring buttons for the in-call ones. Without this the person who
  // answered has no controls at all — no mute, no camera, and no way to hang
  // up, so only the caller could ever end the call.
  $("call-controls").classList.remove("hidden");
  setStatus("Connecting…");

  localStream = await getMedia(call.video);
  if (!localStream) {
    signal(call.peerId, "decline", {});
    return endCall(false);
  }
  attachLocal();

  pc = createPeer(call.peerId);
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  await pc.setRemoteDescription(new RTCSessionDescription(call.offer));
  await flushCandidates();
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await signal(call.peerId, "answer", { sdp: answer });
}

async function onAnswer(payload) {
  if (!pc || !call) return;
  call.answered = true;
  clearTimeout(ringTimer);
  clearInterval(ringRepeat);
  ringRepeat = null;
  await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
  await flushCandidates();
  setStatus("Connecting…");
}

async function onRemoteCandidate(payload) {
  if (!payload.candidate) return;
  if (!pc || !pc.remoteDescription) {
    pendingCandidates.push(payload.candidate);
    return;
  }
  try {
    await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
  } catch {
    /* a stale candidate is not fatal */
  }
}

async function flushCandidates() {
  for (const c of pendingCandidates) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(c));
    } catch {
      /* ignore */
    }
  }
  pendingCandidates = [];
}

// ---- Teardown ----
export function endCall(notifyPeer = true, reason = "") {
  if (notifyPeer && call?.peerId) {
    signal(call.peerId, call.incoming && $("call-answer-row") && !$("call-answer-row").classList.contains("hidden") ? "decline" : "end", {});
  }
  // Write the call into the conversation before state is cleared. Only the
  // caller logs, so one call produces one history entry, not two.
  if (call && !call.incoming && call.conversationId && logger) {
    const seconds = callStartedAt ? Math.round((Date.now() - callStartedAt) / 1000) : 0;
    let status = "failed";
    if (callStartedAt) status = "completed";
    else if (/declin/i.test(reason)) status = "declined";
    else if (/no answer|missed/i.test(reason)) status = "missed";
    logger(call.conversationId, callMarker(call.video ? "video" : "voice", status, seconds));
  }

  clearTimeout(ringTimer);
  clearInterval(ringRepeat);
  clearInterval(durationTimer);
  ringTimer = null;
  ringRepeat = null;
  durationTimer = null;
  callStartedAt = 0;

  if (pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    try {
      pc.close();
    } catch {
      /* ignore */
    }
    pc = null;
  }
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
  remoteStream = null;
  pendingCandidates = [];

  const overlay = $("call-overlay");
  if (overlay) {
    $("call-remote").srcObject = null;
    $("call-local").srcObject = null;
    overlay.classList.add("hidden");
  }
  if (reason) showToast(reason, "");
  call = null;
}

// ---- UI ----
function setStatus(text) {
  const s = $("call-status");
  if (s) s.textContent = text;
}

function startDuration() {
  if (durationTimer) return;
  callStartedAt = Date.now();
  durationTimer = setInterval(() => {
    const secs = Math.floor((Date.now() - callStartedAt) / 1000);
    const mm = String(Math.floor(secs / 60)).padStart(2, "0");
    const ss = String(secs % 60).padStart(2, "0");
    setStatus(`${mm}:${ss}`);
  }, 1000);
}

function attachLocal() {
  const local = $("call-local");
  local.srcObject = localStream;
  local.muted = true;
  local.play?.().catch(() => {});
  local.classList.toggle("hidden", !call.video);
}

function openOverlay(status, incoming = false) {
  const overlay = $("call-overlay");
  $("call-name").textContent = call.peerName || "Call";
  setStatus(status);
  setAvatar($("call-avatar"), call.peerName || "?", call.peerAvatar);
  overlay.classList.toggle("video-call", !!call.video);
  $("call-answer-row").classList.toggle("hidden", !incoming);
  $("call-controls").classList.toggle("hidden", incoming);
  $("call-local").classList.add("hidden");
  overlay.classList.remove("hidden");
}

export function initCalls() {
  $("call-hangup").addEventListener("click", () => endCall(true));
  $("call-decline").addEventListener("click", () => {
    if (call) signal(call.peerId, "decline", {});
    endCall(false);
  });
  $("call-accept").addEventListener("click", acceptCall);

  // Mute / camera toggles operate on the live tracks.
  $("call-mute").addEventListener("click", () => {
    const track = localStream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    const btn = $("call-mute");
    btn.innerHTML = "";
    btn.append(icon(track.enabled ? "mic" : "micOff", 20));
    btn.classList.toggle("off", !track.enabled);
  });

  $("call-camera").addEventListener("click", () => {
    const track = localStream?.getVideoTracks()[0];
    if (!track) {
      showToast("This is a voice call.");
      return;
    }
    track.enabled = !track.enabled;
    const btn = $("call-camera");
    btn.innerHTML = "";
    btn.append(icon(track.enabled ? "video" : "videoOff", 20));
    btn.classList.toggle("off", !track.enabled);
    $("call-local").classList.toggle("hidden", !track.enabled);
  });

  // Seed the button icons.
  $("call-mute").append(icon("mic", 20));
  $("call-camera").append(icon("video", 20));
  $("call-hangup").append(icon("phoneOff", 20));
  $("call-accept").append(icon("phone", 20));
  $("call-decline").append(icon("phoneOff", 20));
}

export function callInProgress() {
  return !!call;
}
