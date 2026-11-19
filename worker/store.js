// D1-backed store for the CMS Worker. Same behaviour as server/store.mjs (the Node/localhost store),
// but async and without a filesystem. Pure rules (validate, convert, schedule) are shared modules.
import { draftToContentBundle, isCmsDraft } from "../server/convert.mjs";
import { scheduleErrors } from "../server/schedule.mjs";
import { validateBundle } from "../server/validate.mjs";
import seedDraft from "../data/draft.json";
import { sha256Hex, signManifest } from "./keys.js";

export { scheduleErrors };

export const MAX_UPLOAD_BYTES = 1_500_000; // D1 stores a value up to 2 MB; leave headroom
const BANNER_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
const extOf = (name) => {
  const i = String(name).lastIndexOf(".");
  return i < 0 ? "" : String(name).slice(i).toLowerCase();
};
const bytesOf = (v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : Uint8Array.from(v));

export async function readDraft(db) {
  const row = await db.prepare("SELECT json FROM cms_draft WHERE id = 1").first();
  return row ? JSON.parse(row.json) : structuredClone(seedDraft);
}

function draftStatement(db, draft) {
  const next = { ...draft, updatedAt: new Date().toISOString() };
  return db
    .prepare("INSERT INTO cms_draft (id, json, updated_at) VALUES (1, ?1, ?2) ON CONFLICT(id) DO UPDATE SET json = ?1, updated_at = ?2")
    .bind(JSON.stringify(next), next.updatedAt);
}

export async function writeDraft(db, draft) {
  await draftStatement(db, draft).run();
}

export async function currentInfo(db) {
  const cur = await db.prepare("SELECT number, published_at, effective_at FROM release_current WHERE id = 1").first();
  const number = Number(cur?.number) || 0;
  return {
    number,
    publishedAt: cur?.published_at ?? null,
    effectiveAt: cur?.effective_at ?? null,
    manifestPath: number > 0 ? `/releases/${number}/manifest.json` : null,
  };
}

export async function listReleases(db) {
  const { results } = await db.prepare("SELECT number, published_at, effective_at, notes FROM releases ORDER BY number DESC").all();
  return results.map((r) => ({
    number: r.number,
    publishedAt: r.published_at ?? null,
    effectiveAt: r.effective_at ?? r.published_at ?? null,
    notes: r.notes ?? "",
  }));
}

export async function readSignedManifest(db, number) {
  const row = await db.prepare("SELECT manifest FROM releases WHERE number = ?").bind(number).first();
  return row ? JSON.parse(row.manifest) : null;
}

export async function readBlob(db, hash) {
  const row = await db.prepare("SELECT data FROM blobs WHERE hash = ?").bind(hash).first();
  return row ? bytesOf(row.data) : null;
}

