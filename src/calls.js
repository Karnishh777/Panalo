// 1:1 voice and video calls over WebRTC.
//
// The offer/answer handshake — the two messages that establish WHO is calling
// whom — goes through the call_invites table (see supabase-phase7.sql), with
// caller_id stamped server-side exactly like message sender identity already
// is. Broadcast alone can't do that: a client-supplied "from" field in a
// broadcast payload is just a claim, and since any authenticated user can
// resolve any other user's id via the public profiles read policy, a spoofed
// broadcast offer could trick someone into a live call with an impersonator.
//
// ICE candidates (and ICE-restart renegotiation) still ride Realtime
// Broadcast — frequent, low-stakes once both sides are already identity-
// verified via the trusted invite row — but on a channel named after that
// row's own random id, not a permanent per-user channel.
//
// NAT traversal uses public STUN only. That covers most home and office
// networks; connections that need a relay (symmetric NAT — common on some
// mobile carriers) will fail until a TURN service is added, and the UI says so
// plainly rather than spinning forever.
import { supabaseClient } from "./client.js";
import { state } from "./state.js";
import { showToast, setAvatar } from "./util.js";
import { icon } from "./icons.js";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
];

const RING_TIMEOUT_MS = 35000;

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

let myChannel = null; // postgres_changes: incoming invites + status updates
let sigChannel = null; // broadcast: ICE candidates + ICE-restart for the active call
let sigReady = false;
let sigQueue = [];
let pc = null;
let localStream = null;
let remoteStream = null;
let ringTimer = null;
let durationTimer = null;
let callStartedAt = 0;
// Candidates can arrive before the remote description is set; hold them.
let pendingCandidates = [];

// null when idle. { peerId, peerName, peerAvatar, video, incoming, offer, inviteId, conversationId, answered }
let call = null;

const $ = (id) => document.getElementById(id);

// ---- Ephemeral signaling (ICE only) — scoped to one call's random invite id ----
function openSignalChannel(inviteId) {
  closeSignalChannel();
  sigChannel = supabaseClient
    .channel(`call-sig:${inviteId}`, { config: { broadcast: { self: false } } })
    .on("broadcast", { event: "ice" }, ({ payload }) => onRemoteCandidate(payload))
    .on("broadcast", { event: "restart-offer" }, ({ payload }) => onRestartOffer(payload))
    .on("broadcast", { event: "restart-answer" }, ({ payload }) => onRestartAnswer(payload))
    .subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      sigReady = true;
      const queued = sigQueue;
      sigQueue = [];
      queued.forEach((msg) => sigChannel?.send(msg));
    });
}

function sendSignal(event, payload) {
  const msg = { type: "broadcast", event, payload };
  if (sigReady && sigChannel) sigChannel.send(msg);
  else sigQueue.push(msg);
}

function closeSignalChannel() {
  if (sigChannel) supabaseClient.removeChannel(sigChannel);
  sigChannel = null;
  sigReady = false;
  sigQueue = [];
}

// Best-effort: the row update is how the other side finds out. A failed
// write just means they'll notice via their own ring timeout instead.
async function updateInviteStatus(inviteId, fields) {
  if (!inviteId) return;
  try {
    await supabaseClient.from("call_invites").update(fields).eq("id", inviteId);
  } catch {
    /* the local teardown continues regardless */
  }
}

// ---- Incoming: trusted invite handling ----
async function onInvite(row) {
  if (!row || row.status !== "ringing") return;

  if (call) {
    // Already on a call — decline this new one without disturbing the active
    // one. Doesn't touch `call`, so no local UI change.
    updateInviteStatus(row.id, { status: "busy" });
    return;
  }

  let offer;
  try {
    offer = JSON.parse(row.offer_sdp);
  } catch {
    return; // malformed row — ignore rather than crash the call UI
  }

  // caller_id is server-verified (see set_call_invite_caller in
  // supabase-phase7.sql); the display name/avatar come from that trusted id,
  // never from anything the calling client could have supplied itself.
  const { data: callerProfile } = await supabaseClient
    .from("profiles")
    .select("username, avatar_url")
    .eq("id", row.caller_id)
    .maybeSingle();

  call = {
    peerId: row.caller_id,
    peerName: callerProfile?.username || "Someone",
    peerAvatar: callerProfile?.avatar_url || null,
    video: row.kind === "video",
    incoming: true,
    offer,
    inviteId: row.id,
  };
  openSignalChannel(row.id);
  openOverlay(call.video ? "Incoming video call" : "Incoming voice call", true);
  ringTimer = setTimeout(() => {
    updateInviteStatus(row.id, { status: "missed" });
    endCall(false, "Missed call");
  }, RING_TIMEOUT_MS);
}

// The callee (or caller) updated a row I have the other end of.
function onInviteUpdateAsCaller(row) {
  if (!call || call.incoming || call.inviteId !== row.id) return;
  if (row.status === "answered" && row.answer_sdp && !call.answered) {
    call.answered = true;
    clearTimeout(ringTimer);
    let answer;
    try {
      answer = JSON.parse(row.answer_sdp);
    } catch {
      return endCall(true, "Reconnection failed");
    }
    pc?.setRemoteDescription(new RTCSessionDescription(answer)).then(flushCandidates).catch(() => endCall(true, "Reconnection failed"));
    setStatus("Connecting…");
  } else if (row.status === "declined") {
    endCall(false, "Call declined");
  } else if (row.status === "busy") {
    endCall(false, "They're on another call");
  } else if (row.status === "ended") {
    endCall(false, "Call ended");
  }
}

