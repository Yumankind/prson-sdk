/**
 * Browser-side WebSocket client for the Cloudflare Worker signaling
 * Durable Object. The wallet talks to the same Worker; the DO fans
 * messages between us.
 *
 * Wire format mirrors the Worker's `SignalingMessage` discriminated
 * union (see cloudflare-workers/signaling-worker/src/index.ts). We don't import
 * those types directly because cross-package type sharing would
 * bloat the SDK; the two definitions are kept in sync by the spec.
 */

const WS_SUBPROTOCOL = "prson-login-v1";

export type SignalingMessage =
  | { msg: "offer"; sdp: string }
  | { msg: "answer"; sdp: string }
  | { msg: "candidate"; candidate: unknown }
  | { msg: "peer-ready" }
  | { msg: "peer-gone" }
  | { msg: "error"; reason: string };

/**
 * Relay → browser, once a wallet has claimed the code:
 * `{ "type": "ice", "iceServers": [...] }` — the TURN servers the
 * browser must use (relay-only, so its addresses never reach the
 * phone). Newer relays send no TURN at draft time; older ones put it
 * in the draft response instead and never send this.
 */
export type IceMessage = { type: "ice"; iceServers: RTCIceServer[] };

export interface SignalingConnection {
  /** Push a message to the other peer through the relay. */
  send(m: SignalingMessage): void;
  /** Subscribe to messages from the other peer. */
  onMessage(cb: (m: SignalingMessage) => void): void;
  /** Subscribe to terminal-close events from either side or the worker. */
  onClose(cb: (reason: string) => void): void;
  /**
   * Resolves with the relay's `ice` servers (the first `ice` message,
   * buffered if it arrived before this was called). Rejects if the
   * socket closes first.
   */
  awaitIce(): Promise<RTCIceServer[]>;
  /** Close the WS. Does not tear down the underlying RTCPeerConnection. */
  close(): void;
}

export async function connectSignaling(opts: {
  url: string;
  role: "browser";
  sigToken: string;
}): Promise<SignalingConnection> {
  const ws = new WebSocket(opts.url, [WS_SUBPROTOCOL, opts.sigToken]);
  const msgListeners: Array<(m: SignalingMessage) => void> = [];
  const closeListeners: Array<(reason: string) => void> = [];
  let ice: RTCIceServer[] | null = null;
  let closedReason: string | null = null;
  const iceWaiters: Array<{ resolve: (s: RTCIceServer[]) => void; reject: (e: Error) => void }> = [];

  await new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("error", onErrorBefore);
      resolve();
    };
    const onErrorBefore = () => {
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("error", onErrorBefore);
      reject(new Error("signaling: WS upgrade failed (auth?)"));
    };
    ws.addEventListener("open", onOpen);
    ws.addEventListener("error", onErrorBefore);
  });

  ws.addEventListener("message", (evt) => {
    let parsed: SignalingMessage | IceMessage;
    try {
      parsed = JSON.parse(String(evt.data)) as SignalingMessage | IceMessage;
    } catch {
      return; // bad frame from the Worker; ignore
    }
    if (parsed && (parsed as IceMessage).type === "ice") {
      // Only the first one counts: the peer connection is built from it.
      const servers = (parsed as IceMessage).iceServers;
      if (ice || !Array.isArray(servers)) return;
      ice = servers.filter((x) => x && (typeof x.urls === "string" || Array.isArray(x.urls)));
      for (const w of iceWaiters.splice(0)) w.resolve(ice);
      return;
    }
    if (!parsed || typeof (parsed as SignalingMessage).msg !== "string") return;
    for (const cb of msgListeners) cb(parsed as SignalingMessage);
  });

  ws.addEventListener("close", (evt) => {
    const reason = evt.reason || `code-${evt.code}`;
    closedReason = reason;
    for (const w of iceWaiters.splice(0)) w.reject(new Error(`signaling: closed before the code was claimed (${reason})`));
    for (const cb of closeListeners) cb(reason);
  });

  return {
    send(m: SignalingMessage) {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify(m));
    },
    onMessage(cb) {
      msgListeners.push(cb);
    },
    onClose(cb) {
      closeListeners.push(cb);
    },
    awaitIce() {
      if (ice) return Promise.resolve(ice);
      if (closedReason !== null) {
        return Promise.reject(new Error(`signaling: closed before the code was claimed (${closedReason})`));
      }
      return new Promise((resolve, reject) => iceWaiters.push({ resolve, reject }));
    },
    close() {
      try { ws.close(1000, "client_close"); } catch { /* */ }
    },
  };
}
