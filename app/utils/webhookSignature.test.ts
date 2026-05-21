import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { signPayload } from "./webhookSignature.ts";

// Locked vectors. If signPayload ever changes encoding (e.g. back to hex,
// or to a different algorithm) these will fail and force a deliberate
// migration with the Boomi receiver.

test("signPayload returns Base64 (44 chars, ending in '=') for a 32-byte digest", () => {
  const sig = signPayload(`{"event":"test.ping","value":42}`, "supersecret");
  assert.equal(sig.length, 44);
  assert.match(sig, /^[A-Za-z0-9+/]+=*$/);
});

test("signPayload matches the canonical HMAC-SHA256 base64 for a known vector", () => {
  // Frozen vector — must stay constant. If Boomi runs HMAC-SHA256 over the
  // same body bytes with the same key and base64-encodes the digest, it will
  // produce this exact string.
  const body = `{"event":"test.ping","value":42}`;
  const key = "supersecret";
  const expected = "K7NLiz/zsxEi4drE9v5iW8tsgrtZopMTh6d3+rpYwpQ=";
  assert.equal(signPayload(body, key), expected);
});

test("signPayload agrees with Node's crypto for a random-looking payload", () => {
  const body = JSON.stringify({
    event: "return.approved",
    timestamp: "2026-05-18T11:25:14.123Z",
    shop: "demo.myshopify.com",
    data: { id: "abc123", items: [{ sku: "SKU-1", quantity: 2 }] },
  });
  const key = "0e29813959021c20f43a4b018e746ff97194aed46349cf80f4d526d80633e130";
  const expected = createHmac("sha256", key).update(body).digest("base64");
  assert.equal(signPayload(body, key), expected);
});

test("signPayload changes when either the key or the payload changes", () => {
  const body = `{"event":"test"}`;
  const sigA = signPayload(body, "secret-a");
  const sigB = signPayload(body, "secret-b");
  const sigC = signPayload(`${body} `, "secret-a"); // trailing space → different bytes
  assert.notEqual(sigA, sigB);
  assert.notEqual(sigA, sigC);
});

test("signPayload is stable across invocations (deterministic, no random IV)", () => {
  const body = `{"event":"test"}`;
  const key = "k";
  assert.equal(signPayload(body, key), signPayload(body, key));
});
