# Hardening Review — "Break Your Own Site"

**Site:** https://pedro-serio.netlify.app
**Date:** 2026-10-07 · **Round-1 deploy re-verified:** 2026-10-08 · **Round-2 hardening:** 2026-10-08
**Reviewer:** Pedro (self) · test harness run by the agent
**Status:** round-1 fix-nows **deployed live**; round-2 hardening (server-side validation, strict CSP, WebP) **applied and verified locally**, awaiting the next deploy and Checkpoint 2 review

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

### Round-2 fixes (this pass, 2026-10-08)

Closes known limitations #1–#4, #10 and #12 from the list below. These changes
are committed and verified **locally**; live confirmation happens on the next
deploy.

| Limitation | What changed | How it's verified |
|---|---|---|
| #1 No server-side validation | The form's `action` is now `/.netlify/functions/contact`. The function validates name/email/message on the server, trims them, enforces length limits, and checks the honeypot. Invalid input gets a **400** error page; nothing is forwarded. | `netlify/functions/contact.js`; 9 pure-logic tests + 9 handler tests pass (`node tests/contact.test.js`, `node tests/contact.handler.test.js`); local HTTP: empty/whitespace/garbage → `400` |
| #2 Success page was unconditional | The function only returns `303 → /thanks/` after validation passes. The thanks page is no longer reachable by a raw POST with empty/invalid fields. | handler tests: invalid → `400` (never redirects); valid → `303` |
| #3 No server-side dedup | Before forwarding, the function writes a time-bucketed SHA-256 key to Netlify Blobs with the atomic `set(..., { onlyIfNew: true })`. A duplicate inside the 10-minute window is redirected to thanks but **not** recorded a second time. | handler test "duplicate valid POST → 303 but NOT forwarded again"; `onlyIfNew` is atomic on Blobs, so the check-then-write race is closed |
| #4 CSP allowed `'unsafe-inline'` | Inline `<style>` blocks became external `/assets/*.css`; inline scripts became external `/assets/form.js` and `/assets/copy.js`. `script-src` and `style-src` no longer contain `'unsafe-inline'`. JSON-LD was verified **not** to be subject to `script-src` (data block). | `netlify.toml`; headless Chrome with the exact CSP header: zero violations, styles render (`#f7f8f7` background confirmed from a screenshot), external CSS/JS load |
| #10 Images not WebP | `architecture-diagram` and `headshot` are served as WebP via `<picture>` with the PNG/JPG originals as fallback. Diagram 63.8 KB → 52.9 KB (lossless); headshot 27.2 KB → 19.0 KB. | browser run fetched `/architecture-diagram.webp` and `/headshot.webp`; local HTTP `200 image/webp` |
| #12 No-JS whitespace message | The server-side check in the function rejects a message that is under 10 characters **after trimming**, so a whitespace-only message fails even with JavaScript disabled. | local HTTP POST of 12 spaces → `400`; handler test asserts `400` and no forward |

**Netlify Forms still works.** Netlify's form handler skips `/.netlify/*` and
any path that has a function, so the browser POST reaches the function; the
function then POSTs the clean, validated submission to `/`, where Netlify Forms
records it in the dashboard. Form detection still happens because the form keeps
`data-netlify="true"` and the hidden `form-name` input.

> Caveat carried in the known-limitations list: the forward-to-Forms step is
> verified by Netlify's documented behaviour and by inspecting Netlify's own
> form-handler source (it short-circuits on `/.netlify/*` and on function paths),
> but it can only be confirmed end-to-end **on the deployed site**.

## Known limitations (named, not hidden)

