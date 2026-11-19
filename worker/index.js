// CMS Worker: the same /api routes as server/http.mjs, on D1, behind Cloudflare Access.
// The built editor UI is served by the assets binding (wrangler.jsonc); this code runs for /api/* and /uploads/*.
import { validateBundle } from "../server/validate.mjs";
import { authenticate } from "./auth.js";
import { verifyManifest } from "./keys.js";
import * as store from "./store.js";

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

async function readJson(request) {
  const text = await request.text();
  return text ? JSON.parse(text) : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    if (!pathname.startsWith("/api/") && !pathname.startsWith("/uploads/")) {
      return env.ASSETS.fetch(request); // the editor UI
    }

    // No CORS headers on purpose: the editor and its API share one origin.
    const user = await authenticate(request, env);
    if (!user) return json(401, { ok: false, errors: ["Sign in required"] });

    const db = env.DB;
    try {
      if (method === "GET" && pathname.startsWith("/uploads/")) {
        const up = await store.readUpload(db, pathname.slice("/uploads/".length));
        if (!up) return json(404, { error: "upload not found" });
        return new Response(up.bytes, { headers: { "content-type": up.mime, "cache-control": "private, max-age=3600" } });
      }

      if (pathname === "/api/whoami" && method === "GET") return json(200, { ok: true, email: user.email });

      if (pathname === "/api/upload" && method === "POST") {
        if ((url.searchParams.get("folder") || "banners") !== "banners") {
          return json(400, { ok: false, errors: ["unsupported folder"] });
        }
        const bytes = new Uint8Array(await request.arrayBuffer());
        const saved = await store.saveBannerUpload(db, bytes, {
          filename: request.headers.get("x-filename") || url.searchParams.get("filename") || "banner.png",
          contentType: (request.headers.get("content-type") || "").split(";")[0].trim() || undefined,
        });
        return json(200, { ok: true, url: saved.url, path: saved.path });
      }

      if (pathname === "/api/draft" && method === "GET") return json(200, await store.readDraft(db));
      if (pathname === "/api/draft" && method === "PUT") {
        const body = await readJson(request);
        if (!body || typeof body !== "object") return json(400, { ok: false, errors: ["JSON object required"] });
        await store.writeDraft(db, body);
        return json(200, { ok: true, path: "d1:cms_draft" });
      }

      if (pathname === "/api/validate" && method === "POST") {
        const body = await readJson(request);
        const result = validateBundle(body && (body.economy || body.gacha) ? body : await store.readDraft(db));
        return json(result.ok ? 200 : 400, result);
      }

      if (pathname === "/api/publish" && method === "POST") {
        const body = await readJson(request);
        const timeErrors = store.scheduleErrors(body?.effectiveAt);
        if (timeErrors.length) return json(400, { ok: false, errors: timeErrors });
        const result = await store.publish(db, env, { notes: body?.notes, draft: body?.draft, effectiveAt: body?.effectiveAt });
        return json(result.ok ? 200 : 400, result);
      }

      if (pathname === "/api/rollback" && method === "POST") {
        const body = await readJson(request);
        const result = await store.rollback(db, env, body?.to ?? body?.number);
        return json(result.ok ? 200 : 400, result);
      }

      if (pathname === "/api/releases" && method === "GET") {
        return json(200, { current: await store.currentInfo(db), releases: await store.listReleases(db) });
      }

      if (pathname === "/api/verify" && method === "POST") {
        const body = await readJson(request);
        const signed = body?.number != null ? await store.readSignedManifest(db, Number(body.number)) : body;
        if (!signed?.manifest || !signed?.signature) return json(400, { ok: false, errors: ["manifest + signature required"] });
        return json(200, { ok: await verifyManifest(signed.manifest, signed.signature, env) });
      }

      return json(404, { error: `Unknown API route ${pathname}` });
    } catch (err) {
      // Bad JSON and the like are the caller's mistake; anything else is ours.
      const bad = err instanceof SyntaxError || /too large|unsupported|empty upload/.test(String(err?.message));
      return json(bad ? 400 : 500, { ok: false, errors: [String(err?.message || err)] });
    }
  },
};
