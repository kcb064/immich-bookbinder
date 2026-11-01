// Static egress check: every host the server code can talk to must be one of the documented ones.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const roots = ['apps/server/src'];
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== 'generated') walk(p); } else if (p.endsWith('.ts')) files.push(p); } };
roots.forEach(walk);
const allowed = new Set([
  'api.lulu.com', 'api.sandbox.lulu.com', 'developers.lulu.com', 'developers.sandbox.lulu.com',
  'fonts.googleapis.com', 'fonts.gstatic.com', 'ntfy.sh',
  'render.bookbinder.local', // intercepted by Playwright, never leaves the machine
  'www.w3.org', // SVG xmlns, never fetched
  // examples/comments/tests and user-configured URLs below are not hard-coded destinations:
  'nas', 'immich', 'books.example.com', 'example.com', 'nowhere', '127.0.0.1', 'team.cloudflareaccess.com', 'immich_server',
]);
const hosts = new Map();
for (const f of files) {
  const t = readFileSync(f, 'utf8');
  for (const m of t.matchAll(/https?:\/\/([a-zA-Z0-9.-]+)/g)) {
    const h = m[1];
    if (!allowed.has(h)) hosts.set(h, (hosts.get(h) ?? new Set()).add(f));
  }
}
let bad = false;
for (const [h, fs] of hosts) { console.log('UNDOCUMENTED HOST:', h, [...fs].slice(0,3)); bad = true; }
console.log(bad ? 'FAIL' : 'OK: all hard-coded hosts are documented in docs/privacy.md');
process.exit(bad ? 1 : 0);
