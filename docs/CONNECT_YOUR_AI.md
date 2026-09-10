# Connect Codex, ChatGPT or Claude to SkyRunners

The app MCP connection acts as your SkyRunners member account. Read-only tokens
cannot change club data. Write tokens still require project authority, and rare
administrative actions such as deleting projects or changing account roles remain
on the website. AI answers can be wrong; read-only access prevents writes, not errors.

## Make a separate token for each client

In **Settings → Connect your AI**, create a named token. Start with **Read only**.
Copy it immediately: only its hash is stored, and it is shown once. Tokens expire
after 180 days; revoke one in Settings to disconnect that client.

The app URL is `https://skyrunners-app.vercel.app/api/mcp`.
Do not confuse this member connection with the Supabase administration server.

## Codex (desktop, CLI and IDE share configuration)

Set `SKYRUNNERS_MCP_TOKEN` in the environment used to launch Codex. Use your
secret-management mechanism; do not commit the value or paste a secret into a
shared terminal history. Then run:

```sh
codex mcp add skyrunners --url https://skyrunners-app.vercel.app/api/mcp --bearer-token-env-var SKYRUNNERS_MCP_TOKEN
codex mcp list
```

Restart Codex after changing its launch environment or server configuration. In
the CLI, `/mcp` shows the connection. Keep tool approvals enabled, especially for
write tokens. A recommended server setting in `config.toml` is:

```toml
[mcp_servers.skyrunners]
url = "https://skyrunners-app.vercel.app/api/mcp"
bearer_token_env_var = "SKYRUNNERS_MCP_TOKEN"
default_tools_approval_mode = "prompt"
```

Configuration and authentication support: [OpenAI Codex MCP documentation](https://developers.openai.com/codex/mcp/).

## ChatGPT (read-only member tools)

Enable **Settings → Security and login → Developer mode**, then create a custom
app from **Plugins**. Use a separate **read-only** token and the personal URL
shown by SkyRunners Settings. Choose **No authentication** in the app form: the
personal URL itself carries the credential. A regular server URL without the
personal token will not authenticate this connection.

Keep the personal URL private. It may appear in browser history or hosting logs,
and whoever has it can read through your account. **Never put a write token in a
URL.** The endpoint refuses those tokens, and the UI only shows personal URLs for
read-only tokens. Revoke any write token previously used in a personal URL.

ChatGPT supports OAuth, no authentication and mixed authentication for custom MCP
apps; a custom bearer-header field is not the setup path. OAuth-backed member
access with writes is future work. Refresh the app's tools after a server update.
See [ChatGPT developer mode](https://developers.openai.com/api/docs/guides/developer-mode).

## Claude

Claude Code can use a bearer token with the HTTP server. The Settings panel shows
the command; be aware that a command containing a literal token is a secret and
may remain in shell history. Claude web can use the separate read-only personal
URL as a custom connector, with the same precautions as ChatGPT.

## Supabase administration in Codex

The requested project-scoped endpoint is:

```text
https://mcp.supabase.com/mcp?project_ref=ldijsmcnjrihwvxtypqy&features=docs%2Caccount%2Cdatabase%2Cdebugging%2Cdevelopment%2Cfunctions%2Cbranching
```

Add this as `supabase`, authenticate with `codex mcp login supabase`, and verify
with `codex mcp list` or `/mcp`. Quote the entire URL in a shell because it contains
`&`. If scope discovery returns `invalid_scope`, the previously verified explicit
scopes for project/database diagnostics and migrations are
`organizations:read,projects:read,database:read,database:write,analytics:read`.
Additional feature groups may require additional OAuth permissions; do not claim
them verified merely because they are enabled in the URL.

Use `default_tools_approval_mode = "prompt"` on this server too. For unattended
or diagnostic work, use a separate project-scoped connection with `read_only=true`.
Supabase admin access is broader than app-member access. See [Supabase MCP security
recommendations](https://supabase.com/docs/guides/ai-tools/mcp).

The app already uses `@supabase/ssr` and `@supabase/supabase-js`. Connecting an MCP
server does not require installing `@supabase/server` or replacing the app's auth
stack. Do not put a secret/service-role key in a `NEXT_PUBLIC_` variable. The masked
secret and `[YOUR-PASSWORD]` examples are placeholders, not usable credentials.

## What the app tools support

Start with `whoami`, `catch_up`, and `guide`. `get_project` includes item IDs and
waiting-on links. In a write connection, project leadership can use
`create_milestone` for an unassigned checkpoint, `add_waiting_on` for a dependency,
`update_deliverable` for its title/date, and `sign_off_deliverable` to mark it
reached. Milestones count toward project progress, never a member's delivered-work
count. Dependencies warn about date conflicts without changing dates or blocking
completion. `update_project` preserves the start date when it is omitted.

The stateless endpoint negotiates Streamable HTTP versions `2025-03-26`,
`2025-06-18`, and `2025-11-25`. GET returns 405 because it does not open an SSE
stream; POST carries JSON responses. This is expected, not a broken endpoint.
Tool annotations distinguish reads from changes. Arguments are validated before
execution, requests are limited to 256 KiB, external origins are checked, responses
are not cached, and unexpected internal errors are not returned to clients.

Existing write budgets remain: 30 changes/minute and 200/hour per warm instance,
plus the durable limit on empty projects. They limit accidents; they do not make
an authorized write token safe to publish. See `docs/MCP_SECURITY_REVIEW.md`.
