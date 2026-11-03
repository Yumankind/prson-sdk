import { test } from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { canonicalJson, verdictDisclosureDigest, verifyVerdict, type VerdictDisclosure } from "../src/verdict.ts";

// The vector the API (test/verdictDisclosures.test.ts), the website and the
// app check too: salts are bytes 0x00..0x0f, 0x10..0x1f and 0x20..0x2f.
const VECTOR: Array<[VerdictDisclosure, string]> = [
  [["AAECAwQFBgcICQoLDA0ODw", "fact", "age_over_18", true], "dYw5AWHK9Xj_Msr1Mt4pV9C2ghDHYkXOyKgcAVYkWwU"],
  [["EBESExQVFhcYGRobHB0eHw", "property", "given_names", "José Ána"], "SIvUI9RLlvDQPAqh8ghQPapm-RHrad9DsxhlM4BNqQg"],
  [["ICEiIyQlJicoKSorLC0uLw", "document_field", "date_of_birth", "1990-01-31"], "8La0qijG2h9X7k0v-mVzgoTrepe-ahNC5JSTaXSkBS4"],
];
const disclosures = VECTOR.map(([d]) => d);

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey;

function sign(envelope: unknown): string {
  const s = createSign("RSA-SHA256");
  s.update(canonicalJson(envelope), "utf8");
  return s.sign(privateKey).toString("base64");
}

const envelopeV2 = {
  scope: "prson-truth-verdict/2",
  proofId: "proof-1",
  type: "property",
  captureHash: "ab".repeat(32),
  artefactHashes: null,
  challengeId: "ch-1",
  slotId: "slot-1",
  signerIdentityId: "resp_123",
  level: "strong",
  verifiedAt: "2026-11-03T10:00:00.000Z",
  disclosures: VECTOR.map(([[, kind, id], digest]) => ({ kind, id, digest })),
};

test("digests match the shared vector", () => {
  for (const [d, digest] of VECTOR) assert.equal(verdictDisclosureDigest(d), digest);
});

test("a signed v2 envelope verifies every disclosure", () => {
  const r = verifyVerdict(envelopeV2, sign(envelopeV2), disclosures, { publicKey: pem });
  assert.equal(r.ok, true);
  assert.equal(r.signatureValid, true);
  assert.equal(r.version, 2);
  assert.deepEqual(r.disclosures.map((d) => d.verified), [true, true, true]);
  assert.equal(r.disclosures[1]!.value, "José Ána");
});

test("a keyring is tried with the pinned kid first, JWK keys work", () => {
  const jwk = publicKey.export({ format: "jwk" });
  const r = verifyVerdict(envelopeV2, sign(envelopeV2), disclosures, {
    kid: "k2",
    keys: [{ kid: "k1", publicKey: other }, { kid: "k2", publicKey: jwk }],
  });
  assert.equal(r.ok, true);
});

test("a tampered value fails, the others still verify", () => {
  const tampered = disclosures.map((d) => [...d] as VerdictDisclosure);
  tampered[1]![3] = "Joana";
  const r = verifyVerdict(envelopeV2, sign(envelopeV2), tampered, { publicKey: pem });
  assert.equal(r.ok, false);
  assert.equal(r.signatureValid, true);
  assert.equal(r.reason, "disclosure-not-verified");
  assert.deepEqual(r.disclosures.map((d) => [d.verified, d.reason]), [[true, undefined], [false, "digest-mismatch"], [true, undefined]]);
});

test("a wrong kind, id or salt is not verified", () => {
  const [fact] = disclosures;
  const cases: VerdictDisclosure[] = [
    [fact![0], "property", "age_over_18", true],
    [fact![0], "fact", "age_over_21", true],
    ["AAECAwQFBgcICQoLDA0ODx", "fact", "age_over_18", true],
    [fact![0], "fact", "age_over_18", false],
  ];
  for (const d of cases) {
    const r = verifyVerdict(envelopeV2, sign(envelopeV2), [d], { publicKey: pem });
    assert.equal(r.ok, false, JSON.stringify(d));
    assert.equal(r.disclosures[0]!.verified, false);
  }
  const malformed = verifyVerdict(envelopeV2, sign(envelopeV2), [["salt", "fact"]], { publicKey: pem });
  assert.equal(malformed.disclosures[0]!.reason, "malformed");
});

test("a changed envelope, a bad signature or the wrong key fails", () => {
  const sig = sign(envelopeV2);
  const changed = { ...envelopeV2, level: "weak" };
  for (const r of [
    verifyVerdict(changed, sig, disclosures, { publicKey: pem }),
    verifyVerdict(envelopeV2, Buffer.from("nope").toString("base64"), disclosures, { publicKey: pem }),
    verifyVerdict(envelopeV2, sig, disclosures, { publicKey: other }),
  ]) {
    assert.equal(r.ok, false);
    assert.equal(r.signatureValid, false);
    assert.equal(r.reason, "signature-invalid");
    assert.ok(r.disclosures.every((d) => !d.verified && d.reason === "signature-invalid"));
  }
  assert.equal(verifyVerdict(envelopeV2, sig, disclosures, {}).reason, "no-key");
});

test("a v1 envelope's signature checks but covers no values", () => {
  const { disclosures: _d, ...rest } = envelopeV2;
  const v1 = { ...rest, scope: "prson-truth-verdict/1" };
  const sig = sign(v1);
  const bare = verifyVerdict(v1, sig, [], { publicKey: pem });
  assert.equal(bare.ok, true);
  assert.equal(bare.version, 1);
  const r = verifyVerdict(v1, sig, disclosures, { publicKey: pem });
  assert.equal(r.ok, false);
  assert.equal(r.signatureValid, true);
  assert.ok(r.disclosures.every((d) => !d.verified && d.reason === "not-covered"));
  assert.equal(verifyVerdict({ ...v1, scope: "other/1" }, sig, [], { publicKey: pem }).reason, "unsupported-scope");
});
