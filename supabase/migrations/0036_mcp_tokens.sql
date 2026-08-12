-- ===========================================================================
-- 0036_mcp_tokens.sql
--
-- Personal tokens, so a member can point their own AI at the club through the
-- MCP server at /api/mcp.
--
-- Deliberately NOT part of the app snapshot. Every other table in this schema
-- is loaded wholesale into `lib/store/*` on every request, and credentials have
-- no business being in a structure that renders pages. `lib/mcp/*` queries this
-- table directly.
--
-- Ordering: depends on 0001 (profiles). Additive, idempotent.
-- ===========================================================================

create table if not exists mcp_tokens (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references profiles (id) on delete cascade,

  -- What device or client this is for. Exists so revoking means something —
  -- "revoke one of your three tokens" is unanswerable without a name.
  name          text not null,

  -- SHA-256 of the token, hex. NEVER the token itself.
  --
  -- The plaintext is shown once, at creation, and then it is genuinely gone:
  -- a leaked database backup must not hand somebody the club's whole API. This
  -- is also why there is no "show token again" button anywhere in the UI.
  token_hash    text not null unique,

  -- 'read' or 'write'. Read is the default in the UI, because most people
  -- connecting an assistant want to ask questions, and a token that can only
  -- answer them cannot damage anything.
  scope         text not null default 'read'
                  check (scope in ('read', 'write')),

  created_at    timestamptz not null default now(),
  -- Surfaced in Settings so a token nobody uses is visible and revocable.
  last_used_at  timestamptz,
  -- A student's token should not outlive their membership by years.
  expires_at    timestamptz not null default (now() + interval '180 days'),
  revoked_at    timestamptz
);

create index if not exists mcp_tokens_member_idx
  on mcp_tokens (member_id) where revoked_at is null;

-- The MCP server's hot path: hash the presented token, look it up.
create index if not exists mcp_tokens_hash_idx on mcp_tokens (token_hash);

-- --------------------------------------------------------------------------
-- RLS
--
-- A member manages their own tokens and cannot see anybody else's — not even
-- a Co-Lead, and that is on purpose. A token is a credential, not club data.
-- There is no administrative reason to read someone else's, and every reason
-- not to be able to.
--
-- `token_hash` is unreadable by design anyway (it's a hash), but the rows also
-- carry names and usage times, which say a lot about how somebody works.
-- --------------------------------------------------------------------------

alter table mcp_tokens enable row level security;

drop policy if exists mcp_tokens_own_select on mcp_tokens;
drop policy if exists mcp_tokens_own_insert on mcp_tokens;
drop policy if exists mcp_tokens_own_update on mcp_tokens;
drop policy if exists mcp_tokens_own_delete on mcp_tokens;

create policy mcp_tokens_own_select on mcp_tokens
  for select to authenticated using (member_id = auth.uid());

create policy mcp_tokens_own_insert on mcp_tokens
  for insert to authenticated with check (member_id = auth.uid());

-- Revoking is an update (setting `revoked_at`), not a delete: the row is the
-- record that the token existed, and `last_used_at` on a revoked token is how
-- you find out whether it was used before you killed it.
create policy mcp_tokens_own_update on mcp_tokens
  for update to authenticated using (member_id = auth.uid());

create policy mcp_tokens_own_delete on mcp_tokens
  for delete to authenticated using (member_id = auth.uid());

-- ===========================================================================
-- Verify:
--
--   select column_name from information_schema.columns
--   where table_name = 'mcp_tokens' order by ordinal_position;
--
--   select policyname, cmd from pg_policies
--   where tablename = 'mcp_tokens' order by cmd;
--   -- expect four, all scoped to auth.uid().
-- ===========================================================================
