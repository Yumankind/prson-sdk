#!/usr/bin/env node
// Builds the committed browser bundles of the login SDK from source:
//
//   prson-website/public/vendor/prson-login/prson-login.js     (minified; served at
//   prson-website/public/vendor/prson-login/prson-login-ui.js   https://prson.net/vendor/prson-login/)
//   login-sdk/examples/plain-html/prson-login.js(.map)         (readable, with source maps;
//   login-sdk/examples/plain-html/prson-login-ui.js(.map)       the plain-HTML demo)
//
//   node scripts/vendor-bundles.mjs           rebuild and write them
//   node scripts/vendor-bundles.mjs --check   rebuild in memory; exit 1 if any committed file differs
//
// The flags match the packages' `build:example` scripts and the command noted in
// prson-website/app/composables/useDevSession.ts. esbuild output carries no
// timestamps or absolute paths (source-map paths are relative to the outfile),
// so with the locked esbuild version and dependencies the output is byte-stable.

import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sdk = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(sdk, "..");
const vendor = join(repo, "prson-website/public/vendor/prson-login");
const example = join(sdk, "examples/plain-html");

const common = { bundle: true, format: "esm", target: "es2020", platform: "browser", logLevel: "silent" };
const minified = { minify: true, legalComments: "none" };
const readable = { sourcemap: true };

const targets = [
  { pkg: "packages/browser", outfile: join(vendor, "prson-login.js"), opts: minified },
  { pkg: "packages/browser-ui", outfile: join(vendor, "prson-login-ui.js"), opts: minified },
  { pkg: "packages/browser", outfile: join(example, "prson-login.js"), opts: readable },
  { pkg: "packages/browser-ui", outfile: join(example, "prson-login-ui.js"), opts: readable },
];

const check = process.argv.includes("--check");
const stale = [];

for (const t of targets) {
  const cwd = join(sdk, t.pkg);
  const result = await build({
    ...common,
    ...t.opts,
    absWorkingDir: cwd,
    entryPoints: ["src/index.ts"],
    outfile: t.outfile,
    write: false,
  });
  for (const file of result.outputFiles) {
    const rel = relative(repo, file.path);
    if (check) {
      let current = null;
      try {
        current = await readFile(file.path);
      } catch {}
      if (!current || !Buffer.from(file.contents).equals(current)) stale.push(rel);
    } else {
      await mkdir(dirname(file.path), { recursive: true });
      await writeFile(file.path, file.contents);
      console.log(`wrote ${rel} (${file.contents.length} bytes)`);
    }
  }
}

if (check) {
  if (stale.length) {
    console.error("These committed login SDK bundles don't match the source:");
    for (const f of stale) console.error(`  ${f}`);
    console.error("Rebuild them with `npm run build:vendor` in login-sdk/ and commit the result.");
    process.exit(1);
  }
  console.log(`login SDK bundles match the source (${targets.length} bundles checked).`);
}
