# Pedro Serio — Portfolio Site

Static portfolio site for Pedro Serio, a (Bio)DevOps developer building
event-driven AWS infrastructure for genomics and biotech data pipelines.
No build step, no framework — Netlify serves the files as-is.

**Live:** https://pedro-serio.netlify.app
**Hardening review (break-your-own-site):** [`HARDENING-REVIEW.md`](HARDENING-REVIEW.md)

**Deploy status:** round-1 hardening (custom `404.html`, `robots.txt`,
`sitemap.xml`, `share-card.png`, security headers) is **live** (verified
2026-10-08). Round-2 hardening (server-side form validation, strict CSP without
`'unsafe-inline'`, WebP images) is **applied and verified locally** and ships on
the next deploy. See
[Deployment verification](HARDENING-REVIEW.md#deployment-verification) and
[Solved limitations and fixes](HARDENING-REVIEW.md#solved-limitations-and-fixes).

## Structure

```
index.html              Home: hero, value proposition, contact form
case-study/index.html   LIMS-to-platform integration case study
thanks/index.html       Form success page (noindex)
404.html                Custom not-found page
robots.txt              Crawler rules
sitemap.xml             Sitemap (home + case study)
share-card.svg/.png     1200×630 social-share image (og:image)
netlify.toml            Publish dir, security headers, caching
assets/                 External CSS (per page) + form.js / copy.js
netlify/functions/      contact.js — server-side validation + dedup
package.json            Declares @netlify/blobs (used by the function)
favicon.svg             Site icon
connective-tissue.svg   Hero background motif
headshot.jpg/.webp      Case-study portrait (WebP served, JPG fallback)
architecture-diagram.png/.webp  Pipeline diagram (WebP served, PNG fallback)
Pedro_Serio_CV.pdf      Downloadable CV
```

## Local preview

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

This serves the static pages, but the contact form now posts to
`/.netlify/functions/contact`, which a plain static server does not run. That
endpoint — and its server-side validation and dedup — only runs on Netlify.

## Deploy

The repo is configured for Netlify with `publish = "."`. Push to the connected
Git branch (or drag the folder into the Netlify UI). There is no build command,
but because `package.json` exists Netlify installs dependencies (`@netlify/blobs`)
and `NODE_VERSION = "22"` is set in `netlify.toml` for the function runtime.

The contact form still uses
[Netlify Forms](https://docs.netlify.com/forms/setup/) (`data-netlify="true"` +
`form-name` hidden input) and must exist in the HTML at deploy time. The form
posts to the function, which validates and then forwards the clean submission to
Netlify Forms, so submissions still appear in the dashboard.

## SEO / social

Every public page has a unique title, meta description, canonical URL, Open
Graph + Twitter card tags, and a shared `share-card.png`. The home page also
carries `Person` JSON-LD. The thanks page is `noindex, nofollow`.

To make the site findable, submit `https://pedro-serio.netlify.app/sitemap.xml`
in Google Search Console after deploying.

The four discovery assets are verified live: `robots.txt` (`200 text/plain`),
`sitemap.xml` (`200 application/xml`), `share-card.png` (`200 image/png`), and
unknown paths return `404` with the custom page. `share-card.png` still needs a
human/social-debugger check for appearance (Facebook Sharing Debugger, LinkedIn
Post Inspector, or a Slack/Discord unfurl).

## Form hardening

**Server-side (authoritative):** `netlify/functions/contact.js` is the form's
`action`. It trims and validates name/email/message, enforces length limits,
drops the honeypot, and de-duplicates identical submissions within a 10-minute
window using Netlify Blobs (atomic `onlyIfNew`). Invalid input returns a `400`
error page and is never forwarded. Only a valid submission reaches `/thanks/`
and the Netlify Forms dashboard.

**Client-side (fast feedback):** `required`, `type="email"`,
`minlength`/`maxlength`, whitespace `pattern`s, plus `assets/form.js` which trims
input and prevents double submits.

## Security headers

`netlify.toml` sets a strict `Content-Security-Policy` (`script-src 'self'`,
`style-src 'self' https://fonts.googleapis.com` — **no** `'unsafe-inline'`),
plus `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and
`Permissions-Policy`. Inline page styles/scripts live in `assets/`; inline
JSON-LD is a data block and is not subject to `script-src`. Images/PDF/CSS/JS
get a one-week cache.
