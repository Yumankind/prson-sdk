#!/usr/bin/env node
// CLI counterpart to server.js — same verifier, no HTTP. Pipe a
// presentation in (or pass --presentation) and the script prints the
// verified claims OR a typed failure code. Useful for ad-hoc
// inspection during development:
//
//   echo '<the SD-JWT-VC string>' | \
//     node verify-cli.js \
//       --audience https://localhost:5500 \
//       --nonce <the matching nonce>
//
// Exit code is 0 on `ok: true` and 1 on `ok: false`, so the script
// composes with `jq` / shell pipelines.

import { verifyPresentation } from "@prson/login-verifier";
import { readFileSync } from "node:fs";

function args(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--") && argv[i + 1]) {
      out[a.slice(2)] = argv[++i];
    }
  }
  return out;
}

const opts = args(process.argv);
const presentation =
  opts.presentation ??
  (opts.file ? readFileSync(opts.file, "utf8").trim() : null) ??
  readFileSync(0, "utf8").trim();
if (!presentation) {
  console.error("usage: verify-cli.js --audience <url> --nonce <b64u> [--presentation <str>|--file <path>|<stdin>]");
  process.exit(2);
}
if (!opts.audience || !opts.nonce) {
  console.error("--audience and --nonce are required");
  process.exit(2);
}

const result = await verifyPresentation(presentation, {
  expectedAudience: opts.audience,
  expectedNonce: opts.nonce,
});

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