1. **Google Fonts is a third-party, render-blocking dependency.** Self-hosting would improve privacy and maybe performance.
2. **Not indexed yet.** The site is new; the sitemap helps only after Google Search Console submission. No custom domain yet (still a `netlify.app` subdomain). A search for the name surfaces LinkedIn, not the site.
3. **Device matrix not exhaustive.** Tested with headless Chromium (desktop + iPhone UA). Real Safari/Firefox/Android devices were not exercised.
4. **No Lighthouse run this pass.** The PageSpeed Insights API returned HTTP 429 (daily quota exhausted), and the desktop browser tool isn't connected. Speed evidence is proxy-based (TTFB, compression, transfer size, FCP).
5. **No accessibility audit beyond manual checks.** One `<h1>` per page, `alt` text present, focus styles exist, but contrast/screen-reader testing wasn't run.
6. **No uptime/DDoS monitoring** beyond Netlify defaults.
7. **The form now depends on a Function.** If the function or Netlify Blobs is unavailable, dedup **fails open** (it logs and still forwards) so a submission is never silently lost, but duplicate protection is temporarily gone. This is deliberate: availability over strict dedup.
8. **Dedup is intentionally time-boxed.** The same text sent twice within 10 minutes is treated as one submission. A genuine resend of identical text inside that window is dropped. The window is a single constant (`DEDUP_WINDOW_MS`) if it needs tuning.
9. **The Forms forward is confirmed on deploy, not locally.** The function posts the validated data to `/` for Netlify Forms. Local tests mock that call; the real interception can only be observed on the deployed site (see the caveat above).
10. **`share-card.png` stays PNG on purpose.** Social scrapers are inconsistent about WebP for `og:image`, so the social card keeps the universally supported format. Only the on-page images moved to WebP.
11. **Cross-origin isolation / SRI not addressed.** No `Subresource Integrity` on the Google Fonts stylesheet (it is third-party and versionless), and no `Cross-Origin-*` headers. Out of scope for this pass.

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

  Paste the URL into a validator and confirm the card renders (title + description + `share-card.png`):

  - Facebook Sharing Debugger — <https://developers.facebook.com/tools/debug/> (best diagnostic; use **Scrape Again** after tag changes to bust the cache)
  - LinkedIn Post Inspector — <https://www.linkedin.com/post-inspector/>
  - Generic (all networks at once) — <https://www.opengraph.xyz/> or <https://metatags.io/>
  - Real-world test — paste the link into Slack/Discord/iMessage and check the unfurl

  Machine-verifiable side is already confirmed live (2026-10-08): all `og:*` + `twitter:*` tags present, `og:image` is an **absolute** URL, and `share-card.png` returns `200 image/png`, 1200×630. Only the visual appearance still needs a human eye.

  Pass condition: image shown, title "Pedro Serio — Cloud Infrastructure for Scientific Data", description "I turn messy scientific data operations into cloud infrastructure that doesn't fail quietly.", card type `summary_large_image`.
- [x] Confirm the security headers are present on the deployed response. *(verified live 2026-10-08: all six present)*

  One-liner — returns `6` when every header is present:

  ```bash
  curl -sI https://pedro-serio.netlify.app/ \
    | grep -ciE '^(content-security-policy|strict-transport-security|x-frame-options|x-content-type-options|referrer-policy|permissions-policy):'
  ```

  Expected: `6`. Full list: `curl -sI https://pedro-serio.netlify.app/ | tr -d '\r'`. Headers are added by Netlify's CDN from `netlify.toml`, so they only appear on the deployed response, never on a local static server.
- [ ] Read the known-limitations list and decide whether any must become fix-now.
- [ ] Delete the "Break Test" submissions from the Netlify Forms dashboard after review.

**Suggested must-fixes from a reviewer** (pending): submit sitemap to Google Search Console (#2), run Lighthouse once tooling is available (#4), and decide whether self-hosting fonts (#1) is worth it.

## Round-2 local verification (2026-10-08)

Everything below ran against a local server that replays the real
`netlify.toml` headers and routes `/.netlify/functions/contact` to the actual
function (Node 24). Nothing here is deployed yet.

| Check | Result |
|---|---|
| `node tests/contact.test.js` | 9 passed, 0 failed |
| `node tests/contact.handler.test.js` (mocked Blobs + fetch) | 9 passed, 0 failed |
| POST empty / whitespace-message / garbage-email | `400` + error page, not forwarded |
| POST valid / honeypot | `303 → /thanks/`; valid forwarded once |
| Duplicate valid POST | `303` but **not** forwarded again (dedup) |
| Static `/assets/*.css`, `/assets/*.js`, `*.webp` | `200` with correct content types |
| Headless Chrome + exact CSP | zero CSP violations; CSS renders; JSON-LD intact |
| WebP | browser fetched `/architecture-diagram.webp` and `/headshot.webp` |

Re-run after deploy: confirm the deployed form still lands in the Netlify Forms
dashboard, and that a duplicate POST creates only one entry.