export async function saveBannerUpload(db, bytes, opts = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new Error("empty upload body");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error(`file too large (max ${Math.floor(MAX_UPLOAD_BYTES / 1024)} KB)`);
  let ext = extOf(typeof opts.filename === "string" ? opts.filename : "banner.png");
  if (!BANNER_MIME[ext] && opts.contentType) {
    const byMime = Object.entries(BANNER_MIME).find(([, mime]) => mime === opts.contentType);
    if (byMime) ext = byMime[0];
  }
  if (!BANNER_MIME[ext]) throw new Error("unsupported image type (png/jpg/webp/gif)");
  const rand = [...crypto.getRandomValues(new Uint8Array(3))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const filename = `banner-${Date.now().toString(36)}-${rand}${ext}`;
  await db
    .prepare("INSERT INTO uploads (name, mime, data, created_at) VALUES (?, ?, ?, ?)")
    .bind(`banners/${filename}`, BANNER_MIME[ext], bytes, new Date().toISOString())
    .run();
  return { url: `/uploads/banners/${filename}`, path: `uploads/banners/${filename}`, filename };
}

export async function readUpload(db, rel) {
  if (typeof rel !== "string" || !rel || rel.includes("..")) return null;
  const row = await db.prepare("SELECT mime, data FROM uploads WHERE name = ?").bind(rel).first();
  return row ? { mime: row.mime, bytes: bytesOf(row.data) } : null;
}

/** Content blob + referenced banner art, as blob rows ready to insert. Throws on a missing asset. */
async function materialize(db, bundle) {
  const content = new TextEncoder().encode(JSON.stringify(bundle));
  const contentHash = await sha256Hex(content);
  const blobs = [{ hash: contentHash, bytes: content }];
  const files = [{ path: "content.json", hash: contentHash, size: content.length }];
  for (const rel of Array.isArray(bundle.assetPaths) ? bundle.assetPaths : []) {
    const safe = String(rel).replace(/\\/g, "/");
    if (!safe || safe.includes("..") || safe.startsWith("/")) throw new Error(`invalid asset path: ${rel}`);
    const up = safe.startsWith("uploads/") ? await readUpload(db, safe.slice("uploads/".length)) : null;
    if (!up) throw new Error(`missing asset: ${safe}`);
    const hash = await sha256Hex(up.bytes);
    blobs.push({ hash, bytes: up.bytes });
    files.push({ path: `assets/${safe}`, hash, size: up.bytes.length });
  }
  return { blobs, files, contentHash };
}

/** Insert blobs first, then the release row, the current pointer and the draft in one transaction. */
async function commitRelease(db, env, { number, previous, publishedAt, effectiveAt, bundle, blobs, files, contentHash, draft }) {
  const manifest = {
    number,
    publishedAt,
    ...(effectiveAt ? { effectiveAt } : {}),
    notes: typeof bundle.notes === "string" ? bundle.notes : "",
    contentHash,
    files,
  };
  const signature = await signManifest(manifest, env);
  const signed = { manifest, signature, alg: "ed25519" };

  const putBlob = db.prepare("INSERT OR IGNORE INTO blobs (hash, data, size) VALUES (?, ?, ?)");
  await db.batch(blobs.map((b) => putBlob.bind(b.hash, b.bytes, b.bytes.length)));

  const stmts = [
    // number is the primary key: a second publish racing this one fails here and the whole batch rolls back.
    db
      .prepare("INSERT INTO releases (number, published_at, effective_at, notes, manifest, content_hash) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(number, publishedAt, effectiveAt ?? null, manifest.notes, JSON.stringify(signed), contentHash),
    db
      .prepare("UPDATE release_current SET number = ?, published_at = ?, effective_at = ? WHERE id = 1 AND number = ?")
      .bind(number, publishedAt, effectiveAt ?? null, previous),
  ];
  if (draft) stmts.push(draftStatement(db, draft));
  try {
    await db.batch(stmts);
  } catch {
    return { ok: false, errors: ["Another release was published at the same time. Reload and try again."] };
  }
  return { ok: true, number, ...(effectiveAt ? { effectiveAt } : {}) };
}

/** @param {{ draft?: object, notes?: string, effectiveAt?: string }} [opts] */
export async function publish(db, env, opts = {}) {
  let draft;
  try {
    draft = opts.draft ? structuredClone(opts.draft) : await readDraft(db);
  } catch (err) {
    return { ok: false, errors: [String(err?.message || err)] };
  }
  if (typeof opts.notes === "string") draft.releaseNotes = opts.notes;

  const check = validateBundle(draft);
  if (!check.ok) return { ok: false, errors: check.errors };

  const bundle = isCmsDraft(draft) ? draftToContentBundle(draft) : draft;
  if (typeof opts.notes === "string") bundle.notes = opts.notes;

  let m;
  try {
    m = await materialize(db, bundle);
  } catch (err) {
    return { ok: false, errors: [String(err?.message || err)] };
  }

  const publishedAt = new Date().toISOString();
  let effectiveAt = publishedAt;
  if (opts.effectiveAt != null) {
    const t = Date.parse(String(opts.effectiveAt));
    if (!Number.isFinite(t)) return { ok: false, errors: ["effectiveAt must be a date and time"] };
    effectiveAt = new Date(t).toISOString();
  }
  const previous = (await currentInfo(db)).number;
  const result = await commitRelease(db, env, { number: previous + 1, previous, publishedAt, effectiveAt, bundle, ...m, draft });
  return result.ok ? { ...result, manifestPath: `/releases/${result.number}/manifest.json` } : result;
}

/** Re-publish an older release as a newer number (rollback). Like the Node store, it carries no effectiveAt. */
export async function rollback(db, env, toNumber) {
  const n = Number(toNumber);
  if (!Number.isInteger(n) || n < 1) return { ok: false, errors: ["to must be a positive release number"] };
  const signed = await readSignedManifest(db, n);
  const body = signed ? await readBlob(db, signed.manifest.contentHash) : null;
  if (!body) return { ok: false, errors: [`release ${n} not found`] };
  const bundle = JSON.parse(new TextDecoder().decode(body));
  const note = `Rollback to release ${n}`;
  bundle.notes = bundle.notes ? `${note}: ${bundle.notes}` : note;

  let m;
  try {
    m = await materialize(db, bundle);
  } catch (err) {
    return { ok: false, errors: [String(err?.message || err)] };
  }
  const check = validateBundle(bundle);
  if (!check.ok) return { ok: false, errors: check.errors };

  const previous = (await currentInfo(db)).number;
  const result = await commitRelease(db, env, {
    number: previous + 1,
    previous,
    publishedAt: new Date().toISOString(),
    effectiveAt: null,
    bundle,
    ...m,
  });
  return result.ok ? { ok: true, number: result.number, rolledBackFrom: n, manifestPath: `/releases/${result.number}/manifest.json` } : result;
}
