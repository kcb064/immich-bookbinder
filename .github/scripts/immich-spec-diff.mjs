// Used by .github/workflows/immich-spec-drift.yml.
// usage: node immich-spec-diff.mjs <local-spec.json> <upstream-spec.json> <issue-body.md>
// stdout: GitHub Actions step outputs (drift=, local=, remote=).
import { readFileSync, writeFileSync } from 'node:fs';

const [localPath, remotePath, bodyPath] = process.argv.slice(2);
if (!localPath || !remotePath || !bodyPath) {
  console.error('usage: immich-spec-diff.mjs <local.json> <upstream.json> <body.md>');
  process.exit(2);
}

const local = JSON.parse(readFileSync(localPath, 'utf8'));
const remote = JSON.parse(readFileSync(remotePath, 'utf8'));

const localVersion = local.info.version;
const remoteVersion = remote.info.version;
const localPaths = new Set(Object.keys(local.paths ?? {}));
const remotePaths = new Set(Object.keys(remote.paths ?? {}));
const added = [...remotePaths].filter((p) => !localPaths.has(p)).sort();
const removed = [...localPaths].filter((p) => !remotePaths.has(p)).sort();
const drift = localVersion !== remoteVersion;

const list = (items) => (items.length ? items.map((p) => `- \`${p}\``) : ['- none']);
const body = [
  `Vendored \`specs/immich-openapi.json\` is **${localVersion}**; upstream \`main\` is **${remoteVersion}**.`,
  '',
  `Paths added upstream (${added.length}):`,
  ...list(added),
  '',
  `Paths removed upstream (${removed.length}):`,
  ...list(removed),
  '',
  'To update:',
  '1. Download the upstream spec to `specs/immich-openapi.json`.',
  '2. Run `pnpm generate:immich` and fix type errors in `apps/server/src/immich`.',
  '3. Bump `SUPPORTED_IMMICH_VERSION` in `packages/shared/src/api.ts`.',
  '4. Re-run the connection test against a real Immich of that version.',
  '',
  `_Maintained by the immich-spec-drift workflow; last run ${new Date().toISOString().slice(0, 10)}._`,
].join('\n');

writeFileSync(bodyPath, body + '\n');
process.stdout.write(`drift=${drift}\nlocal=${localVersion}\nremote=${remoteVersion}\n`);
