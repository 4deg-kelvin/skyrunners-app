/** Shared stateless MCP endpoint. Header tokens use their scope; URL tokens
 * must be minted read-only, so a logged URL cannot reveal a write credential. */
import { NextResponse } from "next/server";

import { preloadLiveStore, withSuppliedClientStore } from "@/lib/store/request";
import { TOOLS, ToolRefusal } from "@/lib/mcp/tools";
import { viewerFromToken, type McpViewer } from "@/lib/mcp/viewer";
import { SERVER_INSTRUCTIONS } from "@/lib/mcp/guide";
import { listResources, readResource } from "@/lib/mcp/resources";
import { checkWriteBudget } from "@/lib/mcp/rate-limit";
import { isRpcRequest } from "@/lib/mcp/rpc";

import {
  connectionScope,
  negotiateVersion,
  MCP_HEADERS,
  readRpcText,
  transportError,
  validateArguments,
} from "./transport";

export interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function result(id: RpcRequest["id"], value: unknown) {
  return NextResponse.json(
    { jsonrpc: "2.0", id, result: value },
    { headers: MCP_HEADERS }
  );
}

function rpcError(id: RpcRequest["id"], code: number, message: string) {
  return NextResponse.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { headers: MCP_HEADERS }
  );
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
  if (body.id === undefined) {
    return new Response(null, { status: 202, headers: MCP_HEADERS });
  }

  if (method === "ping") return result(id, {});

  if (method === "initialize") {
    return result(id, {
      protocolVersion: negotiateVersion(body.params?.protocolVersion),
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
      },
      serverInfo: { name: "skyrunners", version: "1.1.0" },
      instructions: viaUrl
        ? `${SERVER_INSTRUCTIONS}\n\nThis connection is READ-ONLY because it authenticates with a token in the URL. You can answer any question about the club, but you cannot change anything. If the member asks you to, tell them: changes need Codex or Claude Code, where the token travels in a header instead — Settings on the website has the command.`
        : SERVER_INSTRUCTIONS,
    });
  }

  // Everything past here needs a member.
  let auth: Awaited<ReturnType<typeof viewerFromToken>>;
  try {
    auth = await viewerFromToken(token);
  } catch (error) {
    console.error("[mcp] authentication failed", error);
    return rpcError(
      id,
      -32603,
      "Could not verify the connection. Please try again."
    );
  }
  if (auth.ok && connectionScope(auth.viewer.scope, viaUrl) === null) {
    return rpcError(
      id,
      -32001,
      "Personal connector URLs require a read-only token. Create a separate read-only token in Settings; use write tokens only in an Authorization header."
    );
  }

  /*
    A URL-authenticated connection is read-only however the token was minted.

    Write-scoped URL tokens have already been refused above.
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
    const visible = TOOLS.filter((t) => !t.write || scope === "write");
    return result(id, {
      tools: visible.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: {
          readOnlyHint: !t.write,
          destructiveHint: !!t.write,
          idempotentHint: !t.write,
          openWorldHint: true,
        },
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
    const resources = await loadResource(auth.viewer.client, async () => {
      await preloadLiveStore();
      return listResources();
    });
    if (resources === undefined)
      return rpcError(id, -32603, "Resources are temporarily unavailable.");
    return result(id, { resources });
  }

  if (method === "resources/read") {
    if (!auth.ok) return rpcError(id, -32001, auth.error);
    if (typeof body.params?.uri !== "string")
      return rpcError(id, -32602, "uri must be text.");
    const uri = body.params.uri;

    const text = await loadResource(auth.viewer.client, async () => {
      await preloadLiveStore();
      return readResource(uri, auth.viewer);
    });

    if (text === undefined)
      return rpcError(id, -32603, "Resource is temporarily unavailable.");
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
        ? `This connection is read-only, so it can't ${name.replace(/_/g, " ")}. It authenticates with a token in the URL, and a credential that can change things does not belong in a URL — the platform logs them. To make changes from an assistant, connect through Codex or Claude Code instead: Settings → Connect your AI on the website has the one-line command.`
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
  const args = body.params?.arguments ?? {};
  const invalid = validateArguments(args, tool.inputSchema);
  if (invalid) return rpcError(id, -32602, invalid);

  if (tool.write) {
    const budget = checkWriteBudget(viewer.tokenId);
    if (!budget.ok) return toolError(id, budget.message ?? "Too many changes.");
  }

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
      return tool.handler(args as Record<string, unknown>, viewer);
    });
    return toolOk(id, text);
  } catch (error) {
    if (error instanceof ToolRefusal) return toolError(id, error.message);

    /*
      An unexpected throw is still returned as a tool error rather than a 500.
      The model can relay it and the human gets something to report; a 500
      shows up in Claude as an opaque connector failure.
    */
    console.error(`[mcp] ${name} failed`, error);
    return toolError(
      id,
      "The request could not be completed. Please try again or report the tool name to the app administrator."
    );
  }
}

/** Shared by both routes: a body that isn't JSON is a parse error, not a crash. */
export async function parseRpcBody(
  request: Request
): Promise<{ ok: true; body: RpcRequest } | { ok: false; response: Response }> {
  try {
    const invalidTransport = transportError(request);
    if (invalidTransport) return { ok: false, response: invalidTransport };
    const body: unknown = JSON.parse(await readRpcText(request));
    if (!isRpcRequest(body)) {
      return {
        ok: false,
        response: rpcError(null, -32600, "Invalid JSON-RPC request."),
      };
    }
    return { ok: true, body: body as RpcRequest };
  } catch (error) {
    if (error instanceof RangeError)
      return {
        ok: false,
        response: new Response("MCP request is too large.", {
          status: 413,
          headers: MCP_HEADERS,
        }),
      };
    return {
      ok: false,
      response: rpcError(null, -32700, "Parse error: body was not JSON."),
    };
  }
}

async function loadResource<T>(
  client: McpViewer["client"],
  read: () => Promise<T>
): Promise<T | undefined> {
  try {
    return await withSuppliedClientStore(client, read);
  } catch (error) {
    console.error("[mcp] resource failed", error);
    return undefined;
  }
}
