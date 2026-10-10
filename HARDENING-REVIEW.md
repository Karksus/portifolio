# Hardening Review — "Break Your Own Site"


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
| Speed | curl timing + compression + headless FCP | TTFB 36–228 ms; brotli enabled; HTML 10.8 KB |

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

## Limitations and fixes


### No server-side validation
Client-side rules were bypassable by any script: a raw `POST` with empty fields
still reached Netlify and returned the thanks page.

**Fix.** The form's `action` is now `/.netlify/functions/contact`. The function
validates name/email/message on the server, trims them, enforces the length
limits, and checks the honeypot. Invalid input gets a **400** error page and
nothing is forwarded.

**Verified.** 9 pure-logic tests + 9 handler tests pass; local HTTP: empty /
whitespace / garbage → `400`.

### The success page was unconditional
A visitor (or bot) saw "Message sent" even when the submission was invalid.

**Fix.** The function returns `303 → /thanks/` only after validation passes, so
the thanks page is no longer reachable by a raw `POST` with empty or invalid
fields.

**Verified.** Handler tests: invalid → `400` (never redirects); valid → `303`.

### No server-side deduplication
The double-submit guard was client-side only; two rapid scripted `POST`s created
two entries.

**Fix.** Before forwarding, the function writes a time-bucketed SHA-256 key to
Netlify Blobs with the atomic `set(..., { onlyIfNew: true })`. A duplicate inside
the 10-minute window is redirected to thanks but **not** recorded a second time.

**Verified.** Handler test "duplicate valid POST → 303 but NOT forwarded again";
`onlyIfNew` is atomic, which closes the check-then-write race.

### CSP allowed `'unsafe-inline'`
The inline scripts and styles forced `script-src` and `style-src` to allow
`'unsafe-inline'`.

**Fix.** Inline `<style>` blocks became external `/assets/*.css`; inline scripts
became external `/assets/form.js` and `/assets/copy.js`. `script-src` and
`style-src` no longer contain `'unsafe-inline'`. Inline JSON-LD was verified
**not** to be subject to `script-src` (it is a data block).

**Verified.** `netlify.toml`; headless Chrome with the exact CSP header: zero
violations, styles render (`#f7f8f7` background confirmed from a screenshot),
external CSS/JS load.

### Images not WebP
The content images were served as PNG/JPG only.

**Fix.** `architecture-diagram` and `headshot` are served as WebP via `<picture>`
with the PNG/JPG originals as fallback. Diagram 63.8 KB → 52.9 KB (lossless);
headshot 27.2 KB → 19.0 KB.

**Verified.** Browser run fetched `/architecture-diagram.webp` and
`/headshot.webp`; local HTTP `200 image/webp`.

### No-JS whitespace message
`<textarea>` has no `pattern` attribute, so without JavaScript a whitespace-only
message of 10+ characters passed native validation.

**Fix.** The server-side check in the function rejects a message that is under
10 characters **after trimming**, so a whitespace-only message fails even with
JavaScript disabled.

**Verified.** Local HTTP POST of 12 spaces → `400`; handler test asserts `400`
and no forward.

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

