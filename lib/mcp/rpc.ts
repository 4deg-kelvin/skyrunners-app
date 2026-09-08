/** Runtime validation: valid JSON is not necessarily a JSON-RPC request. */
export function isRpcRequest(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  if (body.jsonrpc !== "2.0" || typeof body.method !== "string" || !body.method)
    return false;
  if (
    body.id !== undefined &&
    body.id !== null &&
    typeof body.id !== "string" &&
    !(typeof body.id === "number" && Number.isFinite(body.id))
  )
    return false;
  if (
    body.params !== undefined &&
    (!body.params ||
      typeof body.params !== "object" ||
      Array.isArray(body.params))
  )
    return false;
  if (body.method === "tools/call") {
    const args = (body.params as Record<string, unknown> | undefined)
      ?.arguments;
    if (
      args !== undefined &&
      (!args || typeof args !== "object" || Array.isArray(args))
    )
      return false;
  }
  return true;
}
