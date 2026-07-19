#!/usr/bin/env node
// Builds the static status site from data/ into site/.
// Data is baked into the HTML at generation time so crawlers (and humans
// with JS disabled) see everything; JSON endpoints ship alongside.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE_URL = 'https://capitoltrace.github.io/govwatch-status/';
const TICKS = 48; // ~24h of 30-minute checks

// SEO-bearing copy: name the API and its domain so outage queries land here.
const META = {
  congress: { domain: 'api.congress.gov', desc: 'Bills, amendments, members, and committee data from the Library of Congress.' },
  fec: { domain: 'api.open.fec.gov', desc: 'Campaign finance data — candidates, committees, and filings — from the Federal Election Commission.' },
  'senate-lda': { domain: 'lda.senate.gov', desc: 'Lobbying Disclosure Act filings from the U.S. Senate.' },
  govinfo: { domain: 'api.govinfo.gov', desc: 'Official federal publications from the U.S. Government Publishing Office.' },
  'federal-register': { domain: 'federalregister.gov', desc: 'Daily rules, proposed rules, and notices of the U.S. federal government.' },
  usaspending: { domain: 'api.usaspending.gov', desc: 'Federal spending, awards, and agency budget data.' },
  openstates: { domain: 'v3.openstates.org', desc: 'State legislature bills, legislators, and votes across all 50 states.' },
  census: { domain: 'api.census.gov', desc: 'American Community Survey demographic data from the U.S. Census Bureau.' },
  bls: { domain: 'api.bls.gov', desc: 'Employment and price statistics from the Bureau of Labor Statistics.' },
  'cisa-kev': { domain: 'cisa.gov', desc: 'Known Exploited Vulnerabilities catalog from CISA, including feed freshness.' },
  nvd: { domain: 'services.nvd.nist.gov', desc: 'The National Vulnerability Database CVE API from NIST.' },
  'state-travel': { domain: 'travel.state.gov', desc: 'Travel advisories feed from the U.S. State Department.' },
  gdelt: { domain: 'api.gdeltproject.org', desc: 'Global news monitoring from the GDELT Project.' },
  celestrak: { domain: 'celestrak.org', desc: 'NORAD satellite element sets from CelesTrak.' },
  acled: { domain: 'api.acleddata.com', desc: 'Armed conflict and protest event data from ACLED.' },
  'sec-edgar': { domain: 'data.sec.gov', desc: 'Company filings from the SEC EDGAR system.' },
  quiver: { domain: 'api.quiverquant.com', desc: 'Congressional stock trading data from Quiver Quantitative.' },
};

const CATEGORIES = {
  congressional: '🏛️ Congressional',
  federal: '📊 Federal',
  natsec: '🛡️ National Security',
  financial: '💰 Financial',
};

const STATUS = {
  healthy: { label: 'Operational', cls: 'ok', icon: '●' },
  degraded: { label: 'Degraded', cls: 'warn', icon: '◐' },
  unhealthy: { label: 'Down', cls: 'crit', icon: '✕' },
  'rate-limited': { label: 'Rate limited', cls: 'rl', icon: '◔' },
  skipped: { label: 'Not monitored', cls: 'skip', icon: '○' },
};

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nf = new Intl.NumberFormat('en-US');

// ── Load data ──────────────────────────────────────────────────────
const latest = JSON.parse(readFileSync(join(root, 'data', 'latest.json'), 'utf8'));

const histDir = join(root, 'data', 'history');
let records = [];
if (existsSync(histDir)) {
  const files = readdirSync(histDir).filter((f) => f.endsWith('.ndjson')).sort().slice(-2);
  for (const f of files) {
    for (const line of readFileSync(join(histDir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line)); } catch { /* skip corrupt line */ }
    }
  }
}
const cutoff30 = Date.now() - 30 * 86_400_000;
records = records.filter((rec) => Date.parse(rec.t) >= cutoff30);
const cutoff24h = Date.now() - 86_400_000;

// ── Aggregate per service ──────────────────────────────────────────
const services = latest.results.map((r) => {
  const runs = records
    .map((rec) => ({ t: rec.t, e: rec.r.find((x) => x.s === r.service) }))
    .filter((x) => x.e);
  const counted = runs.filter((x) => ['healthy', 'degraded', 'unhealthy'].includes(x.e.st));
  const up = counted.filter((x) => x.e.st !== 'unhealthy');
  // A tiny sample renders misleading extremes (one bad check = "0%"), so
  // uptime stays "—" until half a day of history exists.
  const uptime = counted.length >= 10 ? (100 * up.length) / counted.length : null;
  const recent = runs.filter((x) => Date.parse(x.t) >= cutoff24h && x.e.ms != null && x.e.st !== 'skipped');
  const avgMs = recent.length ? Math.round(recent.reduce((a, x) => a + x.e.ms, 0) / recent.length) : null;
  const ticks = runs.slice(-TICKS);
  return { ...r, uptime, avgMs, ticks };
});

