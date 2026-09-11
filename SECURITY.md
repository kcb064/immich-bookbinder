# Security

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private reporting: **Security -> Report a vulnerability** on https://github.com/kcb064/immich-bookbinder, which creates a private advisory visible only to the maintainer. If that is unavailable, open an issue that says only "security, please contact me" and the maintainer will reach out.

Include the version or image digest, steps to reproduce, and what an attacker gains. You should get an acknowledgement within a week. Fixes ship as a new image on `ghcr.io/kcb064/immich-bookbinder`, and the advisory is published once the fix is out.

## Scope

In scope: anything in this repository and the published container image, in particular

- the admin session and password handling,
- the public share routes (`/s/*`) and export routes (`/public/*`), including token guessing, expiry and path traversal,
- leakage of Immich URLs, API keys or Lulu credentials (stored encrypted with `SECRET_KEY` under `/data`),
- the Immich and Lulu clients (SSRF through user-supplied URLs, response handling),
- the Chromium renderer (content that escapes the print routes or reads local files).

Out of scope: vulnerabilities in Immich, Lulu, Cloudflare or Docker themselves (report those upstream), and deployments that ignore the documented requirements, such as enabling `TRUST_CF_ACCESS` on a container reachable without Cloudflare Access.

## Supported versions

Only the latest release (and `main`) receives fixes. Update with `docker compose pull && docker compose up -d`.
