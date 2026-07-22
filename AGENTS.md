# AGENTS.md

## Cursor Cloud specific instructions

`govwatch-status` is a serverless, dependency-free static status page. There is no
`package.json`, no lockfile, and no runtime services — the repo itself is the database.
It targets Node.js (Node 22 is preinstalled). The two scripts use only Node built-ins.

### Pipeline / how to run

The end-to-end flow (mirrors `.github/workflows/monitor.yml`):

1. Fetch fresh checks: `npx -y @capitoltrace/govwatch@latest check --json > raw.json`
   - This exits non-zero when any monitored API is down/degraded — that is expected. The
     workflow appends `|| true`. Do not treat a non-zero exit as failure; only an empty or
     non-array `raw.json` is a real failure (`record.mjs` guards against that).
   - Keyed services (Open States, Census, ACLED, Quiver, plus `DATA_GOV_API_KEY` etc.) are
     reported as `skipped` unless their API-key env vars are set. Keyless services still run.
2. Record into committed data: `node scripts/record.mjs raw.json` — appends a line to
   `data/history/YYYY-MM.ndjson` and rewrites `data/latest.json`.
3. Build the site: `node scripts/generate.mjs` — writes `site/index.html`, `site/status.json`,
   and `site/history-30d.json`.

`scripts/generate.mjs` can be run on its own against the committed `data/` without any network
access — useful for iterating on the HTML/site output.

### Serving / previewing

There is no dev server. `site/` is plain static files (git-ignored). Preview with any static
server, e.g. `python3 -m http.server 8080` from inside `site/`, then open `http://localhost:8080/`.

### Lint / test / build

There is no lint config, no test suite, and no build step beyond `node scripts/generate.mjs`.
The only "build" is generating `site/`.

### Notes

- Running `scripts/record.mjs` mutates committed files under `data/`. If you only want to
  verify the environment, revert those with `git checkout -- data/` afterward.
- `raw.json`, `site/`, and `node_modules/` are git-ignored.
