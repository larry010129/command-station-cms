// Cloudflare Access gate. Every /api and /uploads request must carry a valid Access JWT.
// Fails closed: if the team domain or audience is not configured, nothing is allowed.

const b64uToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const b64uToJson = (s) => JSON.parse(new TextDecoder().decode(b64uToBytes(s)));

let certCache = { at: 0, keys: null };

async function signingKeys(team) {
  if (certCache.keys && Date.now() - certCache.at < 10 * 60_000) return certCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error("could not load Access certs");
  const { keys } = await res.json();
  certCache = { at: Date.now(), keys };
  return keys;
}

const isLocal = (request) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname);

/** @returns {Promise<{ email: string } | null>} the signed-in user, or null to refuse. */
export async function authenticate(request, env) {
  // Local `wrangler dev` only (.dev.vars). Ignored on any real hostname.
  if (env.DEV_AUTH_BYPASS === "1" && isLocal(request)) return { email: "dev@localhost" };

  const team = env.ACCESS_TEAM_DOMAIN; // e.g. yuzi010129.cloudflareaccess.com
  const aud = env.ACCESS_AUD;
  if (!team || !aud) return null;

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const header = b64uToJson(parts[0]);
    const payload = b64uToJson(parts[1]);
    if (header.alg !== "RS256") return null;
    if (payload.iss !== `https://${team}`) return null;
    const audOk = Array.isArray(payload.aud) ? payload.aud.includes(aud) : payload.aud === aud;
    if (!audOk) return null;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;

    const jwk = (await signingKeys(team)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64uToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return null;

    const email = String(payload.email || "").toLowerCase();
    const allowed = String(env.ALLOWED_EMAILS || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(email)) return null;
    return { email };
  } catch {
    return null;
  }
}
