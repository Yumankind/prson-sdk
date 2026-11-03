# @prson/login-sdk

> The browser package. Drops into any website with one `<script>` tag
> (or `npm install @prson/login-sdk` for modular bundlers).
>
> See [`../../README.md`](../../README.md) for the whole-system
> overview, [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) for the
> wire format, [`../../SECURITY.md`](../../SECURITY.md) for the threat
> model.

## Install

### Bundled

```bash
npm install @prson/login-sdk
```

```ts
import { PrsonLogin } from "@prson/login-sdk";
```

### CDN (no build step)

```html
<script type="module">
  import { PrsonLogin } from "https://cdn.prson.net/login-sdk/0.x/index.js";
</script>
```

## The full API surface, in one block

```ts
type SignInOptions = {
  /** Bound into the KB-JWT `aud`. The SDK reads `window.location.origin`
   *  if you omit it; pass it explicitly only if your origin chain is
   *  unusual (iframe, custom protocol). */
  domain?: string;

  /** What you require from the holder. The SDK presents this to the
   *  user in the wallet's login drawer — the user can refuse. */
  required?: {
    /** 1..6. Default: no minimum. Use 5 to force NFC-backed VC. */
    minVerificationLevel?: 1 | 2 | 3 | 4 | 5 | 6;

    /** Standard SD-JWT-VC claim names (e.g. "given_name", "birthdate").
     *  Omit to ask for `verified_human` only. */
    requiredClaims?: string[];

    /** Predicate ids from the Prson fragment catalog (e.g. "age_gte_18",
     *  "issuing_country_in_eu"). Signed on-demand at presentation. */
    predicates?: string[];

    /** Default: "personal". */
    identityType?: "personal" | "organization";
  };

  /** If `true`, the SDK ALSO accepts a self-signed **anonymous-wallet**
   *  credential — no verified-human claim, no document fields, just a
   *  proof the user controls a Prson wallet on this domain. The
   *  wallet's drawer surfaces a "Sign in anonymously" option to the
   *  user. `result.claims.anonymous === true` indicates this branch
   *  fired. Default false. */
  allowAnonymous?: boolean;

  /** App-to-app return leg (same-device native flows): an https URL on
   *  YOUR login domain — typically your Universal Link / Android App
   *  Link — that the wallet opens after delivering the credential, so
   *  the OS bounces the user back into your native app. https-only,
   *  host must equal the login domain exactly (enforced here AND in
   *  the wallet). See SIGN-IN-WITH-PRSON-IDENTITY.md §App-to-app. */
  returnUrl?: string;

  /** 1..15. Default 10. The credential's `exp` is clamped to this. */
  ttlMinutes?: number;

  /** UI placement options. */
  ui?: {
    /** DOM selector or HTMLElement to mount the QR + status into. */
    mountQrInto?: string | HTMLElement;

    /** Theme. Default: matches `prefers-color-scheme`. */
    theme?: "light" | "dark" | "auto";
  };

  /** Pre-render the QR but DON'T resolve until you call `.proceed()`.
   *  Useful when the QR is shown well before the user is ready to
   *  scan and you want to control the moment the signaling WS opens. */
  defer?: boolean;
};

type SignInResult = {
  /** Compact SD-JWT-VC presentation (issuer JWS + disclosures + KB-JWT). */
  sdJwtVc: string;

  /** Verified + decoded disclosed claims, ready to consume. */
  claims: Record<string, unknown>;

  /** Holder Ed25519 public JWK from cnf.jwk — your stable per-user id. */
  cnf: { jwk: { kty: "OKP"; crv: "Ed25519"; x: string } };

  /** Credential metadata. */
  credential: {
    vct: string;     // VCT URI
    iss: string;     // "did:web:app.prson.net"
    kid: string;     // notary key thumbprint
    expiresAt: number;
  };

  /** Live handle for the renewal cycle. */
  session: PrsonLoginSession;
};

class PrsonLoginSession {
  readonly expiresAt: number;  // ms epoch of credential.exp

  /** Subscribe to wallet-pushed renewals. Each renewal is already
   *  fully verified by the SDK (same checks as the initial sign-in). */
  onRenewed(cb: (fresh: SignInResult) => void): void;

  /** Fires when the session ends for any reason. */
  onExpiry(cb: (reason: ExpiryReason) => void): void;

  /** Voluntary local close; tells the wallet the user signed out. */
  close(): void;
}

type ExpiryReason =
  | "ttl_reached"          // No renewal arrived; the credential lapsed.
  | "wallet_signed_out"    // Wallet pushed a `revoke` message.
  | "user_revoked"         // Host page called session.close().
  | "network_loss"         // WebRTC data channel dropped > 60s.
  | "credential_revoked";  // Future: notary status-list flagged this VC.

class PrsonLogin {
  static signIn(opts: SignInOptions): Promise<SignInResult>;

  /** Re-attach to a session from a previously-stored handle (e.g. the
   *  user reloads the page; the SDK can rebind via cnf.jwk). */
  static restore(opts: {
    cnfJwk: SignInResult["cnf"]["jwk"];
    onExpiry?: (reason: ExpiryReason) => void;
  }): Promise<PrsonLoginSession | null>;
}
```

## 30-second integration

