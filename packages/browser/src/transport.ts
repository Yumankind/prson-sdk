/**
 * Browser-side WebRTC transport. Orchestrates the SDP offer / answer +
 * ICE exchange via the Cloudflare Worker signaling, and exposes a
 * tiny event-stream interface over the established data channel.
 */
import type { SignalingConnection } from "./signaling.js";

export interface Transport {
  /** Await the next data-channel message as a UTF-8 string. */
  awaitNextMessage(): Promise<string>;
  /** Await the first data-channel message; convenience wrapper. */
  awaitFirstMessage(): Promise<string>;
  /** Subscribe to all data-channel messages as they arrive. */
  onMessage(cb: (raw: string) => void): void;
  /** Subscribe to terminal-close events from either side or the
   *  Worker. Fires exactly once per transport with a short string
   *  reason — the SDK's session layer maps this to the matching
   *  `signed_out` reason code so the host gets a lifecycle event
   *  the moment the wire dies (rather than waiting for the
   *  credential's exp timer, which runs days from now and never
   *  matches the much-shorter session TTL). */
  onClose(cb: (reason: string) => void): void;
  /** Send a UTF-8 string over the data channel (used by `revoke` etc.). */
  send(raw: string): void;
  /** Close the RTCPeerConnection + the data channel. */
  close(): void;
}

/**
 * RTCPeerConnection config for the browser side. With TURN available
 * the browser is relay-only (`iceTransportPolicy: "relay"`, no STUN):
 * it gathers only relay candidates, so none of its own addresses (LAN,
 * public) reach the phone — the wallet has done the same since M-4.
 * A dev relay without TURN credentials hands out STUN only; relay-only
 * would find no candidates, so that case falls back to `"all"`.
 */
export function rtcConfigFor(iceServers: RTCIceServer[]): RTCConfiguration {
  const urls = (s: RTCIceServer) => (Array.isArray(s.urls) ? s.urls : [s.urls]);
  const isTurn = (u: string) => /^turns?:/i.test(u);
  const turn = iceServers
    .map((s) => ({ ...s, urls: urls(s).filter(isTurn) }))
    .filter((s) => s.urls.length > 0);
  if (turn.length > 0) return { iceServers: turn, iceTransportPolicy: "relay" };
  return { iceServers, iceTransportPolicy: "all" };
}

/** How long a live data channel must stay silent after a `peer-gone`
 *  before we believe it. The wallet pings every 2 s. */
const PEER_GONE_CONFIRM_MS = 6000;

