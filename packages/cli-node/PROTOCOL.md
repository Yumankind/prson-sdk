# CLI login protocol (language-agnostic)

`@prson/login-cli` is a thin convenience wrapper — the protocol is four
steps any language can do. The CLI side holds **no secrets and does no
cryptography**: it builds a URL, shows it, and polls your own backend.
All verification happens at your backend's delivery endpoint (see
[README.md § Backend side](./README.md#backend-side)).

## The four steps

1. **Nonce** — 32 random bytes from a CSPRNG, base64url-encoded, no
   padding. This keys the pending login in your backend; treat it as a
   bearer secret for that one login.

2. **Request blob** — JSON, then base64url (no padding), into the link:

   ```json
   {
     "v": 1,
     "domain": "example.com",
     "nonce": "<b64u nonce>",
     "responseUrl": "https://example.com/api/prson/cli-callback",
     "required": {
       "minVerificationLevel": 4,
       "claims": ["verified_human_at"],
       "predicates": ["age_gte_18"],
       "uniqueHumanId": true
     }
   }
   ```

   ```
   https://app.prson.net/request/v1?req=<base64url(JSON)>
   ```

   Validation the wallet enforces (mirror it to fail fast in the
   terminal instead of on the user's phone):
   - `domain`: lowercase LDH (`a-z0-9.-`), contains at least one dot, no port
   - `responseUrl` / optional `returnUrl`: HTTPS, host **exactly equals**
     `domain`, port 443 only (delivery pinning)
   - `nonce`: ≥ 16 chars (spec minimum is 8; use 32 random bytes)
   - `required`: at least one of `minVerificationLevel` (integer 0–6),
     `claims`, `predicates`, `uniqueHumanId: true`

3. **Show it** — render the URL as a QR in the terminal. Optionally also
   print a short code: first 8 chars of Crockford-base32(SHA-256(nonce))
   as `XXXX-XXXX`, with your backend serving
   `https://<domain>/cli/<code>` → 302 to the full URL, so the user can
   type instead of scan.

4. **Poll** — ask your backend (keyed by `nonce`) every ~2 s, up to
   ~5 min, until the wallet's POST has landed and your backend has
   verified it (`@prson/login-verifier` or equivalent) and minted a
   session. `404`/empty = pending.

What the wallet POSTs to `responseUrl` on approve:

```json
{
  "v": 1,
  "action": "request",
  "nonce": "<echoed>",
  "domain": "example.com",
  "presentation": "<sd-jwt>~<disclosure>~…~<kb-jwt>",
  "facts": { "status": "complete", "format": "native", "facts": [ … ] },
  "uniqueHumanId": { "envelope": { … }, "signature": "…", "kid": "…" }
}
```

---

## Python

stdlib + `qrcode` (`pip install qrcode requests`):

```python
import base64, hashlib, json, secrets, time
import qrcode, requests

def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()

nonce = b64u(secrets.token_bytes(32))
req = {
    "v": 1, "domain": "example.com", "nonce": nonce,
    "responseUrl": "https://example.com/api/prson/cli-callback",
    "required": {"predicates": ["age_gte_18"], "uniqueHumanId": True},
}
url = "https://app.prson.net/request/v1?req=" + b64u(json.dumps(req).encode())

qr = qrcode.QRCode(border=1)
qr.add_data(url)
qr.print_ascii(tty=True)                       # terminal QR

code = base64.b32encode(hashlib.sha256(nonce.encode()).digest())[:8].decode()
print(f"...or open https://example.com/cli/{code[:4]}-{code[4:]}")

deadline = time.time() + 300
while time.time() < deadline:                   # poll your backend
    r = requests.get("https://example.com/api/prson/cli-status",
                     params={"nonce": nonce}, timeout=10)
    if r.status_code == 200:
        session = r.json()["sessionToken"]; break
    time.sleep(2)
```

(Note: Python's `b32encode` is RFC 4648, not Crockford — fine unless you
need codes byte-identical to the Node package; then map the alphabet.)

## Go

`go get github.com/mdp/qrterminal/v3`:

```go
package main

import (
    "crypto/rand"
    "encoding/base64"
    "encoding/json"
    "fmt"
    "net/http"
    "os"
    "time"

    "github.com/mdp/qrterminal/v3"
)

func main() {
    raw := make([]byte, 32)
    rand.Read(raw)
    nonce := base64.RawURLEncoding.EncodeToString(raw)

    blob, _ := json.Marshal(map[string]any{
        "v": 1, "domain": "example.com", "nonce": nonce,
        "responseUrl": "https://example.com/api/prson/cli-callback",
        "required": map[string]any{
            "predicates": []string{"age_gte_18"}, "uniqueHumanId": true,
        },
    })
    url := "https://app.prson.net/request/v1?req=" +
        base64.RawURLEncoding.EncodeToString(blob)

    qrterminal.GenerateHalfBlock(url, qrterminal.L, os.Stdout)

    deadline := time.Now().Add(5 * time.Minute)
    for time.Now().Before(deadline) {
        resp, err := http.Get(
            "https://example.com/api/prson/cli-status?nonce=" + nonce)
        if err == nil && resp.StatusCode == 200 {
            var out struct{ SessionToken string }
            json.NewDecoder(resp.Body).Decode(&out)
            fmt.Println("signed in:", out.SessionToken)
            return
        }
        time.Sleep(2 * time.Second)
    }
}
```

## Rust

`cargo add rand base64 serde_json qrcode reqwest tokio --features tokio/full,reqwest/json`:

```rust
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use qrcode::{render::unicode, QrCode};
use std::time::Duration;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let nonce = URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>());
    let req = serde_json::json!({
        "v": 1, "domain": "example.com", "nonce": nonce,
        "responseUrl": "https://example.com/api/prson/cli-callback",
        "required": { "predicates": ["age_gte_18"], "uniqueHumanId": true }
    });
    let url = format!("https://app.prson.net/request/v1?req={}",
        URL_SAFE_NO_PAD.encode(req.to_string()));

    let qr = QrCode::new(&url)?;
    println!("{}", qr.render::<unicode::Dense1x2>().quiet_zone(true).build());

    let client = reqwest::Client::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(300);
    let session = loop {
        let resp = client
            .get("https://example.com/api/prson/cli-status")
            .query(&[("nonce", nonce.as_str())])
            .send().await?;
        if resp.status().is_success() {
            break resp.json::<serde_json::Value>().await?["sessionToken"]
                .as_str().unwrap().to_owned();
        }
        if std::time::Instant::now() > deadline { anyhow::bail!("timed out"); }
        tokio::time::sleep(Duration::from_secs(2)).await;
    };
    println!("signed in: {session}");
    Ok(())
}
```

## Bash

For quick scripts and CI — `jq`, `openssl`, `qrencode`, `curl`:

```bash
#!/usr/bin/env bash
set -euo pipefail

b64u() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

NONCE=$(head -c 32 /dev/urandom | b64u)
REQ=$(jq -nc --arg n "$NONCE" '{
  v: 1, domain: "example.com", nonce: $n,
  responseUrl: "https://example.com/api/prson/cli-callback",
  required: { predicates: ["age_gte_18"], uniqueHumanId: true }
}')
URL="https://app.prson.net/request/v1?req=$(printf %s "$REQ" | b64u)"

qrencode -t UTF8 "$URL"
echo "Scan with the Prson app, then approving signs you in..."

for _ in $(seq 1 150); do
  if TOKEN=$(curl -fsS "https://example.com/api/prson/cli-status?nonce=$NONCE" \
      | jq -re .sessionToken); then
    echo "signed in: $TOKEN"; exit 0
  fi
  sleep 2
done
echo "timed out" >&2; exit 1
```

---

## Reference implementations

- TypeScript/Node: [`src/index.ts`](./src/index.ts) (this package — the
  validation logic to mirror)
- Wallet-side parser (ground truth for what's accepted):
  `mobile-app/prson_app/lib/core/utils/wallet_action_link.dart`
- Backend verification: [`@prson/login-verifier`](../verifier-node/README.md)
  — Node-only today; non-Node backends can run it as a sidecar, or
  implement the five rules in [SECURITY.md](../../SECURITY.md)
  (RS256 issuer JWS → disclosure digests → Ed25519 KB-JWT with
  `aud`/`nonce`/`sd_hash`/`iat` → `exp`).
