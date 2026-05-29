// Express verifier — one route, no database, pure-function.
//
// POST /verify { presentation, audience, nonce } → 200 with verified
// claims or 400 with a typed failure reason. The whole point is to
// show how a backend integrator wires `verifyPresentation` from
// `@prson/login-verifier` against a sign-in attempt.
//
// In a real deployment you'd:
//   1. Mint + store `nonce` at /session/draft time keyed by `reqId`.
//   2. Receive the presentation from the browser via your sign-in
//      callback (or via a /session/finalize route the SDK doesn't
//      directly provide — host-side wiring).
//   3. Verify it here with the SAME nonce + your origin as audience.
//   4. On success, mint a server-side session cookie anchored to
//      `cnf.jwk.x` so a stolen cookie can't be replayed against a
//      different identity.

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

app.post("/verify", async (req, res) => {
  const { presentation, audience, nonce } = req.body ?? {};
  if (
    typeof presentation !== "string" ||
    typeof audience !== "string" ||
    typeof nonce !== "string"
  ) {
    res
      .status(400)
      .json({ ok: false, reason: "malformed", detail: "presentation/audience/nonce all required" });
    return;
  }

  const result = await verifyPresentation(presentation, {
    expectedAudience: audience,
    expectedNonce: nonce,
    // Defaults to the production notary's JWKS + the two real-credential
    // VCTs. Pass `acceptedVcts` here too if you opted into
    // `allowAnonymous: true` on the browser SDK and want the verifier
    // to accept the self-signed anonymous form.
  });

  if (!result.ok) {
    res.status(400).json({
      ok: false,
      reason: result.reason,
      detail: result.detail ?? null,
    });
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
  const result =
    typeof fragment === "string"
      ? await verifyFragmentCredential(fragment)
      : await verifySignedFragment(fragment);
  if (!result.ok) {
    res.status(400).json({ ok: false, reason: result.reason, detail: result.detail ?? null });
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
    description: result.description,
    kid: result.kid,
  });
});

const PORT = Number(process.env.PORT ?? 8080);
app.listen(PORT, () => {
  console.log(`Express verifier listening on http://localhost:${PORT}`);
  console.log(`POST /verify          { presentation, audience, nonce }`);
  console.log(`POST /verify-fragment { fragment }   // object or compact JWT string`);
});
