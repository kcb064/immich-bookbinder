# Lulu setup

Ordering is optional. Without Lulu credentials the app still exports print-ready PDFs you can upload to any printer, including lulu.com by hand.

## Accounts

Lulu runs two separate API environments, each with its own account, API keys and (for the sandbox) fake payment:

| | Sandbox | Production |
|---|---|---|
| Developer portal | https://developers.sandbox.lulu.com | https://developers.lulu.com |
| API base | `https://api.sandbox.lulu.com` | `https://api.lulu.com` |
| Print jobs | Validated and priced, never printed or charged | Real books, real money |

Sign up for both. Use the sandbox until a whole order flow (quote -> validate -> create -> status) works with a real rendered PDF, then add production keys.

## API keys

1. Log in to the developer portal (sandbox or production).
2. Open your profile -> **API Keys** (`/user-profile/api-keys`).
3. Copy the **client key** and **client secret**. Lulu also shows a ready-made `Authorization: Basic ...` value; the app builds that itself from key and secret.
4. In immich-bookbinder: **Settings -> Lulu**, paste the pair into the sandbox or production slots, and use the **Sandbox** switch to choose which one is active. Both pairs are stored encrypted with `SECRET_KEY`.

Authentication is OAuth2 client credentials against `/auth/realms/glasstree/protocol/openid-connect/token`; tokens last one hour and the app refreshes them.

## Product IDs (`pod_package_id`)

Lulu identifies a product with a dotted code `Trim.Ink.Quality.Binding.Paper.Finish` (the dotted format is current; undotted legacy codes are accepted only until 2027-02-01). The app builds it from the format preset and your choices in the order dialog (`luluPodPackageId` in `packages/shared/src/format.ts`).

Default: **`0850X0850.FC.PRE.CW.080CW444.MXX`**

| Segment | Default | Meaning | Alternatives in the app |
|---|---|---|---|
| Trim | `0850X0850` | 8.5 x 8.5 in | `0750X0750`, `0850X1100`, `1100X0850`, `0900X0700`, `0827X1169` (from the preset) |
| Ink | `FC` | Full colour | fixed |
| Quality | `PRE` | Premium colour (photo quality) | `STD` standard colour |
| Binding | `CW` | Hardcover casewrap | `LW` linen wrap with dust jacket, `PB` perfect bound (paperback), `CO` coil, `SS` saddle stitch |
| Paper | `080CW444` | 80# coated white | `060UW444` 60# uncoated white, `060UC444` 60# uncoated cream |
| Finish | `MXX` | Matte cover | `GXX` gloss |

Constraints the app enforces: casewrap needs 24 to 800 interior pages; perfect-bound on coated paper 20+; page count always even. Price is fetched live from `/print-job-cost-calculations/` (casewrap premium colour is roughly $11 plus about $0.21 per page before shipping; the app never hardcodes it).

## The order flow

1. **Cover dimensions.** `POST /cover-dimensions/` with the `pod_package_id` and interior page count returns the exact spread size; the cover is rendered to it.
2. **Render** interior and cover PDFs (see [print-specs.md](print-specs.md)).
3. **Publish** both PDFs at `PUBLIC_URL/public/exports/<token>.pdf` with an expiry; the MD5 of each file is recorded.
4. **Validate.** `POST /validate-interior/` and `POST /validate-cover/` with the URLs; both are asynchronous and polled until validated, or until Lulu returns an error, which the app shows verbatim.
5. **Quote.** You enter a shipping address; `POST /shipping-options/` lists carriers and `POST /print-job-cost-calculations/` returns line-item, shipping and tax costs. Nothing is ordered yet.
6. **Create.** On confirmation, `POST /print-jobs/` with contact email, shipping level, address, and the two PDF URLs plus MD5s. Lulu downloads the files itself.
7. **Track.** The app polls `GET /print-jobs/{id}/status/` and shows `CREATED -> UNPAID -> PAYMENT_IN_PROGRESS -> PRODUCTION_READY -> IN_PRODUCTION -> SHIPPED` (or `REJECTED`, `ERROR`, `CANCELED`) with tracking URLs once shipped.

**Payment happens on lulu.com.** A new print job sits in `UNPAID` until you pay it in your Lulu account (or a card on file auto-charges, if you enabled that with Lulu). The app never sees or stores card data; it links you to the job on lulu.com. In the sandbox, jobs are paid with the test balance.

## Public URL requirement

Lulu fetches the PDFs from the URLs in the print job, so the app must be reachable from the internet over HTTPS with `PUBLIC_URL` set (see [deploy-dockge.md](deploy-dockge.md) for the Cloudflare Tunnel, excluding `/public/*` from Cloudflare Access, and the WAF skip rule). The order dialog has a **Check reachability** button that fetches the export URL from outside through `PUBLIC_URL` before you submit. If your setup cannot expose the app, export the PDFs and upload them in Lulu's own publishing flow instead; the product code above tells Lulu's wizard which book you built.
