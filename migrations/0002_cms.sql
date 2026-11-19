-- CMS storage (shared by the CMS Worker, which writes, and the releases Worker, which reads).
CREATE TABLE IF NOT EXISTS cms_draft (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  json       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS releases (
  number       INTEGER PRIMARY KEY,
  published_at TEXT NOT NULL,
  effective_at TEXT,
  notes        TEXT NOT NULL DEFAULT '',
  manifest     TEXT NOT NULL,        -- the signed manifest as JSON ({ manifest, signature, alg })
  content_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS release_current (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  number       INTEGER NOT NULL,
  published_at TEXT,
  effective_at TEXT
);
INSERT OR IGNORE INTO release_current (id, number, published_at, effective_at) VALUES (1, 0, NULL, NULL);

-- Content-addressed files (content.json and banner art), named by SHA-256.
CREATE TABLE IF NOT EXISTS blobs (
  hash TEXT PRIMARY KEY,
  data BLOB NOT NULL,
  size INTEGER NOT NULL
);

-- Banner art uploaded in the editor, served to the CMS preview at /uploads/banners/<name>.
CREATE TABLE IF NOT EXISTS uploads (
  name       TEXT PRIMARY KEY,
  mime       TEXT NOT NULL,
  data       BLOB NOT NULL,
  created_at TEXT NOT NULL
);
