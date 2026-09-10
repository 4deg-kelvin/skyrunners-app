/** Stateless Streamable HTTP versions supported by the server. */
export const PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
] as const;
export const MCP_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const MAX_BODY_BYTES = 256 * 1024;

export function negotiateVersion(requested: unknown): string {
  return PROTOCOL_VERSIONS.find((v) => v === requested) ?? PROTOCOL_VERSIONS[0];
}

/** A URL credential must itself be read-only. Merely downgrading this request
 * would leave a leaked write token usable on the header endpoint. */
export function connectionScope(
  scope: "read" | "write",
  viaUrl: boolean
): "read" | "write" | null {
  return viaUrl && scope === "write" ? null : scope;
}

export function transportError(request: Request): Response | undefined {
  const origin = request.headers.get("origin");
  const allowed = [
    new URL(request.url).origin,
    "https://chatgpt.com",
    "https://claude.ai",
  ];
  if (origin && !allowed.includes(origin))
    return new Response("Origin is not allowed.", {
      status: 403,
      headers: MCP_HEADERS,
    });
  const version = request.headers.get("mcp-protocol-version");
  if (version && !PROTOCOL_VERSIONS.some((v) => v === version))
    return new Response("Unsupported MCP protocol version.", {
      status: 400,
      headers: MCP_HEADERS,
    });
  return undefined;
}

/** Bound actual bytes, including chunked requests without Content-Length. */
export async function readRpcText(request: Request): Promise<string> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES)
    throw new RangeError("MCP request is too large.");
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RangeError("MCP request is too large.");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** Validate the deliberately small JSON Schema vocabulary used by our tools.
 * No coercion: "false" must never become true, nor an invalid enum a default. */
export function validateArguments(
  value: unknown,
  schema: Record<string, unknown>,
  path = "arguments"
): string | undefined {
  if (Array.isArray(schema.enum) && !schema.enum.includes(value))
    return `${path} must be one of: ${schema.enum.join(", ")}.`;
  switch (schema.type) {
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return `${path} must be an object.`;
      const record = value as Record<string, unknown>;
      const properties = (schema.properties ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      for (const key of (schema.required ?? []) as string[])
        if (!Object.hasOwn(record, key)) return `${path}.${key} is required.`;
      for (const [key, entry] of Object.entries(record)) {
        if (!Object.hasOwn(properties, key)) {
          if (schema.additionalProperties === false)
            return `${path}.${key} is not supported.`;
          continue;
        }
        const problem = validateArguments(
          entry,
          properties[key],
          `${path}.${key}`
        );
        if (problem) return problem;
      }
      return undefined;
    }
    case "array":
      if (!Array.isArray(value)) return `${path} must be an array.`;
      if (value.length > 100)
        return `${path} has too many entries (maximum 100).`;
      for (let i = 0; i < value.length; i++) {
        const problem = validateArguments(
          value[i],
          schema.items as Record<string, unknown>,
          `${path}[${i}]`
        );
        if (problem) return problem;
      }
      return undefined;
    case "string":
      return typeof value !== "string"
        ? `${path} must be text.`
        : value.length > 20000
          ? `${path} is too long.`
          : undefined;
    case "boolean":
      return typeof value === "boolean"
        ? undefined
        : `${path} must be true or false.`;
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? undefined
        : `${path} must be a finite number.`;
    default:
      throw new Error(`Unsupported tool schema type: ${String(schema.type)}`);
  }
}
