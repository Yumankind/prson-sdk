# @prson/login-sdk

> The browser package. Drops into any website with one `<script>` tag
> (or `npm install @prson/login-sdk` for modular bundlers).
>
> See [`../../README.md`](../../README.md) for the whole-system
> overview, [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) for the
> wire format, [`../../SECURITY.md`](../../SECURITY.md) for the threat
> model.

## Install

Install from npm (below), or load the browser bundle from
`https://prson.net/vendor/prson-login/prson-login.js` (see *CDN* below).

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
  import { PrsonLogin } from "https://prson.net/vendor/prson-login/prson-login.js";
  // Optional: the styled QR card (registers itself; no exports needed).
  import "https://prson.net/vendor/prson-login/prson-login-ui.js";
</script>
```

The bundle is an unversioned ES module built from this repository's
`main`; pin your own copy if you need a fixed version.

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

  /** The person's Prson ID for your site: stable across sign-ins, different
   *  on every other site. Use it as the user id (it is `cnf.jwk.x`). */
  prsonId: string;

  /** Verified + decoded disclosed claims, ready to consume. */
  claims: Record<string, unknown>;

  /** Holder Ed25519 public JWK from cnf.jwk (the key behind `prsonId`). */
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

    // result.prsonId is the person's ID on your site (stable across
    // sessions, different on every other site). Forward the full
    // result.sdJwtVc to your backend and re-verify it there with
    // @prson/login-verifier, which gives you the same prsonId.
    await fetch("/api/login", {
      method: "POST",
      body: JSON.stringify({ presentation: result.sdJwtVc }),
    });

    // Show who is signed in, right away (the ID, or the account name
    // your backend maps it to). Whoever scans the code first signs in,
    // so the person at this screen must be able to see it's them.
    document.querySelector("#who").textContent = `Signed in as ${result.prsonId.slice(0, 8)}…`;

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
  import { PrsonLogin } from "https://prson.net/vendor/prson-login/prson-login.js";

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
- **Show who signed in.** A QR can be scanned by anyone who sees it
  (or relayed by a phishing page), and the first phone to claim it signs
  the browser in. Right after `signIn()` resolves — or from the
  `signed_in` event / `session.prsonId` — show the signed-in identity on
  the page (the Prson ID, or the account your backend maps it to), and
  let the person sign out if it isn't them. The page also shows
  "scanned" as soon as any phone claims the code.
- **Secrets stay on the page.** The live channel never carries password
  or one-time-code values (`type="password"`, or `autocomplete`
  `current-password` / `new-password` / `one-time-code`): `bindInput`
  answers `unsupported`, `bindForm` and `enableRemoteNavigation` skip
  those fields, and an `input` request never sends a password's current
  value.
- **Authenticated channel.** Every data-channel envelope must come from
  the wallet session key the signed presentation names (KB-JWT
  `prson_wsk`); anything else is dropped. With a Prson app too old to
  sign that key, sign-in still works but remote navigation, mouse and
  file input are off for the session (a console warning says so).
- **Relay-only WebRTC.** The browser waits for the relay's TURN servers
  (sent once a phone has claimed the code) and uses only relay
  candidates, so its IP addresses never reach the phone.
- **Renewals.** The SDK *receives* renewals but never *requests* them
  — the wallet is in charge. Your backend just needs to accept a new
  presentation on each `onRenewed`. Within a session a renewal must be
  newer (`iat`) than the last one accepted and is never accepted twice.
- **Session storage.** The SDK doesn't persist anything to
  localStorage / cookies by default. The host page decides how to
  encode the cnf.jwk identifier (server-side session cookie is the
  obvious default).

## Notifications (opt-in)

`signIn({ notifications: true })` makes the wallet offer an unticked "Let
{site} send you notifications" row. If the person ticks it,
`result.notifications.handle` is a handle for them at your domain (random per
site). Send it to your backend with the presentation and send from there with
`@prson/login-verifier`'s `sendNotification` (an API key with `notify:write`).
A 410 means they turned you off: forget the handle. Rules and limits:
`documentation/SITE_NOTIFICATIONS.md`.

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

  req.session.userId = result.prsonId; // stable per-site id
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
- **Implementation**: working. `src/index.ts` implements the API above:
  `PrsonLogin.signIn` and the live `PrsonLoginSession`, the request
  channel (`bindInput`, `bindForm`, `bindMouse`,
  `enableRemoteNavigation`), presentation and status-list checks,
  website notifications (`NOTIFY_HANDLE`, `notifyHandleFrom`) and
  verifications (`awaitVerification`). One exception:
  `PrsonLogin.restore()` always resolves `null`, because the SDK keeps
  no state across page loads (your server's session is the source of
  truth). Tests: `npm test`.
- **Distribution**: npm (`@prson/login-sdk`) and the browser bundle at
  `https://prson.net/vendor/prson-login/`. See
  [`../../CHANGELOG.md`](../../CHANGELOG.md).
