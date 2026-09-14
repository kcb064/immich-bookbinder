# Deploying with Dockge

Target setup: a NAS or home server running Docker with [Dockge](https://github.com/louislam/dockge), Immich already running as another stack, and optionally a Cloudflare Tunnel for access from outside the LAN.

## 1. Create the stack

1. Dockge -> **+ Compose** -> stack name `immich-bookbinder`.
2. Replace the editor contents with [`docker/compose.yaml`](../docker/compose.yaml).
3. Open the **.env** panel and paste [`docker/.env.example`](../docker/.env.example). Fill in:
   - `SECRET_KEY`: run `openssl rand -hex 32` anywhere and paste the result. Back it up together with the data; without it the stored Immich and Lulu credentials cannot be decrypted.
   - `ADMIN_PASSWORD` (or `ADMIN_PASSWORD_HASH`; see the comments in the example file).
   - `PUBLIC_URL`: the HTTPS URL you will use from outside, e.g. `https://books.example.com`. Share links are built on it (the Settings page can override it) and Lulu downloads print files from `PUBLIC_URL/public/exports/...`, so ordering requires it. Leave it empty until the tunnel exists; share links then use whatever host you typed in the browser (the Share card warns about this), and the order page lists the missing URL as a blocker.
   - `TZ`.
4. Check the Immich network name with `docker network ls` on the NAS. If it is not `immich_default`, change `name:` at the bottom of the compose file. Alternatively delete both `networks:` blocks and point the app at `http://<NAS-IP>:2283` later.
5. **Deploy**. The first pull is a few hundred megabytes (Node, Chromium headless shell and its libraries). The container turns healthy once `/api/health` answers.

Dockge keeps the stack in `/opt/stacks/immich-bookbinder/` (or your configured stacks directory), so the bind mount `./data` is `/opt/stacks/immich-bookbinder/data` on the host.

## 2. First login and Immich connection

Open `http://<nas>:3080`, log in with the admin password, go to **Settings -> Immich**, and follow [immich-setup.md](immich-setup.md) to create an API key with the required permissions. **Test connection** must show the server version, your user, and every permission as ok.

## 3. Cloudflare Tunnel

The app is meant to sit behind `cloudflared` so that share links and Lulu's PDF downloads work without opening ports on your router.

1. Zero Trust -> Networks -> Tunnels -> your tunnel -> **Public Hostname** -> add `books.example.com`.
2. Service: `http://immich-bookbinder:3080` if the `cloudflared` container shares a Docker network with this stack (attach it to `immich-bookbinder_default`, or add this service to the tunnel's network); otherwise `http://<NAS-IP>:3080`.
3. Set `PUBLIC_URL=https://books.example.com` in the stack's `.env` and redeploy.
4. From a phone on mobile data, confirm `https://books.example.com/api/health` returns JSON.

### Cloudflare Access (optional)

Putting the admin UI behind Access adds an identity login in front of the app's own password. If you do that:

- Create the Access application for `books.example.com`, **but exclude the public paths**: add bypass rules (or separate applications with an "Everyone -> Bypass" policy) for `books.example.com/s/*` (shared viewer: the page, `book.json`, page PNGs, the PDF and the password unlock all live under the token) and `books.example.com/public/*` (PDFs that Lulu downloads). Without this, people who receive a share link get a Cloudflare login page, and Lulu's download fails. The app rate-limits `/s/*` itself (60 requests per minute per IP, 10 unlock attempts) and share tokens are 32 random bytes, so bypassing Access there exposes nothing guessable.
- Add a **WAF skip rule** for `/public/exports/*`. Lulu fetches large PDFs from a data-centre IP with a non-browser client, which managed rules and Bot Fight Mode may block. Expression: `(http.host eq "books.example.com" and starts_with(http.request.uri.path, "/public/exports/"))`, action Skip: all remaining custom rules, managed rules, and Bot Fight Mode / Super Bot Fight Mode. The export URLs contain a 64-character random token and expire, so skipping the WAF here does not expose anything guessable.
- Optionally set `TRUST_CF_ACCESS=true` so an Access-authenticated user is treated as the admin without the app password. Only do this when the container is **unreachable except through the tunnel** (no `ports:` published on a routable interface, or firewall rules), because the `Cf-Access-Authenticated-User-Email` header is trivial to forge on a direct connection.
- Large PDFs: a 100-page book can be 200-300 MB. Cloudflare proxies responses of that size, but if Lulu reports a download failure use **Settings -> Public URL -> Check reachability** (it publishes a throwaway PDF and fetches it through `PUBLIC_URL` from the server itself, reporting an Access login page or WAF challenge as "HTML instead of a PDF") and, failing that, upload the exported PDFs on lulu.com by hand. Run the check after every change to Access or WAF rules.

## 4. Backups

Everything the app owns is in the `/data` volume (`./data` on the host):

| Path | Contents | Back up? |
|---|---|---|
| `data/bookbinder.sqlite` (+ `-wal`, `-shm`) | Books, pages, selections, settings (credentials encrypted with `SECRET_KEY`), order history | yes |
| `data/exports/<book>/` | Per-render PDFs (proof, print, cover) and page PNG previews (one folder per preview render); served to you, to share links and to Lulu | yes, or regenerate |
| `data/cache/` | Thumbnails and originals pulled from Immich, resized print images | no; rebuilt on demand |
| `data/models/` | Downloaded ONNX scoring model | no |

Copy the SQLite file with the container stopped, or use `sqlite3 data/bookbinder.sqlite ".backup backup.sqlite"` while it runs. Keep `SECRET_KEY` (from `.env`) with the backup: the database is useless without it. The Immich API key can always be re-created, so losing `.env` alone is recoverable, just tedious.

## 5. Updating

Images are published to `ghcr.io/kcb064/immich-bookbinder`. `latest` follows `main`; version tags (`1.2.3`, `1.2`, `1`) follow releases.

- Dockge: open the stack -> **Update** (pulls and recreates). Database migrations run at startup.
- Compose: `docker compose pull && docker compose up -d`.
- To pin a version, change the `image:` tag in the compose file.

Check the logs after an update with `docker logs -f immich-bookbinder`. Set `LOG_LEVEL=debug` in `.env` when reporting a problem.

## 6. Resource notes

- `mem_limit: 2g` covers one render at a time on a 60-page book. Chromium is started per render and closed afterwards.
- `ipc: host` and `init: true` are not optional: without them Chromium crashes on large full-bleed pages or leaves zombie processes.
- The image runs as uid 1000 (`bookbinder`). If Docker creates `./data` for you it may be root-owned; fix with `sudo chown -R 1000:1000 ./data`.
- Rendering is CPU-only; no GPU is used or needed.
