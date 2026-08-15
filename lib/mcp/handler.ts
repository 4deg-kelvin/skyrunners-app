/**
 * The MCP JSON-RPC handler, shared by both ways in.
 *
 * ===========================================================================
 * Why there are two entry points
 * ===========================================================================
 *
 * `POST /api/mcp` with `Authorization: Bearer skr_…` is the real one, and it is
 * what Claude Code uses.
 *
 * `POST /api/mcp/<token>` exists because **claude.ai and the Claude desktop app
 * cannot send a custom header.** Their "add a custom connector" dialog takes a
 * URL and nothing else, so a server that only reads the Authorization header is
 * reachable from Claude Code and from nowhere else — which was the state of this
 * one, and the reason Anish asked for it to work in normal Claude.
 *
 * ---------------------------------------------------------------------------
 * The URL path is READ-ONLY, deliberately
 * ---------------------------------------------------------------------------
 *
 * A token in a URL is a materially worse secret than a token in a header, and the
 * specific reason is logging: Vercel records the request path of every request, so
 * a write credential pasted into a connector URL ends up sitting in the platform's
 * logs in plain text, readable by anybody with log access. A header does not.
 *
 * The club already accepts that trade for the calendar feed — see
 * `lib/calendar/feed-token.ts` — and the reason it is acceptable there is that the
 * feed can only ever READ one member's own event list. So the same rule applies
 * here: authenticate by URL and you get exactly the read half.
 *
 * This is a real limitation rather than a temporary one, and the honest fix is
 * OAuth, which is what claude.ai actually wants for a connector that writes. The
 * shape of that work is in `docs/MCP_SECURITY_REVIEW.md`. Until then a member who
 * wants an assistant that changes things uses Claude Code, where the header works
 * and the credential stays out of the URL.
 *
 * A write tool called over a URL-authenticated connection is refused with a
 * sentence explaining exactly this, rather than being hidden — a model that can't
 * see the tool tells the member the feature doesn't exist, which is worse than
 * telling them where it does.
 */

import { NextResponse } from "next/server";

import { preloadLiveStore, withSuppliedClientStore } from "@/lib/store/request";
import { TOOLS, ToolRefusal } from "@/lib/mcp/tools";
import { viewerFromToken, type McpViewer } from "@/lib/mcp/viewer";
import { SERVER_INSTRUCTIONS } from "@/lib/mcp/guide";
import { listResources, readResource } from "@/lib/mcp/resources";
import { checkWriteBudget } from "@/lib/mcp/rate-limit";

const PROTOCOL_VERSION = "2024-11-05";

export interface RpcRequest {
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

/**
 * @param token    The presented credential, from a header or from the path.
 * @param viaUrl   True when it came from the path. Forces read-only; see above.
 */
export async function handleMcpRequest(
  body: RpcRequest,
  token: string | null,
  { viaUrl = false }: { viaUrl?: boolean } = {}
): Promise<Response> {
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
      instructions: viaUrl
        ? `${SERVER_INSTRUCTIONS}\n\nThis connection is READ-ONLY because it authenticates with a token in the URL. You can answer any question about the club, but you cannot change anything. If the member asks you to, tell them: changes need Claude Code, where the token travels in a header instead — Settings on the website has the command.`
        : SERVER_INSTRUCTIONS,
    });
  }

  // Everything past here needs a member.
  const auth = await viewerFromToken(token);

  /*
    A URL-authenticated connection is read-only however the token was minted.

    Downgraded rather than refused: a member who happens to have made a write
    token should still get a working read connector out of it, and the
    `initialize` instructions above tell the model what it can and can't do.
  */
  const scope: "read" | "write" =
    auth.ok && !viaUrl ? auth.viewer.scope : "read";

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
      (t) => !t.write || !auth.ok || scope === "write"
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

  if (tool.write && scope !== "write") {
    return toolError(
      id,
      viaUrl
        ? `This connection is read-only, so it can't ${name.replace(/_/g, " ")}. It authenticates with a token in the URL, and a credential that can change things does not belong in a URL — the platform logs them. To make changes from an assistant, connect through Claude Code instead: Settings → Connect your AI on the website has the one-line command.`
        : `This token is read-only, so it can't ${name.replace(/_/g, " ")}. Make a write-scoped token in Settings on the website if you want to make changes from here.`
    );
  }

  /*
    The write budget, checked here for the same reason the scope is: once, where
    no tool can forget it.

    Only writes are counted. Reads are cheap, idempotent and the thing this server
    is mostly for — rate-limiting them would make "catch me up" fail for somebody
    asking a lot of questions, which is the behaviour we want.

    See `lib/mcp/rate-limit.ts` for what this is and is not worth: it stops the
    accident that happened, and it is not a boundary against a hostile token
    holder. The durable ceiling on empty projects lives in `createProject`.
  */
  if (tool.write) {
    const budget = checkWriteBudget(viewer.tokenId);
    if (!budget.ok) return toolError(id, budget.message ?? "Too many changes.");
  }

  const args = (body.params?.arguments ?? {}) as Record<string, unknown>;

  try {
    /*
      One store scope around the whole call, with the token's client — exactly
      what `withRequestStore` does for a Server Action. Without it a write
      would silently no-op.

      The explicit `preloadLiveStore()` is the other half, and it is not
      optional. On the website every page and action goes through `getViewer()`,
      which preloads; the data functions in `lib/data/*` also preload
      defensively. But a tool that reads the store DIRECTLY — `whoami`,
      `catch_up`, and every `requireProject` / `requireMember` lookup — has
      neither, and threw "Live store not loaded" against production on the first
      real call while `list_projects` worked fine, because that one happens to go
      through `getProjectTree()`.

      So this is the MCP's `getViewer()`: the one place that guarantees the
      snapshot exists before anything reads it.
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

/** Shared by both routes: a body that isn't JSON is a parse error, not a crash. */
export async function parseRpcBody(
  request: Request
): Promise<{ ok: true; body: RpcRequest } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: (await request.json()) as RpcRequest };
  } catch {
    return {
      ok: false,
      response: rpcError(null, -32700, "Parse error: body was not JSON."),
    };
  }
}
