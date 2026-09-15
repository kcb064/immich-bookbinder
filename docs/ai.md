# Claude features (optional)

Everything here is off until you turn it on in **Settings -> Claude** and paste your own Anthropic
API key. With the switch off the app never contacts Anthropic on its own (the **Test key** button in
Settings is the one request you can still send by hand). With it on, nothing runs by itself:
each feature is a button on the book page that starts one job.

## What is sent, and when

| Job | Sent to the API | Never sent |
|---|---|---|
| Captions & chapter titles | Up to three **thumbnails** per page (Immich `thumbnail` size, re-encoded to at most 320 px on the long edge, JPEG q72), the page number, the capture date, the place name (city, country) from Immich's reverse geocoding, any Immich description on those photos, the book title, and the chapter titles/subtitles/photo counts | Originals, previews, file names, people's names, GPS coordinates |
| Best of burst | The same thumbnails for every frame of a burst of three or more, with the capture time of day | As above |
| Foreword | Text only: title, subtitle, date range, number of photographs, up to twelve place names, chapter titles | Any image |
| Test key | One tiny text request | Anything about your library |

The thumbnail path is `ImageStore.aiThumbnail` in `apps/server/src/render/images.ts`; it is the
only image producer the AI code can reach, so a larger variant cannot leak by accident. The
`fake-claude` test records every image's byte size and the test asserts each is well under 60 KB.

The key is stored AES-256-GCM encrypted in the settings table (like the Immich and Lulu secrets)
and is never returned by the API. The model is selectable (Opus 5 by default; Sonnet 5 and Haiku
4.5 are cheaper) and every job records its input/output tokens, the number of requests and an
estimated cost from Anthropic's list prices. The estimate is informational; the invoice is what
counts.

## What each job changes

- **Captions & chapter titles** writes one caption per page whose template has a caption line
  (`one-up-matted`, `hero-strip`, `contact-sheet`; grids have none by design) and a title for
  every chapter opener, **only where you typed nothing**. A caption or chapter title you typed is
  kept and counted as "skipped". Pages are processed eight at a time and saved after every batch,
  so a failure half-way keeps what was written. Everything lands as slot text, so the editor shows
  it exactly like typed text and re-layout drops it like any other page edit.
- **Best of burst** asks, for every burst of three or more near-duplicates that the engine decided
  on its own (no keep/remove of yours inside it), which frame belongs in the book. When Claude
  disagrees with the engine, the two frames swap places (rank and decision) and both carry an `ai`
  reason on the review page; **Undo Claude's pick** swaps them back. Bursts Claude already judged are
  left alone on the next run. A fresh selection run re-decides bursts from scratch, as it always did.
  Re-lay out the book afterwards so the pages follow the new picks.
- **Foreword** writes a 60-120 word paragraph into the `foreword` slot of the title page. A typed
  foreword is kept unless you confirm the replacement.

One job runs per book at a time; a second request answers 409 until it finishes. Jobs interrupted
by a restart are marked failed.

## Requests

The server uses the official `@anthropic-ai/sdk` with structured outputs (`output_config.format`)
so answers are validated JSON, adaptive thinking at low effort, a two-minute timeout and two
retries. Errors are reported on the job (401 = bad key, 429 = rate limited, 529 = overloaded).

For development without a key, `apps/server/src/test/fake-claude.ts` answers `POST /v1/messages`
deterministically; point the server at it with `AI_BASE_URL=http://127.0.0.1:2490` and use any key
except `bad-key`.
