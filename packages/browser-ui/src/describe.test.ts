// node --test: what the sign-in card says a site will get, read from the
// code's own URL (describe.ts). Built the way the SDK builds the URL
// (packages/browser/src/index.ts, buildDeepLinkUrl).

import { test } from "node:test";
import assert from "node:assert/strict";
import { describeCode, describeShares, monogram } from "./describe.js";

const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");

function codeUrl(request: object, domain = "shop.example.com", t = "1762190000") {
  const params = new URLSearchParams({ s: "req_1", p: "pk", n: "n".repeat(43), d: domain, req: b64u(JSON.stringify(request)), t });
  return `https://app.prson.net/login/v1?${params.toString()}`;
}

test("reads the domain, the server timestamp and the request", () => {
  const d = describeCode(codeUrl({ domain: "shop.example.com", required: { predicates: ["age_gte_18"], requiredClaims: ["given_name", "family_name"] } }));
  assert.equal(d.domain, "shop.example.com");
  assert.equal(d.serverTs, 1762190000);
  assert.deepEqual(
    d.shares.map((s) => s.label),
    ["Verified human", "18 or older", "Your name", "A sign-in key just for this site"],
  );
  assert.equal(d.shares[1]?.detail, "Not your date of birth");
  assert.equal(d.anonymousAllowed, false);
});

test("level 0, unique human, organisations, one-time keys and anonymous sign-in", () => {
  assert.equal(describeShares({ required: { minVerificationLevel: 0 } })[0]?.label, "Your Prson identity");
  assert.equal(describeShares({ required: { minVerificationLevel: 4 } })[0]?.detail, "Passport or ID checked");
  const unique = describeShares({ required: { uniqueHumanId: true } });
  assert.equal(unique[0]?.label, "Verified unique person");
  assert.match(unique[0]?.detail ?? "", /not trackable across sites/);
  const org = describeShares({ required: { identityType: "organization" } });
  assert.equal(org[0]?.label, "An organisation identity");
  const oneTime = describeShares({ ephemeralIdentity: true });
  assert.equal(oneTime[oneTime.length - 1]?.label, "A one-time key");
  assert.equal(describeCode(codeUrl({ allowAnonymous: true })).anonymousAllowed, true);
});

test("predicates say yes-or-no facts, never the value; unknown names are humanised", () => {
  const s = describeShares({ required: { predicates: ["phone_verified", "age_lt_26", "resident_in_eu"], requiredClaims: ["favourite_colour"] } });
  assert.deepEqual(
    s.map((i) => [i.label, i.detail ?? ""]),
    [
      ["Verified human", ""],
      ["A verified phone number", "Not the number itself"],
      ["Under 26", "Not your date of birth"],
      ["Resident in eu", "Yes or no only"],
      ["Favourite colour", ""],
      ["A sign-in key just for this site", ""],
    ],
  );
});

test("a broken or foreign URL still describes something safe", () => {
  const d = describeCode("https://app.prson.net/login/v1?d=a.example&req=%%%");
  assert.equal(d.domain, "a.example");
  assert.equal(d.serverTs, null);
  assert.equal(d.shares[0]?.label, "Verified human");
  const old = describeCode("prson://login/v1?s=1&d=old.example.org&t=12");
  assert.equal(old.domain, "old.example.org");
  assert.equal(old.serverTs, 12);
});

test("the monogram is the registrable name's first letter", () => {
  assert.equal(monogram("shop.example.com"), "E");
  assert.equal(monogram("prson.net"), "P");
  assert.equal(monogram("localhost:8080"), "L");
  assert.equal(monogram(""), "?");
});