export async function establishTransport(opts: {
  signaling: SignalingConnection;
  role: "browser";
  /**
   * ICE servers from the relay: the `ice` message it sends once a wallet
   * claimed the code, or (older relays) the draft response's `turn`.
   * See [rtcConfigFor] and ../../SECURITY.md §6.
   */
  iceServers: RTCIceServer[];
}): Promise<Transport> {
  const pc = new RTCPeerConnection(rtcConfigFor(opts.iceServers));

  // Browser is the initiator → opens the data channel before the
  // offer. Negotiated=false so the wallet sees `ondatachannel`.
  const dc = pc.createDataChannel("prson-login", { ordered: true });

  // Trickle ICE → signaling.
  pc.addEventListener("icecandidate", (e) => {
    if (e.candidate) opts.signaling.send({ msg: "candidate", candidate: e.candidate.toJSON() });
  });

  // Bridge inbound signaling → peer connection.
  opts.signaling.onMessage(async (m) => {
    if (m.msg === "answer") {
      await pc.setRemoteDescription({ type: "answer", sdp: m.sdp });
    } else if (m.msg === "candidate") {
      try {
        await pc.addIceCandidate(m.candidate as RTCIceCandidateInit);
      } catch {
        // Late or duplicate candidates can be ignored — the SDP path
        // covered the gathered ones.
      }
    } else if (m.msg === "peer-gone") {
      // `peer-gone` is the relay's word that the wallet's socket went
      // away. It travels the same socket as the wallet's own messages,
      // so it isn't proof: once the data channel is up, the channel
      // itself decides — if the wallet stays silent (it pings every
      // 2 s), it's gone; if it keeps talking, the notice is ignored.
      // `error` frames are never acted on.
      if (dc.readyState === "open") {
        confirmPeerGone();
        return;
      }
      // Wallet vanished — close the data channel so the host knows.
      // Fire the explicit teardown FIRST with a wallet-side reason
      // so the SDK maps it to `wallet_signed_out` (the dc close
      // alone would degrade to the generic `network_loss`).
      fireClose("wallet_signed_out");
      try { dc.close(); } catch { /* */ }
    }
  });

  let lastDcMessageAt = 0;
  let peerGoneTimer: ReturnType<typeof setTimeout> | null = null;
  function confirmPeerGone() {
    if (peerGoneTimer) return;
    const noticeAt = Date.now();
    peerGoneTimer = setTimeout(() => {
      peerGoneTimer = null;
      if (lastDcMessageAt >= noticeAt) return; // still talking: not gone
      fireClose("wallet_signed_out");
      try { dc.close(); } catch { /* */ }
    }, PEER_GONE_CONFIRM_MS);
  }

  // Generate + post the SDP offer.
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  opts.signaling.send({ msg: "offer", sdp: offer.sdp! });

  // Wait for the data channel to open.
  await new Promise<void>((resolve, reject) => {
    if (dc.readyState === "open") return resolve();
    const onOpen = () => {
      dc.removeEventListener("open", onOpen);
      dc.removeEventListener("error", onError);
      resolve();
    };
    const onError = () => {
      dc.removeEventListener("open", onOpen);
      dc.removeEventListener("error", onError);
      reject(new Error("transport: data channel failed to open"));
    };
    dc.addEventListener("open", onOpen);
    dc.addEventListener("error", onError);
  });

  // Message bookkeeping: split between one-shot waiters (the initial
  // presentation) and steady-state subscribers (renewals).
  const oneShotWaiters: Array<(raw: string) => void> = [];
  const allListeners: Array<(raw: string) => void> = [];
  // Terminal-close fan-out. Three triggers map onto the same
  // notification: signaling close (WS code 4000 = Worker DO alarm
  // fired at session TTL), peer-gone signaling message (wallet
  // revoked), and the data channel itself closing for any other
  // reason. Fired at most once — the latch prevents duplicate
  // signed_out events in the SDK's session layer.
  const closeListeners: Array<(reason: string) => void> = [];
  let closeFired = false;
  function fireClose(reason: string) {
    if (closeFired) return;
    closeFired = true;
    for (const cb of closeListeners) {
      try { cb(reason); } catch { /* swallow */ }
    }
  }
  opts.signaling.onClose((reason) => fireClose(reason));
  dc.addEventListener("close", () => fireClose("network_loss"));
  dc.addEventListener("message", (evt) => {
    lastDcMessageAt = Date.now();
    const raw = typeof evt.data === "string"
      ? evt.data
      : new TextDecoder().decode(evt.data as ArrayBuffer);
    while (oneShotWaiters.length > 0) {
      const cb = oneShotWaiters.shift()!;
      cb(raw);
    }
    for (const cb of allListeners) cb(raw);
  });

  return {
    awaitNextMessage() {
      return new Promise((resolve) => oneShotWaiters.push(resolve));
    },
    awaitFirstMessage() {
      return new Promise((resolve) => oneShotWaiters.push(resolve));
    },
    onMessage(cb) {
      allListeners.push(cb);
    },
    onClose(cb) {
      // Late subscribers still get the notification: if the close
      // already fired, dispatch on the next microtask so the
      // subscriber's await chain sees a single deterministic
      // ordering (analogous to `signed_in` being microtask-deferred).
      if (closeFired) {
        queueMicrotask(() => cb("network_loss"));
      } else {
        closeListeners.push(cb);
      }
    },
    send(raw: string) {
      if (dc.readyState === "open") dc.send(raw);
    },
    close() {
      if (peerGoneTimer) clearTimeout(peerGoneTimer);
      try { dc.close(); } catch { /* */ }
      try { pc.close(); } catch { /* */ }
      opts.signaling.close();
    },
  };
}
