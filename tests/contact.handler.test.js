"use strict";

// End-to-end tests for the contact function handler, with @netlify/blobs and
// fetch mocked so no network or Netlify account is needed. Run with:
//   node tests/contact.handler.test.js

const assert = require("node:assert");
const Module = require("node:module");
const path = require("node:path");

// --- mocks -----------------------------------------------------------------
const storeData = new Set();
const store = {
  async set(key, value, opts) {
    if (opts && opts.onlyIfNew && storeData.has(key)) return { modified: false };
    storeData.add(key);
    return { modified: true, etag: '"1"' };
  },
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@netlify/blobs") return { getStore: () => store };
  return origLoad.apply(this, arguments);
};

const forwarded = [];
global.fetch = async (url, init) => {
  forwarded.push({ url, body: init && init.body });
  return { ok: true, status: 200 };
};

const contactPath = path.join(__dirname, "..", "netlify", "functions", "contact.js");
const contact = require(contactPath);

// --- helpers ---------------------------------------------------------------
function event(fields, opts = {}) {
  return {
    httpMethod: opts.method || "POST",
    headers: { host: "pedro-serio.netlify.app", "x-forwarded-proto": "https" },
    body: new URLSearchParams(fields).toString(),
    isBase64Encoded: false,
  };
}
const valid = { "form-name": "contact", name: "Bob", email: "bob@example.com", message: "Hello, this is a sufficiently long message." };

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("  ok  - " + name);
  } catch (err) {
    failed += 1;
    console.log("FAIL  - " + name + "\n        " + err.stack);
  }
}

(async () => {
  console.log("handler");

  await test("rejects non-POST with 405", async () => {
    const res = await contact.handler(event({}, { method: "GET" }));
    assert.strictEqual(res.statusCode, 405);
  });

  await test("empty POST -> 400 and not forwarded", async () => {
    forwarded.length = 0;
    const res = await contact.handler(event({ "form-name": "contact" }));
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(forwarded.length, 0);
    assert.match(res.body, /Message not sent/);
  });

  await test("whitespace-only message -> 400 and not forwarded", async () => {
    forwarded.length = 0;
    const res = await contact.handler(event({ ...valid, message: "            " }));
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(forwarded.length, 0);
  });

  await test("garbage email -> 400 and not forwarded", async () => {
    forwarded.length = 0;
    const res = await contact.handler(event({ ...valid, email: "nope" }));
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(forwarded.length, 0);
  });

  await test("honeypot -> 303 to /thanks and not forwarded", async () => {
    forwarded.length = 0;
    const res = await contact.handler(event({ ...valid, "bot-field": "spam" }));
    assert.strictEqual(res.statusCode, 303);
    assert.strictEqual(res.headers.Location, "/thanks/");
    assert.strictEqual(forwarded.length, 0);
  });

  await test("valid POST -> 303 and forwarded once to Netlify Forms", async () => {
    forwarded.length = 0;
    const res = await contact.handler(event(valid));
    assert.strictEqual(res.statusCode, 303);
    assert.strictEqual(res.headers.Location, "/thanks/");
    assert.strictEqual(forwarded.length, 1);
    assert.strictEqual(forwarded[0].url, "https://pedro-serio.netlify.app/");
    const body = new URLSearchParams(forwarded[0].body);
    assert.strictEqual(body.get("form-name"), "contact");
    assert.strictEqual(body.get("name"), "Bob");
    assert.strictEqual(body.get("email"), "bob@example.com");
  });

  await test("duplicate valid POST -> 303 but NOT forwarded again (dedup)", async () => {
    forwarded.length = 0;
    const res = await contact.handler(event(valid));
    assert.strictEqual(res.statusCode, 303);
    assert.strictEqual(forwarded.length, 0, "duplicate should not create a second submission");
  });

  await test("valid POST trims values before forwarding", async () => {
    forwarded.length = 0;
    const res = await contact.handler(event({ "form-name": "contact", name: "  Alice  ", email: " alice@example.com ", message: "   Another sufficiently long message.   " }));
    assert.strictEqual(res.statusCode, 303);
    const body = new URLSearchParams(forwarded[0].body);
    assert.strictEqual(body.get("name"), "Alice");
    assert.strictEqual(body.get("email"), "alice@example.com");
    assert.strictEqual(body.get("message"), "Another sufficiently long message.");
  });

  await test("error page escapes HTML in the message", async () => {
    const res = await contact.handler(event({ "form-name": "contact", name: "<script>", email: "x", message: "short" }));
    assert.strictEqual(res.statusCode, 400);
    assert.ok(!res.body.includes("<script>"));
  });

  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed === 0 ? 0 : 1);
})();
