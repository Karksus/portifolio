# Hardening Review — "Break Your Own Site"

**Site:** https://pedro-serio.netlify.app
**Date:** 2026-10-07 · **Deploy re-verified:** 2026-10-08
**Reviewer:** Pedro (self) · test harness run by the agent
**Status:** fix-nows applied and **deployed live** (re-verified 2026-10-08); awaiting Checkpoint 2 review

---

## 1. How I tried to break it (method + evidence)

| Test | Method | Raw evidence |
|---|---|---|
| Submit empty | Bypassed the browser and POSTed `form-name=contact` with no fields (`curl`) | HTTP 200, returned the "Message sent" page |
| Submit garbage | POST with bad email, `<script>`-laden name, empty message | HTTP 200, thanks page returned |
| Honeypot filled | POST with `bot-field` filled | 200; Netlify drops honeypot submissions from the spam folder |
| Submit twice fast | Two identical POSTs back to back | Both HTTP 200, no dedup |
| Fast double-click (in-browser) | Injected probe clicks the submit button twice | pre-fix: 2 submit events; post-fix: 1 |
| Whitespace-only input | Injected probe: `"   "`, then `"            "` (12 spaces) with and without trim-on-input | pre-fix: valid both ways; post-fix: 3 spaces invalid, 12 spaces invalid after trim (native allows it — see limitation 12) |
| Empty submit (UI) | Injected probe calls `requestSubmit()` | browser blocks; name/email/message flagged |
| Garbage email | Injected probe sets `not-an-email` | blocked with localized message |
| Click everything | curl over every `href`; headless Chrome + iPhone UA | all internal links 200; CV PDF 200; mailto only |
| Unknown URL | `GET /definitely-not-a-page` | pre-fix: 404 (Netlify default page) → post-fix live: HTTP 404 with the custom `404.html` |
| Untested "device" | headless Chromium with iPhone UA + narrow viewport | no horizontal overflow; responsive grid collapses |
| Speed | curl timing + compression + headless FCP | TTFB 36–228 ms; brotli enabled; HTML 10.8 KB |
| Findability | web search for name | LinkedIn first, **portfolio site absent** |

Raw machine-readable evidence (pre-fix vs post-fix) is reproduced in `docs/break-test-evidence.json`.

## Findings and triage

### Fixed now

| # | Finding (where it breaks) | Fix | Evidence it's addressed |
|---|---|---|---|
| 1 | Whitespace-only name/message passed `required`. | `pattern=".*\S.*"` on name; `minlength="10"` plus trim-on-input on message. | Probe: 3 spaces → invalid; 12-space message is natively valid but becomes invalid after trim-on-input; name trimmed `"  Bob  "` → `"Bob"` |
| 2 | No length limits: a 100 000-char message or 5000-char name posted fine. | `maxlength="100"` (name, email 254) and `maxlength="5000"` (message). | `nameMaxlen` -1 → **100**, `msgMaxlen` -1 → **5000** |
| 3 | Leading/trailing whitespace saved to submissions | Inline trim on `input` | trimmed `"  Bob  "` → `"Bob"` |
| 12 | 1-character name and 1-char messages accepted | `minlength="2"` / `minlength="10"` + `title` hints | probe: msgMinlen 10 |
| 4 | No double-submit guard: two fast clicks = two submissions | JS disables button + "Sending…" on submit; `noscript` fallback text | probe: submit events 2 → 1; button disabled |
| 5 | No `robots.txt` / `sitemap.xml` | added both, sitemap lists home + case study | live: `robots.txt` 200 text/plain (135 B), `sitemap.xml` 200 application/xml (451 B) |
| 6 | No custom 404 (Netlify default page) | added `404.html` | live: unknown path → HTTP 404 with custom page (`<title>Page not found — Pedro Serio</title>`) |
| 7 | No canonical / Open Graph / Twitter card → bare link previews | added canonical + full OG + Twitter + `theme-color` to all pages | grep of built HTML; live home carries `og:title` |
| 8 | No structured data for a person | JSON-LD `Person` on home | grep; present in live home |
| 9 | No share image (`og:image` was absent) | generated `share-card.png` 1200×630 | dimensions verified; live 200 image/png (39,642 B) |
| 10 | Thanks page only `noindex` | `noindex, nofollow` | grep |
| 11 | No CSP / frame / permissions headers; predictable caching | CSP, `X-Frame-Options: DENY`, `Permissions-Policy`, 1-week asset cache in `netlify.toml` | live `curl -I` returns the CSP header |

## Known limitations (named, not hidden)

