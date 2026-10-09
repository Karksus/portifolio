"use strict";

// Server-side validation + dedup for the contact form.
//
// Why this exists: the form's client-side constraints can be bypassed by any
// script, so a raw POST used to reach Netlify Forms unchecked. This function is
// now the form's action. It validates and trims on the server, drops the
// honeypot, de-duplicates identical rapid submissions (Netlify Blobs, atomic
// onlyIfNew), and only then forwards the clean submission to Netlify Forms so
// entries still appear in the Netlify dashboard.

const crypto = require("node:crypto");

// @netlify/blobs is provided by the functions runtime (declared in package.json).
// If it can't be loaded we skip dedup rather than fail the submission.
let getStore = null;
try {
  ({ getStore } = require("@netlify/blobs"));
} catch (err) {
  console.error("contact: @netlify/blobs unavailable, dedup disabled:", err && err.message);
}

const LIMITS = { nameMin: 2, nameMax: 100, emailMax: 254, messageMin: 10, messageMax: 5000 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEDUP_WINDOW_MS = 10 * 60 * 1000; // identical submissions inside 10 min are treated as one

const SITE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

function str(value) {
  return value == null ? "" : String(value);
}

// Pure, unit-testable. Returns trimmed values plus any validation errors.
function validateSubmission(fields) {
  const errors = [];
  const name = str(fields && fields.name).trim();
  const email = str(fields && fields.email).trim();
  const message = str(fields && fields.message).trim();

  if (name.length < LIMITS.nameMin) {
    errors.push("Please enter your name (at least 2 characters).");
  } else if (name.length > LIMITS.nameMax) {
    errors.push("That name is too long (100 characters max).");
  }

  if (email.length === 0) {
    errors.push("Please enter your email address.");
  } else if (email.length > LIMITS.emailMax) {
    errors.push("That email address is too long.");
  } else if (!EMAIL_RE.test(email)) {
    errors.push("Please enter a valid email address.");
  }

  if (message.length < LIMITS.messageMin) {
    errors.push("Please write a message (at least 10 characters).");
  } else if (message.length > LIMITS.messageMax) {
    errors.push("That message is too long (5000 characters max).");
  }

  return { ok: errors.length === 0, errors, values: { name, email, message } };
}

// Pure, unit-testable. Time-bucketed hash so a double submit collapses to one
// entry, while the same person may legitimately resend the same text later.
function dedupKey(values, now = Date.now(), windowMs = DEDUP_WINDOW_MS) {
  const bucket = Math.floor(now / windowMs);
  const hash = crypto
    .createHash("sha256")
    .update([str(values && values.name), str(values && values.email), str(values && values.message), bucket].join("\n"))
    .digest("hex");
  return "submission/" + hash;
}

function escapeHtml(value) {
  return str(value).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

function errorPage(errors) {
  const items = errors.map((e) => `      <li>${escapeHtml(e)}</li>`).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Message not sent — Pedro Serio</title>
<meta name="robots" content="noindex">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="stylesheet" href="/assets/404.css">
</head>
<body>
<main>
<section class="wrap not-found">
  <h1>Message not sent</h1>
  <p>Please fix the following and try again:</p>
  <ul>
${items}
  </ul>
  <p class="actions">
    <a href="/#contact" class="cta-button">Back to the form</a>
  </p>
</section>
</main>
</body>
</html>
`;
}

function errorResult(errors) {
  return {
    statusCode: 400,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Content-Security-Policy": SITE_CSP,
    },
    body: errorPage(errors),
  };
}

function redirectToThanks() {
  return {
    statusCode: 303,
    headers: { Location: "/thanks/", "Cache-Control": "no-store" },
    body: "",
  };
}

function siteOrigin(event) {
  const headers = (event && event.headers) || {};
  const proto = headers["x-forwarded-proto"] || headers["X-Forwarded-Proto"] || "https";
  const host = headers["host"] || headers["Host"] || "pedro-serio.netlify.app";
  return `${proto}://${host}`;
}

exports.handler = async (event) => {
  if (str(event && event.httpMethod).toUpperCase() !== "POST") {
    return { statusCode: 405, headers: { Allow: "POST" }, body: "Method Not Allowed" };
  }

  let params;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(str(event.body), "base64").toString("utf8")
      : str(event.body);
    params = new URLSearchParams(raw);
  } catch (err) {
    return errorResult(["Sorry, the form could not be read. Please try again."]);
  }

  // Honeypot: look successful, drop silently (matches Netlify's own behaviour).
  if (str(params.get("bot-field")).trim() !== "") {
    return redirectToThanks();
  }

  const { ok, errors, values } = validateSubmission({
    name: params.get("name"),
    email: params.get("email"),
    message: params.get("message"),
  });
  if (!ok) {
    return errorResult(errors);
  }

  // Server-side idempotency (closes the "two rapid POSTs = two entries" gap).
  if (getStore) {
    try {
      const store = getStore("contact");
      const { modified } = await store.set(dedupKey(values), new Date().toISOString(), { onlyIfNew: true });
      if (!modified) {
        return redirectToThanks();
      }
    } catch (err) {
      console.error("contact: dedup check failed:", err && err.message);
    }
  }

  // Forward the clean submission to Netlify Forms (recorded in the dashboard).
  try {
    const body = new URLSearchParams({
      "form-name": "contact",
      name: values.name,
      email: values.email,
      message: values.message,
    }).toString();
    const res = await fetch(`${siteOrigin(event)}/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      console.error("contact: Netlify Forms forward returned", res.status);
    }
  } catch (err) {
    console.error("contact: Netlify Forms forward failed:", err && err.message);
  }

  return redirectToThanks();
};

exports._internal = { validateSubmission, dedupKey, EMAIL_RE, LIMITS, DEDUP_WINDOW_MS, escapeHtml };
