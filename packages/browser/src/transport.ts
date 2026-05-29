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

export async function establishTransport(opts: {
  /** Browser uses STUN by default; when [turn] is supplied the
   *  Worker also minted a TURN allocation for the browser so ICE can
   *  succeed across symmetric NATs and Chrome's mDNS-obfuscated host
   *  candidates that iOS WebRTC can't resolve. See ../../SECURITY.md §6. */
  stunOnly: true;
  signaling: SignalingConnection;
  role: "browser";
  /** Optional TURN creds from `/session/draft`. When present, the
   *  browser gathers a relay candidate of its own — necessary on
   *  localhost + Chrome where host candidates are .local mDNS names
   *  iOS WebRTC can't resolve, and on any symmetric NAT. */
  turn?: {
    urls: string | string[];
    username: string;
    credential: string;
  };
}): Promise<Transport> {
  const iceServers: RTCIceServer[] = [
    // Cloudflare STUN (free, no auth) — lets the browser gather host
    // + server-reflexive candidates so the wallet has somewhere to
    // connect even when both sides start from behind NAT.
    { urls: "stun:stun.cloudflare.com:3478" },
  ];
  if (opts.turn) {
    iceServers.push({
      urls: opts.turn.urls,
      username: opts.turn.username,
      credential: opts.turn.credential,
    });
  }
  const pc = new RTCPeerConnection({ iceServers });

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
      // Wallet vanished — close the data channel so the host knows.
      // Fire the explicit teardown FIRST with a wallet-side reason
      // so the SDK maps it to `wallet_signed_out` (the dc close
      // alone would degrade to the generic `network_loss`).
      fireClose("wallet_signed_out");
      try { dc.close(); } catch { /* */ }
    }
  });

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
      try { dc.close(); } catch { /* */ }
      try { pc.close(); } catch { /* */ }
      opts.signaling.close();
    },
  };
}