1. **No server-side validation.** Client-side rules are bypassable by any script. A raw `POST` with empty fields still reaches Netlify and returns the thanks page. Proper fix needs a Netlify Function to validate/trim/reject; out of scope for a static deploy. Mitigated by the honeypot and Netlify's spam filtering.
2. **The success page is unconditional.** A visitor (or bot) sees "Message sent" even if Netlify silently dropped the submission as spam. Same root cause as #1.
3. **No server-side deduplication.** The double-submit fix is client-side; two rapid POSTs from a script still create two entries. Requires a Function + idempotency key.
4. **CSP allows `'unsafe-inline'`** for the small inline scripts. Moving scripts to files with hashes/nonces is a future hardening step.
5. **Google Fonts is a third-party, render-blocking dependency.** Self-hosting would improve privacy and maybe performance.
6. **Not indexed yet.** The site is new; the sitemap helps only after Google Search Console submission. No custom domain yet (still a `netlify.app` subdomain). A search for the name surfaces LinkedIn, not the site.
7. **Device matrix not exhaustive.** Tested with headless Chromium (desktop + iPhone UA). Real Safari/Firefox/Android devices were not exercised.
8. **No Lighthouse run this pass.** The PageSpeed Insights API returned HTTP 429 (daily quota exhausted), and the desktop browser tool isn't connected. Speed evidence is proxy-based (TTFB, compression, transfer size, FCP).
9. **No accessibility audit beyond manual checks.** One `<h1>` per page, `alt` text present, focus styles exist, but contrast/screen-reader testing wasn't run.
10. **Images are not WebP/AVIF.** `architecture-diagram.png` is 64 KB and `Pedro_Serio_CV.pdf` is 252 KB; acceptable, not optimal.
11. **No uptime/DDoS monitoring** beyond Netlify defaults.
12. **No-JS whitespace message.** `<textarea>` does not support the `pattern` attribute, so without JavaScript a whitespace-only message of 10+ characters passes native validation. The trim-on-input script blocks it for every JS-enabled visitor; a server-side check would close it fully.

## Speed check

| Metric | Value | Source |
|---|---|---|
| TTFB (edge hit) | ~36 ms | curl ×3 |
| TTFB (edge miss) | ~163–170 ms | curl |
| HTML transfer | 10.8 KB (brotli) | curl `content-encoding: br` |
| HSTS | present (`max-age=31536000; includeSubDomains; preload`) | response headers |
| Headless FCP | ~1.6 s (local harness; indicative only) | injected probe |
| PSI | blocked — `429 Quota exceeded` | documented |

## Deployment verification

Re-checked against the live site on **2026-10-08** (not localhost). Confirms the
fix-nows actually shipped, not just committed:

| Check | Command | Live result | Pass |
|---|---|---|---|
| `robots.txt` | `curl -sI $BASE/robots.txt` | `200`, `text/plain`, 135 B | ✅ |
| `sitemap.xml` | `curl -sI $BASE/sitemap.xml` | `200`, `application/xml`, 451 B | ✅ |
| `share-card.png` | `curl -sI $BASE/share-card.png` | `200`, `image/png`, 39,642 B | ✅ |
| Custom 404 | `curl -s $BASE/this-page-nope` | `HTTP 404` + custom page `<title>Page not found — Pedro Serio</title>` | ✅ |
| Home seeded | `curl -s $BASE/ \| grep og:title` | `og:title`, JSON-LD `Person`, `maxlength` present | ✅ |
| Security headers | `curl -sI $BASE/ \| grep -i content-security-policy` | CSP present | ✅ |

Note: requesting `/404.html` directly returns `200` (it is just a file). The
custom 404 is only proven by requesting a **nonexistent path** and confirming
both `404` status and the custom page body. Netlify injects a hosting comment +
HUD script into HTML, so live byte sizes are slightly larger than the local
files — expected, not a broken deploy.

`share-card.png` serving is confirmed, but its **appearance** still needs a
human eye or a social debugger (Facebook Sharing Debugger, LinkedIn Post
Inspector, or a Slack/Discord unfurl).

## Checkpoint 2 — reviewer checklist

- [ ] Reproduce the four form abuse cases against the fixed deploy (empty, garbage, whitespace, double submit).
- [x] Confirm `robots.txt`, `sitemap.xml`, custom 404, and `share-card.png` load. *(verified live 2026-10-08 — see Deployment verification)*
- [ ] Validate the social preview with a card validator for `https://pedro-serio.netlify.app/`.
- [x] Confirm the security headers are present on the deployed response. *(verified live 2026-10-08: all six present)*

  One-liner — returns `6` when every header is present:

  ```bash
  curl -sI https://pedro-serio.netlify.app/ \
    | grep -ciE '^(content-security-policy|strict-transport-security|x-frame-options|x-content-type-options|referrer-policy|permissions-policy):'
  ```

  Expected: `6`. Full list: `curl -sI https://pedro-serio.netlify.app/ | tr -d '\r'`. Headers are added by Netlify's CDN from `netlify.toml`, so they only appear on the deployed response, never on a local static server.
- [ ] Read the known-limitations list and decide whether any must become fix-now.
- [ ] Delete the "Break Test" submissions from the Netlify Forms dashboard after review.

**Suggested must-fixes from a reviewer** (pending): submit sitemap to Google Search Console (#6), run Lighthouse once tooling is available (#8), and decide whether a validation Function is worth it (#1–#3).