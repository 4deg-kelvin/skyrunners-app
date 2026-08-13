/**
 * The MCP server. One endpoint, JSON-RPC 2.0 over HTTP.
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
 *   2. Read tokens cannot call write tools. Checked here, once, so no tool can
 *      forget.
 *   3. Every write tool calls `can.*` — the same rules as the website.
 *   4. No tool returns anyone else's effort data. See `lib/mcp/viewer.ts`.
 *
 * A refusal is a successful JSON-RPC response with `isError: true`, not a
 * transport error. The model needs to READ the sentence and tell the human
 * what to do; an HTTP 403 gets swallowed by the client and surfaces as
 * "something went wrong".
 */

import { NextResponse } from "next/server";

import { preloadLiveStore, withSuppliedClientStore } from "@/lib/store/request";
import { TOOLS, ToolRefusal } from "@/lib/mcp/tools";
import { tokenFromHeader } from "@/lib/mcp/tokens";
import { viewerFromToken, type McpViewer } from "@/lib/mcp/viewer";
import { SERVER_INSTRUCTIONS } from "@/lib/mcp/guide";
import { listResources, readResource } from "@/lib/mcp/resources";

/** Node, not Edge: the store and the Supabase admin client both need it. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROTOCOL_VERSION = "2024-11-05";

/*
  What the model is told at connection lives in `lib/mcp/guide.ts`, next to the
  long-form version the `guide` tool serves. Two copies of "how the club works"
  would drift, and the short one is the one that silently stops matching.
*/

// ---------------------------------------------------------------------------
// JSON-RPC
// ---------------------------------------------------------------------------

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function result(id: RpcRequest["id"], value: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id, result: value });
}

function rpcError(id: RpcRequest["id"], code: number, message: string) {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } });
}

/** A refusal the MODEL should read, as opposed to a protocol failure. */
function toolError(id: RpcRequest["id"], message: string) {
  return result(id, {
    content: [{ type: "text", text: message }],
    isError: true,
  });
}

function toolOk(id: RpcRequest["id"], text: string) {
  return result(id, { content: [{ type: "text", text }], isError: false });
}

export async function POST(request: Request) {
  let body: RpcRequest;
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, "Parse error: body was not JSON.");
  }

  const { id = null, method } = body;
  if (!method) return rpcError(id, -32600, "Missing `method`.");

  /*
    Notifications carry no id and MUST NOT get a response body. Returning one
    makes strict clients drop the connection right after `initialize`, which
    presents as "the server connected then immediately disappeared".
  */
  if (method.startsWith("notifications/")) {
    return new Response(null, { status: 202 });
  }

  if (method === "ping") return result(id, {});

  if (method === "initialize") {
    return result(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
      },
      serverInfo: { name: "skyrunners", version: "1.0.0" },
      instructions: SERVER_INSTRUCTIONS,
    });
  }

  // Everything past here needs a member.
  const auth = await viewerFromToken(
    tokenFromHeader(request.headers.get("authorization"))
  );

  if (method === "tools/list") {
    /*
      Listed even when the token is bad, so a misconfigured client shows the
      tools and fails at call time with a sentence explaining the token —
      rather than showing an empty server, which looks like the URL is wrong
      and sends people debugging the wrong thing.

      Write tools are hidden from a read-only token: a tool the model can see
      is a tool it will try, and "you can't do that" ten times is worse than
      never offering.
    */
    const visible = TOOLS.filter(
      (t) => !t.write || !auth.ok || auth.viewer.scope === "write"
    );
    return result(id, {
      tools: visible.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
  }

  /*
    Resources need the store loaded to enumerate divisions, so unlike
    `tools/list` they can't answer without a valid token. Returning an empty
    list for a bad token would look like "this server has no resources"; the
    refusal sentence is more useful.
  */
  if (method === "resources/list") {
    if (!auth.ok) return rpcError(id, -32001, auth.error);
    const resources = await withSuppliedClientStore(
      auth.viewer.client,
      async () => {
        await preloadLiveStore();
        return listResources();
      }
    );
    return result(id, { resources });
  }

  if (method === "resources/read") {
    if (!auth.ok) return rpcError(id, -32001, auth.error);
    const uri = String(body.params?.uri ?? "");

    const text = await withSuppliedClientStore(auth.viewer.client, async () => {
      await preloadLiveStore();
      return readResource(uri, auth.viewer);
    });

    if (text === null) return rpcError(id, -32602, `No resource at "${uri}".`);
    return result(id, {
      contents: [{ uri, mimeType: "text/markdown", text }],
    });
  }

  if (method !== "tools/call") {
    return rpcError(id, -32601, `Unknown method: ${method}`);
  }

  if (!auth.ok) return toolError(id, auth.error);
  const viewer: McpViewer = auth.viewer;

  const name = String(body.params?.name ?? "");
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return toolError(id, `No tool called "${name}".`);

  if (tool.write && viewer.scope !== "write") {
    return toolError(
      id,
      `This token is read-only, so it can't ${name.replace(/_/g, " ")}. Make a write-scoped token in Settings on the website if you want to make changes from here.`
    );
  }

  const args = (body.params?.arguments ?? {}) as Record<string, unknown>;

  try {
    /*
      One store scope around the whole call, with the token's client — exactly
      what `withRequestStore` does for a Server Action. Without it a write
      would silently no-op.

      The explicit `preloadLiveStore()` is the other half, and it is not
      optional. On the website every page and action goes through
      `getViewer()`, which preloads; the data functions in `lib/data/*` also
      preload defensively. But a tool that reads the store DIRECTLY — `whoami`,
      `catch_up`, and every `requireProject` / `requireMember` lookup — has
      neither, and threw "Live store not loaded" against production on the
      first real call while `list_projects` worked fine, because that one
      happens to go through `getProjectTree()`.

      So this route is the MCP's `getViewer()`: the one place that guarantees
      the snapshot exists before anything reads it.
    */
    const text = await withSuppliedClientStore(viewer.client, async () => {
      await preloadLiveStore();
      return tool.handler(args, viewer);
    });
    return toolOk(id, text);
  } catch (error) {
    if (error instanceof ToolRefusal) return toolError(id, error.message);

    /*
      An unexpected throw is still returned as a tool error rather than a 500.
      The model can relay it and the human gets something to report; a 500
      shows up in Claude as an opaque connector failure.
    */
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[mcp] ${name} failed`, error);
    return toolError(id, `That didn't work: ${detail}`);
  }
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
      hint: "This is an MCP endpoint, not a web page. Add it to your AI client as an HTTP MCP server with a token from Settings → Connect your AI.",
    },
    { status: 200 }
  );
}
