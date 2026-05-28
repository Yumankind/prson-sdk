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

export interface SignalingConnection {
  /** Push a message to the other peer through the relay. */
  send(m: SignalingMessage): void;
  /** Subscribe to messages from the other peer. */
  onMessage(cb: (m: SignalingMessage) => void): void;
  /** Subscribe to terminal-close events from either side or the worker. */
  onClose(cb: (reason: string) => void): void;
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
    let parsed: SignalingMessage;
    try {
      parsed = JSON.parse(String(evt.data)) as SignalingMessage;
    } catch {
      return; // bad frame from the Worker; ignore
    }
    for (const cb of msgListeners) cb(parsed);
  });

  ws.addEventListener("close", (evt) => {
    const reason = evt.reason || `code-${evt.code}`;
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
    close() {
      try { ws.close(1000, "client_close"); } catch { /* */ }
    },
  };
}
