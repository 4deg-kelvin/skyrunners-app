import assert from "node:assert/strict";
import { test } from "node:test";
import { isRpcRequest } from "./rpc.ts";

test("malformed JSON-RPC envelopes are refused before method dispatch", () => {
  for (const value of [
    null,
    [],
    42,
    "ping",
    {},
    { jsonrpc: "2.0", method: 5 },
    { jsonrpc: "1.0", method: "ping" },
    { jsonrpc: "2.0", method: "ping", id: {} },
    { jsonrpc: "2.0", method: "ping", params: [] },
    { jsonrpc: "2.0", method: "tools/call", params: { arguments: null } },
  ]) {
    assert.equal(isRpcRequest(value), false, JSON.stringify(value));
  }
});
test("normal requests and idless notifications are accepted", () => {
  for (const value of [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    {
      jsonrpc: "2.0",
      id: "call",
      method: "tools/call",
      params: { name: "whoami", arguments: {} },
    },
  ]) {
    assert.equal(isRpcRequest(value), true);
  }
});
