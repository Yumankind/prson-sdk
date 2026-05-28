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

- One **Durable Object** instance per `reqId` (created on the first
  `POST /session/draft`, lifted from DRAFT → ACTIVE on `/session/claim`).
- Two **role tokens** accepted at WS upgrade, both **HMAC-signed by
  the Worker itself** — no Firebase ID-token verification, no
  externally-resolved JWKS on the hot path:
  - `browser` → `draftToken` from `POST /session/draft` (60 s TTL).
  - `wallet`  → `walletSessionToken` from `POST /session/claim` (15 min TTL).
- The DO **fans out** signaling messages between the two peers, caches
  the offer + answer + ICE candidates so a late-joining peer gets the
  state replayed.
- **15-min hard TTL** via DO alarms — auto-destroys whether the peers
  have finished or not. A DRAFT that's never claimed self-destructs
  after 60 s.

## Deploy

```bash
cd login-sdk/infra/signaling-worker
npm install
wrangler kv namespace create prson-login-rate-limit  # paste id into wrangler.toml
wrangler secret put SIG_TOKEN_HMAC_SECRET   # HMAC secret for draftToken + walletSessionToken
wrangler secret put CF_TURN_KEY_ID          # Cloudflare TURN key id
wrangler secret put CF_TURN_API_TOKEN       # Cloudflare TURN API token
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

- [x] HMAC token verification with timing-safe comparison, role-tagged
      (`draftToken` for browser, `walletSessionToken` for wallet).
- [x] Wallet's Ed25519 claim signature verified on
      `"prson-login-claim/v1\n<reqId>\n<walletPkX>\n<ts>\n<domain>"` —
      version prefix protects against cross-protocol replay.
- [x] `/session/claim` echoes the stored draft's `domain` back, and
      rejects with `401 domain-mismatch` if the wallet signed for a
      different domain than the browser drafted.
- [x] Cloudflare TURN credentials minted **only** inside `handleClaim`
      — never on `/session/draft` (verifiable by audit of the
      `mintCloudflareTurnCreds` call sites).
- [x] One peer per role: a second wallet/browser connection replaces
      the first (4002 close code).
- [x] 15-min DO alarm — no way to keep a session open indefinitely.
      DRAFT alarm at 60 s catches abandoned drafts before they cost
      anything beyond a few KB of DO state.
- [x] Per-IP draft rate limit (KV-backed, default 30/IP/min) prevents
      anonymous draft-spam.
- [x] All control message types validated before forwarding.

## Phase status

✅ Scaffold + handshake + DO state + role gating + alarm.
☐ Production deploy + DNS routing.
☐ Integration test against the browser SDK + mobile wallet.
☐ Per-IP rate limit on WS upgrades (today relies on Cloudflare's
   built-in DDoS, which is fine but explicit limits are kinder).
