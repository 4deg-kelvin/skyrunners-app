import assert from "node:assert/strict";
import { test } from "node:test";
import {
  connectionScope,
  negotiateVersion,
  readRpcText,
  transportError,
  validateArguments,
} from "./transport.ts";

test("a write token can never authenticate a URL connector", () => {
  assert.equal(connectionScope("write", true), null);
  assert.equal(connectionScope("read", true), "read");
  assert.equal(connectionScope("write", false), "write");
});
test("negotiate a supported version; reject unsupported transport headers and origins", () => {
  assert.equal(negotiateVersion("2025-06-18"), "2025-06-18");
  assert.equal(negotiateVersion("2099-01-01"), "2025-11-25");
  const req = (headers: Record<string, string>) =>
    new Request("https://app.example/api/mcp", { headers });
  assert.equal(transportError(req({})), undefined);
  assert.equal(
    transportError(req({ origin: "https://chatgpt.com" })),
    undefined
  );
  assert.equal(
    transportError(req({ origin: "https://app.example" })),
    undefined
  );
  assert.equal(
    transportError(req({ origin: "https://app.example.evil.test" }))?.status,
    403
  );
  assert.equal(transportError(req({ origin: "null" }))?.status, 403);
  assert.equal(
    transportError(req({ "mcp-protocol-version": "unknown" }))?.status,
    400
  );
});
test("validate tool arguments without coercion or ignored extra properties", () => {
  const schema = {
    type: "object",
    required: ["decision"],
    additionalProperties: false,
    properties: {
      decision: { type: "string", enum: ["approve", "decline"] },
      attending: { type: "boolean" },
      names: { type: "array", items: { type: "string" } },
      count: { type: "number" },
    },
  };
  assert.equal(
    validateArguments(
      { decision: "approve", attending: false, names: ["Ada"], count: 2 },
      schema
    ),
    undefined
  );
  for (const invalid of [
    {},
    { decision: "oops" },
    { decision: "approve", attending: "false" },
    { decision: "approve", names: [1] },
    { decision: "approve", count: NaN },
    { decision: "approve", role: "co_lead" },
    [],
  ])
    assert.ok(validateArguments(invalid, schema));
});
test("body limits count real streamed UTF-8 bytes, without trusting Content-Length", async () => {
  const request = (text: string, headers?: Record<string, string>) =>
    new Request("https://app.example/api/mcp", {
      method: "POST",
      body: text,
      headers,
    });
  assert.equal(
    await readRpcText(request('{"text":"café"}')),
    '{"text":"café"}'
  );
  await assert.rejects(readRpcText(request("é".repeat(140000))), RangeError);
  await assert.rejects(
    readRpcText(request("{}", { "content-length": "999999" })),
    RangeError
  );
});
