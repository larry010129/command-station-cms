# CMS on Cloudflare

Two Workers share one D1 database (`command-station`):

| Worker | Who can reach it | Job |
| --- | --- | --- |
| `command-station-cms` (this repo) | You only, behind Cloudflare Access | The editor UI and the `/api/*` routes: draft, upload, publish, rollback |
| `command-station-releases` | Everyone (the game) | Read-only `/releases/*` served from the same database |

The routes and rules are the same as the localhost server (`server/`). The Worker versions live in `worker/`.
`npm run dev` still runs the localhost version on port 1430 with files in `data/`.

## One-time setup

1. **Access.** Zero Trust -> Access -> Applications -> Add -> Self-hosted. Application domain: the CMS Worker's
   `command-station-cms.<subdomain>.workers.dev` hostname. Policy: Allow, Emails, your email. Copy the **Application
   Audience (AUD) tag**. Also protect the Worker's preview URLs.
2. **Variables** (CMS Worker -> Settings -> Variables and Secrets, or `wrangler.jsonc` `vars`):
   `ACCESS_TEAM_DOMAIN` = `<team>.cloudflareaccess.com`, `ACCESS_AUD` = the tag, `ALLOWED_EMAILS` = your email,
   `PUBLIC_KEY` = contents of `data/keys/prod-ed25519-public.pem`.
3. **Secret.** `SIGNING_KEY` = contents of `data/keys/prod-ed25519-private.pem` (a Secret, not a plain variable).
   The same `PUBLIC_KEY` goes on the releases Worker so `/releases/public-key` works.
4. Until 2 is done every `/api/*` call returns 401 and publishing is off. That is on purpose.

## Local Worker test

```
npm run build
npx wrangler d1 migrations apply command-station --local
npx wrangler dev --local --port 8788      # uses .dev.vars (DEV_AUTH_BYPASS, test keys); localhost only
npm run test:worker
```

Banner art is stored in D1, so uploads are capped at 1.5 MB. Move to R2 if that becomes too small.
