"use strict";

// Unit tests for the pure logic in netlify/functions/contact.js.
// The handler itself is thin wiring; these tests cover the rules that used to
// be bypassable (empty, whitespace-only, garbage email, over-length fields)
// plus the dedup-key semantics. Run with: node tests/contact.test.js

const assert = require("node:assert");
const path = require("node:path");

// The function guards its @netlify/blobs require, so it loads fine even when
// dependencies are not installed.
const contact = require(path.join(__dirname, "..", "netlify", "functions", "contact.js"));
const { validateSubmission, dedupKey } = contact._internal;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("  ok  - " + name);
  } catch (err) {
    failed += 1;
    console.log("FAIL  - " + name + "\n        " + err.message);
  }
}

console.log("validateSubmission");

test("rejects fully empty input", () => {
  const r = validateSubmission({ name: "", email: "", message: "" });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.errors.length, 3);
});

test("rejects whitespace-only name and message", () => {
  const r = validateSubmission({ name: "   ", email: "a@b.co", message: "            " });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.values.name, "");
  assert.strictEqual(r.values.message, "");
});

test("rejects garbage email", () => {
  const r = validateSubmission({ name: "Bob", email: "not-an-email", message: "hello there, this is a real message" });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.values.email, "not-an-email");
});

test("rejects message shorter than 10 chars after trim", () => {
  const r = validateSubmission({ name: "Bob", email: "bob@example.com", message: "   short   " });
  assert.strictEqual(r.ok, false);
});

test("rejects over-long name and message", () => {
  const r = validateSubmission({ name: "x".repeat(101), email: "bob@example.com", message: "y".repeat(5001) });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.errors.length, 2);
});

test("accepts a valid submission and trims the values", () => {
  const r = validateSubmission({ name: "  Bob  ", email: "  bob@example.com ", message: "   Hello, this is a sufficiently long message.   " });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.values, {
    name: "Bob",
    email: "bob@example.com",
    message: "Hello, this is a sufficiently long message.",
  });
});

console.log("dedupKey");

test("identical submissions in the same window share a key", () => {
  const v = { name: "Bob", email: "bob@example.com", message: "hello there, this is a real message" };
  const now = 1_700_000_000_000;
  assert.strictEqual(dedupKey(v, now), dedupKey({ ...v }, now + 1000));
});

test("different submissions get different keys", () => {
  const now = 1_700_000_000_000;
  const a = dedupKey({ name: "Bob", email: "bob@example.com", message: "hello there, this is a real message" }, now);
  const b = dedupKey({ name: "Bob", email: "bob@example.com", message: "a different real message here" }, now);
  assert.notStrictEqual(a, b);
});

test("the same submission in a later window gets a new key", () => {
  const v = { name: "Bob", email: "bob@example.com", message: "hello there, this is a real message" };
  const now = 1_700_000_000_000;
  assert.notStrictEqual(dedupKey(v, now), dedupKey(v, now + 11 * 60 * 1000));
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
