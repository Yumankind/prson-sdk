// Express verifier — the backend half of "Sign in with Prson".
//
//   POST /nonce   → { nonce }   a one-time value for the next sign-in
//   POST /verify  { presentation, nonce } → verified claims, or a typed failure
//   POST /verify-fragment { fragment }   → one verified fact
//
// The browser asks /nonce first and passes it to `PrsonLogin.signIn({ nonce })`.
// /verify accepts each nonce once, within 5 minutes, and checks the
// presentation against THIS server's own origin (never one the browser sends),
// so a captured presentation can't be replayed here or minted for another site.
// On success, start your session anchored to `cnf.jwk.x`.
//
// Configure your site's host with PRSON_HOST (default localhost:5173).

import { randomBytes } from "node:crypto";
import express from "express";
import {
  verifyPresentation,
  verifySignedFragment,
  verifyFragmentCredential,
} from "@prson/login-verifier";

const app = express();
app.use(express.json({ limit: "32kb" }));

// Permissive CORS for the demo — the plain-html example serves on a
// different localhost port, so the browser blocks POST without it. In
// production you'd lock this down to your actual host origin instead
// of `*`.
app.use((req, res, next) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

// Your site's host. The SDK binds every sign-in to `https://<host>`; facts to the host alone.
const HOST = (process.env.PRSON_HOST ?? "localhost:5173").toLowerCase();
const AUDIENCE = `https://${HOST}`;
const FRAGMENT_AUDIENCE = HOST;

// One-time nonces. A real deployment keeps these in its session store or database.
const NONCE_TTL_MS = 5 * 60_000;
const nonces = new Map();

app.post("/nonce", (_req, res) => {
  const now = Date.now();
  for (const [n, exp] of nonces) if (exp <= now) nonces.delete(n);
  const nonce = randomBytes(32).toString("base64url");
  nonces.set(nonce, now + NONCE_TTL_MS);
  res.json({ nonce });
});

/** True once for a nonce this server issued and that hasn't expired. */
function takeNonce(nonce) {
  const exp = nonces.get(nonce);
  nonces.delete(nonce);
  return exp !== undefined && exp > Date.now();
}

app.post("/verify", async (req, res) => {
  const { presentation, nonce } = req.body ?? {};
  if (typeof presentation !== "string" || typeof nonce !== "string") {
    res.status(400).json({ ok: false, reason: "malformed", detail: "presentation and nonce are required" });
    return;
  }
  if (!takeNonce(nonce)) {
    res.status(400).json({ ok: false, reason: "nonce_unknown_or_used" });
    return;
  }

  const result = await verifyPresentation(presentation, {
    expectedAudience: AUDIENCE,
    expectedNonce: nonce,
    // Defaults to the production notary's JWKS + the two real-credential
    // VCTs. Pass `acceptedVcts` here too if you opted into
    // `allowAnonymous: true` on the browser SDK and want the verifier
    // to accept the self-signed anonymous form.
  });

  if (!result.ok) {
    // The reason only; `detail` stays in your logs.
    console.warn("verify failed", result.reason, result.detail);
    res.status(400).json({ ok: false, reason: result.reason });
    return;
  }

  // SUCCESS. `cnf.jwk.x` is your stable per-user identifier on this
  // origin — the verifier domain. Two sign-ins for the same human
  // produce the same `x` here.
  res.status(200).json({
    ok: true,
    subject: result.cnf.jwk.x,
    claims: result.claims,
    credential: result.credential,
    disclosedClaimNames: result.disclosedClaimNames,
  });
});

// POST /verify-fragment { fragment } — verifies a single Prson predicate
// (signed property fragment). Accepts both the legacy native shape AND
// the JWT-based formats (vc+jwt / vc+sd-jwt) — the body's wire form
// tells us which verifier to call. Returns the verified predicate, or
// a typed failure reason.
//
// Sample bodies:
//
//   Native (object):
//     { "fragment": { "fragmentId": "age_gte_18", "value": true,
//                     "propertyHash": "...", "identityId": "...",
//                     "signedAt": "...", "expiresAt": "...",
//                     "signature": "<base64>", "kid": "2026-05" } }
//
//   JWT-based (compact string):
//     { "fragment": "eyJ0eXAiOiJ2Yytqd3QiLCJhbGc..." }
//     { "fragment": "eyJ0eXAiOiJzZC1qd3QiLCJhbGc...~<disclosure>~" }
//
// In a real deployment you'd also bind the fragment to the request
// being made (e.g. confirm propertyHash matches the user-on-record, log
// the predicate decision for audit, enforce per-fragment business
// rules). This route is the verification primitive only.
app.post("/verify-fragment", async (req, res) => {
  const { fragment } = req.body ?? {};
  if (fragment == null) {
    res.status(400).json({ ok: false, reason: "malformed", detail: "fragment required" });
    return;
  }
  // Facts bound to another site never verify here.
  const result =
    typeof fragment === "string"
      ? await verifyFragmentCredential(fragment, { expectedAudience: FRAGMENT_AUDIENCE })
      : await verifySignedFragment(fragment, { expectedAudience: FRAGMENT_AUDIENCE });
  if (!result.ok) {
    console.warn("verify-fragment failed", result.reason, result.detail);
    res.status(400).json({ ok: false, reason: result.reason });
    return;
  }
  res.status(200).json({
    ok: true,
    format: result.format,
    fragmentId: result.fragmentId,
    value: result.value,
    propertyHash: result.propertyHash,
    propertyType: result.propertyType,
    identityId: result.identityId,
    signedAt: result.signedAt,
    expiresAt: result.expiresAt,
    kid: result.kid,
  });
});

const PORT = Number(process.env.PORT ?? 8080);
app.listen(PORT, () => {
  console.log(`Express verifier listening on http://localhost:${PORT}`);
  console.log(`Audience: ${AUDIENCE}`);
  console.log(`POST /nonce           → { nonce }`);
  console.log(`POST /verify          { presentation, nonce }`);
  console.log(`POST /verify-fragment { fragment }   // object or compact JWT string`);
});
