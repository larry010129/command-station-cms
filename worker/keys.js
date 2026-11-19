// Ed25519 signing with Web Crypto (same signatures as server/keys.mjs: canonical JSON, base64).

/** Stable JSON for signing (sorted object keys, no whitespace). Must match server/keys.mjs canonicalJson. */
export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeys(value[k]);
    return out;
  }
  return value;
}

function pemToDer(pem) {
  const b64 = String(pem).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** @returns {Promise<string>} base64 signature. Throws if the signing secret is missing: never invents a key. */
export async function signManifest(manifest, env) {
  if (!env.SIGNING_KEY) throw new Error("SIGNING_KEY secret is not set; publishing is disabled");
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(env.SIGNING_KEY), { name: "Ed25519" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(canonicalJson(manifest)));
  return toB64(sig);
}

export async function verifyManifest(manifest, signatureB64, env) {
  if (!env.PUBLIC_KEY) throw new Error("PUBLIC_KEY is not set");
  const key = await crypto.subtle.importKey("spki", pemToDer(env.PUBLIC_KEY), { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify("Ed25519", key, fromB64(signatureB64), new TextEncoder().encode(canonicalJson(manifest)));
}

export async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
