/**
 * The MCP server. One endpoint, JSON-RPC 2.0 over HTTP, token in the header.
 *
 * ---------------------------------------------------------------------------
 * Why there's no SDK here
 * ---------------------------------------------------------------------------
 *
 * MCP's HTTP transport is a small JSON-RPC surface — `initialize`,
 * `tools/list`, `tools/call`, `ping`, and notifications. The official SDK is
 * built around stateful sessions and long-lived transports, which is the wrong
 * shape for a serverless function that may not survive between two requests,
 * and it would add a fast-moving dependency to a project maintained by one
 * person who is new to this. Handling the six methods directly is less code
 * than wiring the SDK up would be, and it can't break on a minor release.
 *
 * Stateless on purpose: every request carries its token and is resolved from
 * scratch. Nothing is held between calls, so it doesn't matter which Vercel
 * instance answers.
 *
 * ---------------------------------------------------------------------------
 * The safety model, in one place
 * ---------------------------------------------------------------------------
 *
 *   1. A token identifies a member. `lib/mcp/viewer.ts` turns it into the same
 *      `{ actor, graph, member }` every page uses.
 *   2. Read tokens cannot call write tools. Checked in `handleMcpRequest`, once,
 *      so no tool can forget.
 *   3. Every write tool calls `can.*` — the same rules as the website.
 *   4. Writes are rate-limited per token. See `lib/mcp/rate-limit.ts`, and the
 *      durable ceiling in `createProject` that exists because an assistant once
 *      created ~4,000 empty projects through this endpoint.
 *   5. No tool returns anyone else's effort data. See `lib/mcp/viewer.ts`.
 *
 * A refusal is a successful JSON-RPC response with `isError: true`, not a
 * transport error. The model needs to READ the sentence and tell the human
 * what to do; an HTTP 403 gets swallowed by the client and surfaces as
 * "something went wrong".
 *
 * The request handling itself lives in `lib/mcp/handler.ts`, shared with
 * `/api/mcp/[token]` — the read-only entry point that exists because claude.ai
 * cannot send a header at all.
 */

import { NextResponse } from "next/server";

import { handleMcpRequest, parseRpcBody } from "@/lib/mcp/handler";
import { tokenFromHeader } from "@/lib/mcp/tokens";

/** Node, not Edge: the store and the Supabase admin client both need it. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = await parseRpcBody(request);
  if (!parsed.ok) return parsed.response;

  return handleMcpRequest(
    parsed.body,
    tokenFromHeader(request.headers.get("authorization"))
  );
}

/**
 * A GET here is somebody pasting the URL into a browser, or a client probing
 * for the SSE transport we don't implement. Both deserve a sentence rather
 * than a 404 or a hang.
 */
export async function GET() {
  return NextResponse.json(
    {
      name: "skyrunners-mcp",
      transport: "http",
      hint: "This is an MCP endpoint, not a web page. Add it to your AI client as an HTTP MCP server with a token from Settings → Connect your AI. In claude.ai or the Claude desktop app, which can't send a header, use the personal URL shown there instead — that one is read-only.",
    },
    { status: 200 }
  );
}
