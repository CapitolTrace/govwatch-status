<h1 align="center">🔍 govwatch-status</h1>

<p align="center">
  <strong><a href="https://status.capitoltrace.com/">status.capitoltrace.com</a></strong><br/>
  <em>Live status page for 17 U.S. government APIs — is Congress.gov down? Now you know.</em>
</p>

---

Every 30 minutes, a GitHub Actions cron runs [govwatch](https://github.com/CapitolTrace/govwatch)
against Congress.gov, FEC, CISA KEV, NVD, GDELT, and 12 more government APIs, commits the
results to [`data/`](data/), and deploys a static page to GitHub Pages.

## How it works

1. [`monitor.yml`](.github/workflows/monitor.yml) runs `npx @capitoltrace/govwatch check --json` on a cron
2. [`scripts/record.mjs`](scripts/record.mjs) appends a compact line to `data/history/YYYY-MM.ndjson` and refreshes `data/latest.json`
3. [`scripts/generate.mjs`](scripts/generate.mjs) builds `site/` — status baked into static HTML, plus JSON endpoints
4. `actions/deploy-pages` publishes to GitHub Pages

No servers, no database, no cost. The repo *is* the database.

## JSON endpoints

| URL | Contents |
|:--|:--|
| [`/status.json`](https://status.capitoltrace.com/status.json) | Latest full check results |
| [`/history-30d.json`](https://status.capitoltrace.com/history-30d.json) | 30-day uptime % and response-time aggregates per service |

## API keys

Keyless services are monitored out of the box. To monitor keyed services (Open States,
Census, ACLED, Quiver) or make api.data.gov services immune to shared-runner rate limits,
add repository secrets: `DATA_GOV_API_KEY`, `OPENSTATES_API_KEY`, `CENSUS_API_KEY`,
`NVD_API_KEY`, `ACLED_API_KEY` + `ACLED_EMAIL`, `QUIVER_API_KEY`.
See the [govwatch key table](https://github.com/CapitolTrace/govwatch#api-keys).

## Local development

```bash
npx -y @capitoltrace/govwatch check --json > raw.json
node scripts/record.mjs raw.json
node scripts/generate.mjs
# open site/index.html
```

## License

MIT

---

<p align="center">
  <strong>Part of the <a href="https://github.com/CapitolTrace">Capitol Trace</a> ecosystem.</strong><br/>
  <em>Because democracy runs on uptime.</em>
</p>