```html
<button id="prson-login-btn">Sign in with Prson</button>
<div id="prson-login-qr"></div>

<script type="module">
  import { PrsonLogin } from "@prson/login-sdk";

  document.querySelector("#prson-login-btn").addEventListener("click", async () => {
    const result = await PrsonLogin.signIn({
      required: {
        minVerificationLevel: 5,
        predicates: ["age_gte_18"],
      },
      ttlMinutes: 10,
      ui: { mountQrInto: "#prson-login-qr" },
    });

    // Treat result.cnf.jwk as the user identifier (it's stable across
    // sessions on this site). Drop it into your session cookie or
    // forward the full result.sdJwtVc to your backend and re-verify
    // there using @prson/login-verifier.
    await fetch("/api/login", {
      method: "POST",
      body: JSON.stringify({ presentation: result.sdJwtVc }),
    });

    result.session.onRenewed(fresh => {
      // Push the fresh credential to your backend on each renewal so
      // server-side TTL tracks the wallet's view of the world.
      fetch("/api/login/renew", { method: "POST", body: JSON.stringify({ presentation: fresh.sdJwtVc }) });
    });

    result.session.onExpiry(reason => {
      console.log("Signed out:", reason);
      location.href = "/";
    });
  });
</script>
```

## Plain-HTML, no-bundler, no-npm

```html
<script type="module">
  import { PrsonLogin } from "https://cdn.prson.net/login-sdk/0.x/index.js";

  const r = await PrsonLogin.signIn({
    required: { minVerificationLevel: 5 },
    ui: { mountQrInto: "#prson-login-qr" },
  });
  document.querySelector("#hello").textContent = `Hi ${r.claims.given_name ?? "human"}`;
</script>
```

## Behaviour notes

- **Same-device detection.** If the SDK detects a touch device + the
  Prson app is installed (universal-link probe), the QR is replaced
  by a "Sign in with Prson" button. The user taps it, the wallet
  opens, the rest is identical.
- **Native apps (app-to-app).** Open your login page in a Custom Tab /
  `SFSafariViewController` and set `returnUrl` to your Universal Link /
  App Link — the wallet bounces the user back into your app after the
  credential lands. Always use your WEB domain as the audience (never
  the package name): same pairwise user id as your website, and the OS
  app-link verification proves the app↔domain binding. Full pattern:
  `SIGN-IN-WITH-PRSON-IDENTITY.md` §App-to-app.
- **QR refresh.** Every QR encodes a one-shot `reqId` bound to a
  Cloudflare-Worker draft that's good for **60 seconds** to be
  claimed by a wallet. If the user idles past the draft expiry, the
  SDK calls `POST /session/draft` again and re-renders the QR.
- **Renewals.** The SDK *receives* renewals but never *requests* them
  — the wallet is in charge. Your backend just needs to accept a new
  presentation on each `onRenewed`.
- **Session storage.** The SDK doesn't persist anything to
  localStorage / cookies by default. The host page decides how to
  encode the cnf.jwk identifier (server-side session cookie is the
  obvious default).

## Backend verification

Use [`@prson/login-verifier`](../verifier-node/) — drop-in for
Node.js. The full verifier in 20 lines:

```ts
import { verifyPresentation } from "@prson/login-verifier";

app.post("/api/login", async (req, res) => {
  const { presentation } = req.body;
  const result = await verifyPresentation(presentation, {
    expectedAudience: `https://${req.hostname}`,
    expectedNonce: req.session.prsonNonce,  // you stored this when you served the page
  });
  if (!result.ok) return res.status(401).send(result.reason);

  const subject = result.cnf.jwk.x; // 32-byte base64url Ed25519 pk — stable user id
  req.session.userId = subject;
  res.json({ claims: result.claims });
});
```

## Verifications: "sign this PDF", "prove you're 18"

Sign-in hands you a credential in the browser. A **verification** is an
organisation's request made by your server with your API key
(`POST https://api.prson.net/v1/verifications`): a fact, a verified
document, a selfie, or a signature on a PDF with the person's
government-verified name (upload the PDF with
`POST /v1/verifications/documents`, then a `document_signature`
requirement). `awaitVerification` shows its `share_url` (a QR code on a
computer, an "Open in Prson" button on a phone) and waits until your
server says it's answered. The API key stays on your server.

```ts
import { awaitVerification, VerificationClosedError } from "@prson/login-sdk";

// Your server created the verification and returns its id and share_url.
const { id, share_url } = await (await fetch("/api/contract/sign", { method: "POST" })).json();
try {
  await awaitVerification({
    shareUrl: share_url,
    title: "Sign the rental agreement",
    // Your server calls GET /v1/verifications/{id} (or remembers the verification.* webhooks).
    checkStatus: async (signal) => (await (await fetch(`/api/verifications/${id}`, { signal })).json()).status,
  });
  // fulfilled: your server downloads the signed PDF from the response's signature.download_path.
} catch (e) {
  if (e instanceof VerificationClosedError) console.log(`The request was ${e.status}`);
}
```

The signed PDF is the uploaded file plus a PAdES signature (B-T, with a
timestamp) by a certificate naming the person as their chip-read
identity document does, under the Prson Root CA. It is an **advanced**
electronic signature under eIDAS, not a qualified one. The response
carries both SHA-256 hashes (as uploaded, as signed) in Prson's signed
verdict, and the signed file's first bytes are exactly your upload.

## Build status

- **Spec**: stable (this folder).
- **Implementation**: stub only — `src/index.ts` exports the type
  surface above but throws on call. Phase 2 of the rollout fills it
  in. See [`../../README.md` § build order](../../README.md).
