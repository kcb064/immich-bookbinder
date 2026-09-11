# Connecting to Immich

immich-bookbinder talks to your Immich server with an API key. It only reads: it never uploads, edits, tags or deletes anything in Immich.

## Version

The client is generated from the Immich OpenAPI spec vendored at `specs/immich-openapi.json`, currently **Immich 3.2.0** (`SUPPORTED_IMMICH_VERSION` in `packages/shared/src/api.ts`). Other 3.x servers usually work; the connection test shows your server's version next to the supported one and warns when they differ. A weekly CI job opens an issue when upstream Immich changes the spec.

## Create the API key

1. In the Immich web app, open your avatar -> **Account Settings** -> **API Keys**.
2. Click **New API Key** and name it `bookbinder`.
3. Select the permissions below (Immich lets you pick individual scopes; do not grant everything). Save and copy the key: Immich shows it only once.
4. In immich-bookbinder, open **Settings -> Immich**, enter the server URL (without `/api`) and the key, and press **Test connection**. Each permission is probed against a real endpoint and reported as ok or missing.

## Required permissions

Exactly the list in `REQUIRED_IMMICH_PERMISSIONS` (`packages/shared/src/api.ts`):

| Permission | Why |
|---|---|
| `server.about` | `GET /server/about` for the version and compatibility banner. |
| `user.read` | `GET /users/me` to show whose key it is and confirm the key works at all. |
| `asset.read` | Asset metadata and search (`POST /search/metadata`, `POST /search/smart`, `GET /assets/:id`): dates, EXIF, dimensions, people on the asset. |
| `asset.view` | Thumbnails and previews (`GET /assets/:id/thumbnail`) for scoring, the editor and the viewer's image proxy. |
| `asset.download` | Full-resolution originals (`GET /assets/:id/original`), fetched only at render time into a bounded cache. |
| `asset.statistics` | `GET /assets/statistics` for the photo count on the settings page and dashboard. |
| `album.read` | Album list and contents (`GET /albums`, `GET /albums/:id`) as a book source. |
| `person.read` | Named people and their thumbnails (`GET /people`) for the person picker and "featured people" boosts. |
| `face.read` | Face bounding boxes (`GET /faces?id=`) for face-aware crops and face-quality scores on shortlisted photos. |
| `duplicate.read` | Immich's duplicate groups (`GET /duplicates`) so bursts collapse before our own perceptual-hash pass. |
| `tag.read` | Tags as a filter and in the smart-search wizard. |
| `timeline.read` | `GET /timeline/buckets` and `GET /timeline/bucket` with a bounding box: the efficient server-side query for "this date range in this area". |
| `map.read` | `GET /map/markers` for trip detection (clustering photo locations within a date range). |

Nothing with `write`, `update`, `delete`, `upload` or `share` is needed.

## Server URL and network

The app runs in its own container and needs a URL that resolves from inside that container, not from your laptop.

- **Same Docker network (recommended).** `docker/compose.yaml` joins the external network `immich_default`. Inside it, Immich's server container is reachable by its service name and internal port, normally `http://immich_server:2283`. Find the network name with `docker network ls` (it is `<stack or project name>_default`; the upstream compose file gives `immich-app_default`) and the container name with `docker ps` (usually `immich_server`). Edit `name:` under `networks:` in the compose file if yours differs.
- **Host address.** Remove the `networks:` blocks from the compose file and use the NAS's LAN IP with Immich's published port, for example `http://192.168.1.10:2283`. Do not use `localhost`: inside the container that means the container itself.
- **Reverse-proxied URL.** `https://photos.example.com` also works if the container can resolve and reach it, but it sends every thumbnail through your proxy or tunnel for no benefit.

The key is stored encrypted with `SECRET_KEY` in the SQLite database under `/data`. Revoke it in Immich if you ever suspect the database or `.env` leaked.
