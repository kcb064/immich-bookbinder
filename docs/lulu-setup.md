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
4. In immich-bookbinder: **Settings -> Lulu printing**. The **Sandbox** switch picks the active environment; the key and secret fields below it edit that environment's pair, so you can keep a sandbox pair and a production pair side by side. Both are stored encrypted with `SECRET_KEY` (`lulu.sandbox.*` and `lulu.production.*` in the settings table).
5. **Test credentials** requests a token and lists print jobs (`GET /print-jobs/?page_size=1`). A wrong pair shows Lulu's own message (`Invalid client or Invalid client credentials`); a good one shows the environment, the API base and how many print jobs the account has. Every order records which environment it was placed in.

Authentication is OAuth2 client credentials against `/auth/realms/glasstree/protocol/openid-connect/token` (`Authorization: Basic base64(key:secret)`, `grant_type=client_credentials`). The app caches the token until a minute before Lulu's `expires_in` and, if a call still answers 401, fetches a fresh token and retries that call once.

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

Open a laid-out book and choose **Order printed copies** (the book page's *Order from Lulu* card, `/books/<id>/order`). The page refuses to start until the blockers it lists are cleared: Lulu credentials for the active environment, a public URL, a clean preflight (no errors), and print and cover PDFs newer than the book's last change (the cover also sized for the current page count).

1. **Product.** Binding, paper, finish and quality build the `pod_package_id` shown next to the heading. Saving a change stales the renders: the spine width and the price depend on it, so render the print and cover PDFs again.
2. **Cover dimensions.** Every cover render with Lulu connected calls `POST /cover-dimensions/` with the `pod_package_id`, the interior page count and `unit: 'pt'`; the sheet is drawn at exactly that size (`source: 'lulu'` in the render's data, "spine ... · Lulu" on the cover card). Without credentials the caliper estimate is used and the render carries the warning *Spine width estimated; connect Lulu for exact dimensions*.
3. **Validate and quote.** You enter the address (the last one is remembered), copies and a shipping level. The app publishes the two PDFs at `PUBLIC_URL/public/exports/<token>.pdf` (a fresh 64-character token per file and order, valid 7 days, MD5 recorded), then runs `POST /validate-interior/` and `POST /validate-cover/`, polling every 3 s for up to 5 minutes. Lulu downloads the files itself. Errors are shown verbatim and the order ends as **Rejected**. When both pass, `POST /shipping-options/` prices the carriers for that country and `POST /print-job-cost-calculations/` returns the cost table (per copy, shipping, tax, total in Lulu's currency) -> **Quoted**. Nothing is ordered yet; a quote you do not want can be canceled or simply left.
4. **Place order.** `POST /print-jobs/` with the contact email, shipping level, address, `external_id = <bookId>:<orderId>` and one line item per book (`printable_normalization` with both source URLs and MD5s, the book title, the quantity; line item external ids `<externalId>:1`, `:2`, ...). The book's status becomes **Ordered** and the print job id is shown. **More books in the same parcel** (M7): the order form lists your other laid-out Lulu books; each one you tick must pass the same checks (clean preflight, current print and cover PDFs), gets its own export URLs and validations, and appears as its own line item in the quote and the job.
5. **Track.** **Refresh status** (and a background check every 10 minutes while the server runs), or Lulu's own push when a webhook is subscribed (below), reads `GET /print-jobs/{id}/status/` and maps Lulu's status: `CREATED` -> Submitted, `UNPAID` / `PAYMENT_IN_PROGRESS` -> Awaiting payment, `PRODUCTION_DELAYED` / `PRODUCTION_READY` / `IN_PRODUCTION` -> In production, `SHIPPED` -> Shipped (with the carrier's tracking links), plus `REJECTED`, `ERROR` and `CANCELED`. The timeline on the order card and the message log record every step; **Orders** in the sidebar lists every order across books.

**Payment happens on lulu.com.** A new print job sits in `UNPAID` until you pay it in your Lulu account (or a card on file auto-charges, if you enabled that with Lulu). The app never sees or stores card data; **Pay on lulu.com** opens the developer portal's print-jobs page (`developers.lulu.com/print-jobs`, or the sandbox portal), where the job id from the order card identifies it. In the sandbox, jobs are paid with the test balance.

**Cancelling.** A quote that never became a print job is canceled locally. An unpaid print job is canceled through Lulu (`PUT /print-jobs/{id}/status/` with `CANCELED`); if Lulu refuses, the order is marked canceled in the app and the message tells you to cancel it on lulu.com as well. Once a job is in production it can no longer be canceled from here.

**Webhooks (M7).** **Settings -> Lulu -> Status webhook -> Subscribe** calls `POST /webhooks/` with `PRINT_JOB_STATUS_CHANGED` and `PUBLIC_URL/public/lulu/webhook` (one subscription per environment, re-used when Lulu already has one for that URL). Lulu then POSTs the print job on every status change; the server checks the `Lulu-HMAC-SHA256` header (HMAC-SHA256 of the raw body with the API secret, hex or base64, either environment's secret) and updates the matching order, tracking links included. *Send a test* asks Lulu for a dummy submission; it shows in the server log as "webhook for an unknown job". Lulu deactivates a webhook after five failed deliveries in a row; the block in Settings says so, and unsubscribe/subscribe re-enables it. Polling stays on as a fallback. Exclude `/public/lulu/webhook` from Cloudflare Access like the other public paths.

**Print jobs placed elsewhere (M7).** The Orders page lists the jobs on the Lulu account that no local order tracks (placed on lulu.com, by another tool, or lost with a database) and imports one as a local order with **Track here**: the book comes from the job's external id when this app minted it, else you pick it. Imported orders follow Lulu's status and tracking like any other; they have no exports, validations or quote of their own.

**What the app never does:** handle card or bank details, or ship one job to several addresses (gift copies to several addresses are separate orders).

## Public URL requirement

Lulu fetches the PDFs from the URLs in the print job, so the app must be reachable from the internet over HTTPS with `PUBLIC_URL` set (see [deploy-dockge.md](deploy-dockge.md) for the Cloudflare Tunnel, excluding `/public/*` from Cloudflare Access, and the WAF skip rule). **Settings -> Public URL -> Check reachability** publishes a one-page throwaway PDF and fetches it from the server itself through the public URL, exactly as Lulu will: it reports the HTTP status, latency and content type, and says plainly when an HTML page (a Cloudflare Access login, a WAF challenge) or a redirect came back instead of the PDF. If your setup cannot expose the app, export the PDFs and upload them in Lulu's own publishing flow instead; the product code above tells Lulu's wizard which book you built.

## Developing without a Lulu account

`apps/server/src/test/fake-lulu.ts` is a stand-in for every endpoint the app calls (token, cover dimensions, validations that really download the export URLs and check MD5s, shipping options, cost calculation, print jobs whose status advances one step per poll up to `SHIPPED` with a tracking link, cancellation). Run it with `corepack pnpm --filter @bookbinder/server exec tsx src/test/fake-lulu.ts --port 2390`, start the server with `LULU_BASE_URL=http://127.0.0.1:2390` (development only: it points both environments at the fake) and enter `fake-key` / `fake-secret` in Settings. The server tests in `apps/server/src/lulu/lulu.test.ts` run the whole flow against it.
