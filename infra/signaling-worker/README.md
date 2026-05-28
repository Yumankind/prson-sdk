# prson-login-signaling — Cloudflare Worker

> The realtime signaling layer for `@prson/login-sdk`. Hosts a Durable
> Object per login session that relays WebRTC SDP + ICE between the
> browser SDK and the mobile wallet. Sees only handshake metadata; the
> credential payload is end-to-end-encrypted at the application layer.
>
> See [`../../ARCHITECTURE.md` §5.2](../../ARCHITECTURE.md) for the wire
> spec and [`../../SECURITY.md` §4.2](../../SECURITY.md) for the threat
> model.

## What it does

```
wss://signaling.prson.net/login/v1/<reqId>
  Sec-WebSocket-Protocol: prson-login-v1, <token>
```

- One **Durable Object** instance per `reqId` (created lazily on first
  WS upgrade).
- Two **roles** accepted at upgrade: `browser` (sigToken HMAC) or
  `wallet` (Firebase ID token).
- The DO **fans out** signaling messages between the two peers, caches
  the offer + answer + ICE candidates so a late-joining peer gets the
  state replayed.
- **15-min hard TTL** via DO alarms — auto-destroys whether the peers
  have finished or not.

## Deploy

```bash
cd login-sdk/infra/signaling-worker
npm install
wrangler secret put SIG_TOKEN_HMAC_SECRET   # paste the secret shared with createLoginSession
wrangler deploy
```

Bind the resulting Worker to your zone at `signaling.prson.net` in the
Cloudflare dashboard, or update `wrangler.toml` with a `routes` block.

## Wire format

Both peers send JSON-encoded messages of the form:

```ts
type SignalingMessage =
  | { msg: "offer"; sdp: string }           // browser-only
  | { msg: "answer"; sdp: string }          // wallet-only
  | { msg: "candidate"; candidate: unknown } // either
  | { msg: "peer-ready" }                   // wallet-only — "I've scanned"
  | { msg: "peer-gone" }                    // server-generated on socket close
  | { msg: "error"; reason: string };       // server-generated on auth / msg errors
```

Role-message gating is enforced server-side:
- Only `browser` can send `offer`.
- Only `wallet` can send `answer` / `peer-ready`.
- Both can send `candidate`.

## Security checklist (subset of `../../SECURITY.md` §10)

- [x] HMAC sigToken verification with timing-safe comparison.
- [x] Firebase ID-token verification via JWK endpoint (no X.509 parsing
      in Workers).
- [x] One peer per role: a second wallet/browser connection replaces
      the first (4002 close code).
- [x] 15-min DO alarm — no way to keep a session open indefinitely.
- [x] All control message types validated before forwarding.

## Phase status

✅ Scaffold + handshake + DO state + role gating + alarm.
☐ Production deploy + DNS routing.
☐ Integration test against the browser SDK + mobile wallet.
☐ Per-IP rate limit on WS upgrades (today relies on Cloudflare's
   built-in DDoS, which is fine but explicit limits are kinder).