const monitored = services.filter((s) => s.status !== 'skipped');
const nDown = monitored.filter((s) => s.status === 'unhealthy').length;
const nIssue = monitored.filter((s) => ['degraded', 'rate-limited'].includes(s.status)).length;
const banner =
  nDown > 0
    ? { cls: 'crit', text: `${nDown} of ${monitored.length} monitored services ${nDown === 1 ? 'is' : 'are'} down` }
    : nIssue > 0
      ? { cls: 'warn', text: `Minor issues on ${nIssue} of ${monitored.length} monitored services` }
      : { cls: 'ok', text: 'All systems operational' };

// ── Render ─────────────────────────────────────────────────────────
const tickStrip = (s) => {
  if (s.ticks.length === 0) return '<span class="nodata">collecting history…</span>';
  const cells = s.ticks
    .map(({ t, e }) => {
      const st = STATUS[e.st] ?? STATUS.skipped;
      const when = t.replace('T', ' ').slice(0, 16) + ' UTC';
      const ms = e.ms == null ? '' : ` · ${nf.format(e.ms)} ms`;
      return `<i class="t ${st.cls}" title="${esc(`${when} — ${st.label}${ms}`)}"></i>`;
    })
    .join('');
  return `<span class="strip" role="img" aria-label="Last ${s.ticks.length} checks for ${esc(s.label)}">${cells}</span>`;
};

const serviceRow = (s) => {
  const st = STATUS[s.status] ?? STATUS.skipped;
  const meta = META[s.service] ?? { domain: '', desc: '' };
  const uptime = s.uptime == null ? '—' : `${s.uptime.toFixed(s.uptime === 100 ? 0 : 1)}%`;
  const ms = s.status === 'skipped' ? '—' : s.avgMs != null ? `${nf.format(s.avgMs)} ms` : s.responseTime != null ? `${nf.format(s.responseTime)} ms` : '—';
  const keyHint = (s.skipReason ?? '').replace(/^no API key — set /, '') || 'an API key';
  const detail =
    s.status === 'skipped'
      ? `Monitoring requires ${esc(keyHint)} — add it as a repository secret.`
      : esc(`${meta.desc} (${meta.domain})`);
  return `
    <article class="svc" id="${esc(s.service)}">
      <div class="row">
        <span class="dot ${st.cls}" aria-hidden="true">${st.icon}</span>
        <h3><a href="#${esc(s.service)}">${esc(s.label)}</a></h3>
        <span class="state ${st.cls}">${st.label}</span>
        <span class="num" title="30-day uptime (rate-limited and unmonitored checks excluded)">${uptime}</span>
        <span class="num" title="average response time, last 24h">${ms}</span>
      </div>
      <p class="desc">${detail}</p>
      ${tickStrip(s)}
    </article>`;
};

const sections = Object.entries(CATEGORIES)
  .map(([cat, title]) => {
    const rows = services.filter((s) => s.category === cat).map(serviceRow).join('\n');
    return rows ? `<section><h2>${title}</h2>\n${rows}\n</section>` : '';
  })
  .join('\n');

