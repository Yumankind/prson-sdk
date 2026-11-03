/**
 * Reads the sign-in code's URL (the universal link the SDK builds:
 * `https://app.prson.net/login/v1?s=…&d=<domain>&req=<b64u JSON>&t=<serverTs>`)
 * and describes it for people: which site, and exactly what that site
 * will get. Pure functions, no DOM, so they're easy to test.
 */

export type ShareIcon = "shield" | "user" | "calendar" | "id" | "mail" | "phone" | "home" | "building" | "key" | "flag" | "check";

export type ShareItem = { icon: ShareIcon; label: string; detail?: string };

export type CodeDescription = {
  /** The site the person signs in to (`d=`), or "" when the URL has none. */
  domain: string;
  /** The server timestamp the code was issued at (epoch seconds), when present. */
  serverTs: number | null;
  /** What the site will receive, in order. Always at least one item. */
  shares: ShareItem[];
  /** The site lets the person sign in without an identity. */
  anonymousAllowed: boolean;
};

type Required = {
  minVerificationLevel?: number;
  requiredClaims?: string[];
  predicates?: string[];
  identityType?: "personal" | "organization";
  uniqueHumanId?: boolean;
};

type Request = {
  domain?: string;
  required?: Required;
  allowAnonymous?: boolean;
  ephemeralIdentity?: boolean;
};

function b64uDecode(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function param(url: string, name: string): string | null {
  try {
    return new URL(url).searchParams.get(name);
  } catch {
    // `prson://` URLs from older verifiers: fall back to a regex.
    const m = url.match(new RegExp(`[?&]${name}=([^&#]*)`));
    const cap = m?.[1];
    return cap ? decodeURIComponent(cap) : null;
  }
}

const CLAIMS: Record<string, ShareItem> = {
  given_name: { icon: "user", label: "Your name" },
  family_name: { icon: "user", label: "Your name" },
  name: { icon: "user", label: "Your name" },
  full_name: { icon: "user", label: "Your name" },
  birthdate: { icon: "calendar", label: "Date of birth" },
  birth_date: { icon: "calendar", label: "Date of birth" },
  age: { icon: "calendar", label: "Your age" },
  email: { icon: "mail", label: "Email address" },
  phone: { icon: "phone", label: "Phone number" },
  phone_number: { icon: "phone", label: "Phone number" },
  address: { icon: "home", label: "Address" },
  nationality: { icon: "flag", label: "Nationality" },
  nationalities: { icon: "flag", label: "Nationality" },
  document_number: { icon: "id", label: "Document number" },
  document_type: { icon: "id", label: "Document type" },
  picture: { icon: "user", label: "Photo" },
};

const PREDICATES: Record<string, ShareItem> = {
  phone_verified: { icon: "phone", label: "A verified phone number", detail: "Not the number itself" },
  email_verified: { icon: "mail", label: "A verified email", detail: "Not the address itself" },
  address_verified: { icon: "home", label: "A verified address", detail: "Not the address itself" },
  bank_verified: { icon: "check", label: "A verified bank account", detail: "Not the account itself" },
};

/** "some_claim_name" → "Some claim name". */
function humanize(s: string): string {
  const t = s.replace(/[_-]+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : s;
}

function predicateItem(p: string): ShareItem {
  const known = PREDICATES[p];
  if (known) return known;
  const age = p.match(/^age_(gte|gt|over|lt|under)_(\d{1,3})$/);
  if (age) {
    const n = Number(age[2]);
    const label =
      age[1] === "gte" || age[1] === "over" ? `${n} or older` : age[1] === "gt" ? `Older than ${n}` : `Under ${n}`;
    return { icon: "calendar", label, detail: "Not your date of birth" };
  }
  return { icon: "check", label: humanize(p), detail: "Yes or no only" };
}

/** What a site asking for [required] gets, one row per distinct thing. */
export function describeShares(req: Request): ShareItem[] {
  const r = req.required ?? {};
  const out: ShareItem[] = [];
  const seen = new Set<string>();
  const add = (i: ShareItem) => {
    if (seen.has(i.label)) return;
    seen.add(i.label);
    out.push(i);
  };

  if (r.identityType === "organization") add({ icon: "building", label: "An organisation identity" });
  const level = r.minVerificationLevel ?? 1;
  if (r.uniqueHumanId) {
    add({ icon: "shield", label: "Verified unique person", detail: "Passport or ID checked · not trackable across sites" });
  } else if (level >= 4) {
    add({ icon: "shield", label: "Verified human", detail: "Passport or ID checked" });
  } else if (level >= 1) {
    add({ icon: "shield", label: "Verified human" });
  } else {
    add({ icon: "shield", label: "Your Prson identity", detail: "Verified or not" });
  }
  for (const p of r.predicates ?? []) add(predicateItem(p));
  for (const c of r.requiredClaims ?? []) add(CLAIMS[c] ?? { icon: "check", label: humanize(c) });
  add(
    req.ephemeralIdentity
      ? { icon: "key", label: "A one-time key", detail: "Nothing links your visits" }
      : { icon: "key", label: "A sign-in key just for this site" },
  );
  return out;
}

/** Everything the card shows about a code, from its URL alone. */
export function describeCode(url: string): CodeDescription {
  let req: Request = {};
  const raw = param(url, "req");
  if (raw) {
    try {
      req = JSON.parse(b64uDecode(raw)) as Request;
    } catch {
      req = {};
    }
  }
  const t = param(url, "t");
  const serverTs = t && /^\d+$/.test(t) ? parseInt(t, 10) : null;
  return {
    domain: param(url, "d") ?? req.domain ?? "",
    serverTs,
    shares: describeShares(req),
    anonymousAllowed: req.allowAnonymous === true,
  };
}

/** The letter for a site's monogram: its registrable name's first letter ("shop.example.com" → "E"). */
export function monogram(domain: string): string {
  const host = domain.replace(/:\d+$/, "").toLowerCase();
  const parts = host.split(".").filter(Boolean);
  // Drop a leading "www"/"app"/"shop"-style label only when there's a name after it.
  const name = parts.length >= 3 ? parts[parts.length - 2] : parts[0];
  const ch = (name ?? host).match(/[a-z0-9]/i)?.[0] ?? "?";
  return ch.toUpperCase();
}
