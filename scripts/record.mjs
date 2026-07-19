#!/usr/bin/env node
// Appends one govwatch run to the committed history and refreshes latest.json.
// Usage: node scripts/record.mjs <raw-results.json>
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [, , rawPath] = process.argv;
if (!rawPath) {
  console.error('usage: node scripts/record.mjs <raw-results.json>');
  process.exit(1);
}

let results;
try {
  results = JSON.parse(readFileSync(rawPath, 'utf8'));
  if (!Array.isArray(results) || results.length === 0) throw new Error('empty');
} catch {
  // A missing/invalid file means the checker itself broke (npx failure, bad
  // JSON) — fail the workflow rather than recording garbage.
  console.error('record: raw results are not a non-empty JSON array — refusing to record');
  process.exit(1);
}

const t = new Date().toISOString();
// Compact per-run line: keeps a month of 30-minute checks ~1 MB.
const line = JSON.stringify({
  t,
  r: results.map((r) => ({
    s: r.service,
    st: r.status,
    c: r.statusCode,
    ms: r.responseTime,
  })),
});

const histDir = join(root, 'data', 'history');
mkdirSync(histDir, { recursive: true });
appendFileSync(join(histDir, `${t.slice(0, 7)}.ndjson`), `${line}\n`);
writeFileSync(
  join(root, 'data', 'latest.json'),
  `${JSON.stringify({ updatedAt: t, results }, null, 2)}\n`,
);
console.log(`record: ${results.length} services at ${t}`);
