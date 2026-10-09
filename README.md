# Pedro Serio — Portfolio Site

Static portfolio site for Pedro Serio, a (Bio)DevOps developer building
event-driven AWS infrastructure for genomics and biotech data pipelines.
No build step, no framework — Netlify serves the files as-is.

**Live:** https://pedro-serio.netlify.app
**Hardening review (break-your-own-site):** [`HARDENING-REVIEW.md`](HARDENING-REVIEW.md)

**Deploy status (verified 2026-10-08):** all hardening changes are live on the
deployed site — custom `404.html`, `robots.txt`, `sitemap.xml`, `share-card.png`,
the CSP/security headers, and the hardened form are all confirmed in production
(HTTP checks, not just local files). See
[Deployment verification](HARDENING-REVIEW.md#deployment-verification).

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
favicon.svg             Site icon
connective-tissue.svg   Hero background motif
headshot.jpg            Case-study portrait
architecture-diagram.png Case-study pipeline diagram
Pedro_Serio_CV.pdf      Downloadable CV
docs/                   Break-test evidence
```

## Local preview

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

Netlify Forms posts (`POST /`) are only handled by Netlify, not by a plain
static server.

## Deploy

The repo is configured for Netlify with `publish = "."`. Push to the connected
Git branch (or drag the folder into the Netlify UI). There is no build command.

The contact form uses [Netlify Forms](https://docs.netlify.com/forms/setup/)
(`data-netlify="true"` + `form-name` hidden input). It must exist in the HTML at
deploy time. Submissions appear in the Netlify dashboard.

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

Client-side: `required`, `type="email"`, `minlength`/`maxlength`, whitespace
`pattern`s, plus a small inline script that trims input and prevents double
submits. Without JavaScript the HTML constraints still apply.

Known limitation: there is no server-side validation, so a direct scripted POST
can still create an entry. The honeypot (`bot-field`) plus Netlify spam
filtering are the mitigation. See `HARDENING-REVIEW.md` for the full list.

## Security headers

`netlify.toml` sets `Content-Security-Policy`, `X-Frame-Options`,
`X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy`, and adds
a one-week cache for images/PDF.