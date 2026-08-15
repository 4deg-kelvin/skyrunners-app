/**
 * The MCP server again, with the token in the URL instead of a header.
 *
 * ===========================================================================
 * Why this route exists
 * ===========================================================================
 *
 * claude.ai and the Claude desktop app cannot send a custom header. Their "add a
 * custom connector" dialog takes a URL and nothing else — so a server that reads
 * only `Authorization` is usable from Claude Code and from nowhere else, which is
 * exactly what Anish ran into.
 *
 * Everything here is delegated to `lib/mcp/handler.ts` with `viaUrl: true`, which
 * forces the connection READ-ONLY. The reasoning is in that file's header and it
 * is not squeamishness: Vercel logs the path of every request, so a token in a URL
 * is a credential sitting in plain text in the platform's logs. That is an
 * acceptable trade for reading — the club's projects and calendar are transparent
 * by design, and this is the same trade already made for the calendar feed — and
 * not an acceptable one for a credential that can change the club's data.
 *
 * So: read anything you can read, change nothing. Writes stay on the header route,
 * where Claude Code works today, and the proper answer for claude.ai is OAuth,
 * scoped in `docs/MCP_SECURITY_REVIEW.md`.
 */

import { NextResponse } from "next/server";

import { handleMcpRequest, parseRpcBody } from "@/lib/mcp/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const parsed = await parseRpcBody(request);
  if (!parsed.ok) return parsed.response;

  const { token } = await context.params;
  return handleMcpRequest(parsed.body, token, { viaUrl: true });
}

/**
 * Pasting a connector URL into a browser is a thing people do to check it.
 *
 * Deliberately says nothing about whether the token is valid: this response is
 * reachable by anybody who has the URL, and "that token is real" is not a fact to
 * hand out for free. The generic sentence is the same either way.
 */
export async function GET() {
  return NextResponse.json(
    {
      name: "skyrunners-mcp",
      transport: "http",
      mode: "read-only",
      hint: "This is an MCP endpoint, not a web page. Paste it into claude.ai → Settings → Connectors → Add custom connector. It can read the club but not change anything; for that, connect Claude Code with the command in Settings → Connect your AI.",
    },
    { status: 200 }
  );
}
