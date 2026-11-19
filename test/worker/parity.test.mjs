// The Worker signs with Web Crypto, localhost signs with node:crypto. Ed25519 is deterministic, so the same key and
// manifest must give byte-identical signatures, and each side must verify the other's.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { canonicalJson as nodeCanon } from "../../server/keys.mjs";
import { canonicalJson as workerCanon, signManifest, verifyManifest } from "../../worker/keys.js";

const manifest = {
  number: 7,
  publishedAt: "2026-11-19T00:00:00.000Z",
  effectiveAt: "2026-11-20T00:00:00.000Z",
  notes: "n",
  contentHash: "ab".repeat(32),
  files: [{ path: "content.json", hash: "ab".repeat(32), size: 3 }],
};
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const env = {
  SIGNING_KEY: privateKey.export({ type: "pkcs8", format: "pem" }),
  PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }),
};

test("canonical JSON is identical on both sides", () => {
  const messy = { b: [{ z: 1, a: 2 }], a: { y: null, x: "é" } };
  assert.equal(workerCanon(messy), nodeCanon(messy));
  assert.equal(workerCanon(manifest), nodeCanon(manifest));
});

test("Worker signature is byte-identical to the Node one", async () => {
  const fromNode = crypto.sign(null, Buffer.from(nodeCanon(manifest), "utf8"), privateKey).toString("base64");
  assert.equal(await signManifest(manifest, env), fromNode);
});

test("each side verifies the other", async () => {
  const sig = await signManifest(manifest, env);
  assert.equal(crypto.verify(null, Buffer.from(nodeCanon(manifest), "utf8"), publicKey, Buffer.from(sig, "base64")), true);
  assert.equal(await verifyManifest(manifest, sig, env), true);
  assert.equal(await verifyManifest({ ...manifest, number: 8 }, sig, env), false);
});

test("publishing refuses to run without the signing secret", async () => {
  await assert.rejects(() => signManifest(manifest, {}), /SIGNING_KEY/);
});