const updated = latest.updatedAt.replace('T', ' ').slice(0, 16) + ' UTC';

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Government API Status — is Congress.gov down? FEC, CISA KEV, NVD uptime | govwatch</title>
<meta name="description" content="Live status and 30-day uptime for 17 government APIs — Congress.gov, FEC OpenFEC, CISA KEV, NVD, Federal Register, USAspending, GDELT and more. Checked every 30 minutes by govwatch.">
<link rel="canonical" href="${SITE_URL}">
<meta property="og:title" content="Government API Status — govwatch">
<meta property="og:description" content="Live health and uptime history for Congress.gov, FEC, CISA KEV, NVD, and 13 more government APIs.">
<meta property="og:url" content="${SITE_URL}">
<meta property="og:type" content="website">
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Government API Status by govwatch',
  url: SITE_URL,
  description: 'Live status and uptime history for U.S. government APIs, checked every 30 minutes.',
  publisher: { '@type': 'Organization', name: 'Capitol Trace', url: 'https://capitoltrace.com' },
})}</script>
<style>
:root{--bg:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--line:#e1e0d9;
--ok:#0ca30c;--warn:#fab219;--rl:#ec835a;--crit:#d03b3b}
@media (prefers-color-scheme: dark){:root{--bg:#0d0d0d;--surface:#1a1a19;--ink:#fff;--ink2:#c3c2b7;--line:#2c2c2a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:880px;margin:0 auto;padding:24px 16px 48px}
header h1{font-size:1.5rem;margin:8px 0 2px}
header p{color:var(--ink2);margin:0 0 16px}
.banner{border:1px solid var(--line);border-left:4px solid var(--muted);background:var(--surface);
border-radius:8px;padding:12px 16px;font-weight:600;margin:0 0 8px}
.banner.ok{border-left-color:var(--ok)}.banner.warn{border-left-color:var(--warn)}.banner.crit{border-left-color:var(--crit)}
.updated{color:var(--muted);font-size:.85rem;margin:0 0 24px}
section h2{font-size:1.05rem;margin:28px 0 8px}
.svc{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:12px 16px;margin:0 0 10px}
.row{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.row h3{font-size:1rem;margin:0;flex:1 1 auto}
.row h3 a{color:inherit;text-decoration:none}
.row h3 a:hover{text-decoration:underline}
.dot{font-size:.9rem}.dot.ok{color:var(--ok)}.dot.warn{color:var(--warn)}.dot.rl{color:var(--rl)}.dot.crit{color:var(--crit)}.dot.skip{color:var(--muted)}
.state{font-size:.85rem;font-weight:600}
.state.ok{color:var(--ok)}.state.crit{color:var(--crit)}
.state.warn,.state.rl{color:var(--ink2)}.state.skip{color:var(--muted)}
.num{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.85rem;color:var(--ink2);min-width:70px;text-align:right}
.desc{color:var(--muted);font-size:.85rem;margin:6px 0 8px}
.strip{display:inline-flex;gap:2px}
.t{width:5px;height:16px;border-radius:2px;background:var(--muted);display:inline-block}
.t.ok{background:var(--ok)}.t.warn{background:var(--warn)}.t.rl{background:var(--rl)}.t.crit{background:var(--crit)}.t.skip{background:var(--line)}
.nodata{color:var(--muted);font-size:.8rem}
.about{color:var(--ink2);font-size:.9rem;border-top:1px solid var(--line);margin-top:32px;padding-top:16px}
.about h2{font-size:1.05rem}
a{color:inherit}
footer{color:var(--muted);font-size:.85rem;margin-top:24px}
</style>
</head>
<body>
<main>
<header>
  <h1>🔍 Government API Status</h1>
  <p>Live health of ${monitored.length} U.S. government APIs, checked every 30 minutes.</p>
</header>
<div class="banner ${banner.cls}">${banner.text}</div>
<p class="updated">Last checked ${updated} · <a href="./status.json">status.json</a> · <a href="./history-30d.json">30-day aggregates</a></p>
${sections}
<div class="about">
  <h2>About this page</h2>
  <p>Is Congress.gov down? Is the FEC API responding? Are CISA feeds current? This page answers those
  questions with real checks, not guesses. Every 30 minutes, <a href="https://github.com/CapitolTrace/govwatch">govwatch</a>
  requests each API and validates the status code, response time, and payload — catching the classic
  government-API failure mode of HTTP&nbsp;200 with an empty or HTML error body.</p>
  <p><strong>Methodology:</strong> a service is <em>Operational</em> when all assertions pass, <em>Degraded</em> when it
  responds correctly but slowly, and <em>Down</em> when it returns errors or invalid data. <em>Rate limited</em> (HTTP&nbsp;429)
  is reported separately and excluded from uptime, since it can reflect shared-runner limits rather than an outage.
  Uptime is computed over 30 days of checks.</p>
  <p>Run these checks yourself: <code>npx @capitoltrace/govwatch check</code> — or add the
  <a href="https://github.com/CapitolTrace/govwatch-action">GitHub Action</a> to your CI.
  History lives in <a href="https://github.com/CapitolTrace/govwatch-status">this repo</a>.</p>
</div>
<footer>A <a href="https://capitoltrace.com">Capitol Trace</a> project · MIT · Because democracy runs on uptime.</footer>
</main>
</body>
</html>
`;

// ── Write site ─────────────────────────────────────────────────────
const site = join(root, 'site');
mkdirSync(site, { recursive: true });
writeFileSync(join(site, 'index.html'), html);
copyFileSync(join(root, 'data', 'latest.json'), join(site, 'status.json'));
writeFileSync(
  join(site, 'history-30d.json'),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      windowDays: 30,
      services: services.map((s) => ({
        service: s.service,
        label: s.label,
        status: s.status,
        uptimePct: s.uptime == null ? null : Number(s.uptime.toFixed(2)),
        avgResponseMs24h: s.avgMs,
        checks: s.ticks.length,
      })),
    },
    null,
    2,
  )}\n`,
);
console.log(`generate: site built (${services.length} services, ${records.length} history records)`);