function onInviteUpdateAsCallee(row) {
  if (!call || !call.incoming || call.inviteId !== row.id) return;
  if (row.status === "ended") endCall(false, "Call ended");
}

// Catch-up for a client that (re)connects to Realtime after the offer's
// INSERT event already fired — e.g. the app was opening when the call came
// in. Replaces the old "re-announce every few seconds" broadcast pattern:
// the invite persists in the table, so a client just checks for it directly.
async function checkForRingingInvite() {
  if (call || !state.currentUser) return;
  const since = new Date(Date.now() - RING_TIMEOUT_MS).toISOString();
  const { data } = await supabaseClient
    .from("call_invites")
    .select("*")
    .eq("callee_id", state.currentUser.id)
    .eq("status", "ringing")
    .gt("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  if (data && data[0]) await onInvite(data[0]);
}

export function startCalls() {
  if (myChannel || !state.currentUser) return;
  const me = state.currentUser.id;
  myChannel = supabaseClient
    .channel(`calls:${me}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "call_invites", filter: `callee_id=eq.${me}` },
      (payload) => onInvite(payload.new)
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "call_invites", filter: `caller_id=eq.${me}` },
      (payload) => onInviteUpdateAsCaller(payload.new)
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "call_invites", filter: `callee_id=eq.${me}` },
      (payload) => onInviteUpdateAsCallee(payload.new)
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") checkForRingingInvite();
    });
}

export function stopCalls() {
  endCall(false);
  if (myChannel) {
    supabaseClient.removeChannel(myChannel);
    myChannel = null;
  }
}

// ---- Peer connection ----
function createPeer() {
  const conn = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  conn.onicecandidate = (e) => {
    if (e.candidate) sendSignal("ice", { candidate: e.candidate });
  };

  conn.ontrack = (e) => {
    remoteStream = e.streams[0];
    const remote = $("call-remote");
    remote.srcObject = remoteStream;
    // iOS Safari sometimes blocks autoplay on the remote video until the user
    // touches the screen. If play() rejects, wait for the next tap and try
    // again — otherwise the connection is up but the video looks frozen.
    remote.play?.().catch(() => {
      const kick = () => {
        remote.play?.().catch(() => {});
        document.removeEventListener("touchend", kick);
        document.removeEventListener("click", kick);
      };
      document.addEventListener("touchend", kick, { once: true });
      document.addEventListener("click", kick, { once: true });
    });
    setStatus("Connected");
    startDuration();
  };

  conn.onconnectionstatechange = () => {
    if (conn.connectionState === "failed") {
      // One ICE restart, then give up with an honest message.
      if (!conn._restarted) {
        conn._restarted = true;
        setStatus("Reconnecting…");
        restartIce();
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

async function restartIce() {
  try {
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    sendSignal("restart-offer", { sdp: offer });
  } catch {
    endCall(true, "Reconnection failed");
  }
}

async function onRestartOffer(payload) {
  if (!pc || !call) return;
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendSignal("restart-answer", { sdp: answer });
  } catch {
    /* the connection either recovers on its own or the failed-state handler takes over */
  }
}

async function onRestartAnswer(payload) {
  if (!pc) return;
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
  } catch {
    /* ignore */
  }
}

async function getMedia(video) {
  try {
    // facingMode:"user" asks mobile Safari/Chrome for the FRONT camera —
    // without it they often pick the rear-facing one, which is nobody's
    // expectation on a chat call. Constraints stay ideal (not exact) so a
    // device without the requested size still returns something usable.
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: video
        ? {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          }
        : false,
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

  pc = createPeer();
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const { data: invite, error: inviteError } = await supabaseClient
    .from("call_invites")
    .insert([{ callee_id: peer.id, kind: wantVideo ? "video" : "voice", offer_sdp: JSON.stringify(offer) }])
    .select()
    .single();
  if (inviteError || !invite) {
    showToast("Could not start the call.");
    return endCall(false);
  }
  call.inviteId = invite.id;
  openSignalChannel(invite.id);

  ringTimer = setTimeout(() => {
    updateInviteStatus(invite.id, { status: "missed" });
    endCall(false, "No answer");
  }, RING_TIMEOUT_MS);
}

// ---- Incoming: accept / media ----
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
    updateInviteStatus(call.inviteId, { status: "declined" });
    return endCall(false);
  }
  attachLocal();

  pc = createPeer();
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  await pc.setRemoteDescription(new RTCSessionDescription(call.offer));
  await flushCandidates();
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await updateInviteStatus(call.inviteId, { status: "answered", answer_sdp: JSON.stringify(answer) });
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
  if (notifyPeer && call?.inviteId) {
    const ringing = $("call-answer-row") && !$("call-answer-row").classList.contains("hidden");
    updateInviteStatus(call.inviteId, { status: call.incoming && ringing ? "declined" : "ended" });
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
  clearInterval(durationTimer);
  ringTimer = null;
  durationTimer = null;
  callStartedAt = 0;
  closeSignalChannel();

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
    if (call) updateInviteStatus(call.inviteId, { status: "declined" });
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
