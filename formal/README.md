# Formal verification — Sign in with Prson

Machine-checked symbolic (Dolev–Yao) analysis of the login protocol,
using [ProVerif](https://bblanche.gitlabpages.inria.fr/proverif/) 2.05.
This is the artifact behind the white paper §16 "Formal verification"
line — the hand-written Claims of §8.4/§10 are complemented here by a
tool-checked model of the login protocol's core.

## Files

| File | Purpose |
|---|---|
| `login.pv` | The protocol model + four security queries. **All proved.** |
| `login_negative_control.pv` | A deliberately broken variant (no Origin pinning / canonical echo). **Attacks found, as expected** — demonstrates the model has teeth. |
| `results-login.txt` | Captured ProVerif output for `login.pv`. |
| `results-negative-control.txt` | Captured output for the negative control. |

## What is modelled

The login flow of `ARCHITECTURE.md` §4 / white paper §10.2:

1. Page → relay (TLS): Origin-pinned draft `{domain, nonce, browserPk}`.
2. relay → wallet (air gap): QR / universal-link pointer.
3. wallet → relay (TLS): identity-key-signed claim over
   `(domain, nonce, serverTs)`; relay returns the **canonical** stored
   request; the wallet byte-compares (anti-tamper).
4. wallet ⇄ page (P2P): the SD-JWT-VC + KB-JWT presentation, sealed in
   a NaCl box to the page's ephemeral X25519 key.

**Attacker (Dolev–Yao).** Controls the air-gapped / peer-to-peer
transport `net` (QR channel + WebRTC/signaling path): reads, injects,
replays, reorders, tampers. The TLS connections to the relay are
modelled as authentic confidential channels — the trust we actually
rely on, stated explicitly. The relay is honest (our own
infrastructure; the security argument depends on its Origin check). The
attacker may run its own malicious pages and engage the wallet freely;
it never learns an honest page's ephemeral key or the wallet's identity
key.

**Out of scope (stated, not hidden):** the WebRTC/DTLS handshake
beneath the data channel, TURN allocation, biometric unlock, and the
verifier's policy engine. We model the cryptographic core the security
claims rest on.

A modelling note for reviewers: the honest RP page and the honest relay
share a trust domain (both are ours, and Origin-pinning means the relay
faithfully adopts the page's true origin), so they are modelled as one
honest *initiator* per origin. This is faithful and makes each session
linear by construction — capturing the relay's operational
single-use-reqId guarantee structurally, rather than leaving it to the
non-linear channel abstraction (which otherwise yields a spurious
injective-agreement failure; see the git history of this file).

## Properties proved (`login.pv`)

| # | Property | Query | Result |
|---|---|---|---|
| S1 | **Presentation secrecy** vs. the network attacker | `attacker(presentationSecret)` | secret (true) |
| A2 | **Domain-binding authentication** — the wallet only accepts a session for a `(domain,nonce,pk)` an honest page on that origin initiated | `WalletAccept ⇒ PageInit` | true |
| T3 | **Injective agreement / tamper resistance** — distinct acceptances map to distinct initiations (no replay/duplication of a session) | `inj WalletAccept ⇒ inj PageInit` | true |
| R4 | **Injective end-to-end replay resistance** — a page accepts only a presentation the wallet actually produced for that `(domain,nonce)`, despite attacker-controlled delivery | `inj PageAccepted ⇒ inj WalletPresented` | true |
| — | Non-vacuity sanity (an honest run completes) | `event(PageAccepted) ⇒ false` | false (i.e. reachable) |

In plain terms: an attacker who fully controls the QR channel and the
peer-to-peer transport cannot (a) learn the presentation, (b) make the
wallet sign in to a site the user's page did not initiate
(anti-phishing), (c) replay a captured session, or (d) replay a
captured presentation into a second accepted login.

## Negative control (`login_negative_control.pv`)

The same queries against a strawman where the wallet trusts the raw QR
(no relay, no Origin pin, no canonical echo). ProVerif reports **S1 and
A2 false** and produces concrete attack traces — confirming the
security in `login.pv` comes from the modelled protections, not from a
trivially-true model.

## Reproducing

```sh
# ProVerif 2.05 (CLI build, no GTK needed):
#   download proverif2.05.tar.gz from the ProVerif site, then:
#   ./build -nointeract      (requires OCaml; e.g. via opam)
proverif login.pv
proverif login_negative_control.pv
```

## Scope and honesty

Symbolic analysis assumes perfect cryptography (the Dolev–Yao model):
it finds protocol/logic flaws — replays, reflections, missing bindings,
type confusions — not weaknesses in the primitives themselves
(Ed25519, X25519/NaCl, the hash). It also covers the modelled core, not
the omitted layers listed above. A computational-model proof and a
Tamarin cross-check remain future work (white paper §16). The model is
published so its assumptions and abstractions can be audited; issues to
hello@yumankind.com.
