/**
 * Caller resolution — one place where dispatch surfaces become LEASH caller strings.
 * Uses framework-verified context: ctx.caller, ctx.mcpClient.name (real, external),
 * ctx.delegationDepth (real sub-agent provenance).
 */
import type { ActionRunContext } from "@agent-native/core/action";

export interface CallParams {
  childLabel?: string;
}

export function resolveCaller(input: CallParams, ctx?: ActionRunContext): string {
  if (input?.childLabel) {
    const depth = ctx?.delegationDepth != null ? `:d${ctx.delegationDepth}` : "";
    return `subagent:${input.childLabel}${depth}`;
  }
  const base = ctx?.caller ?? "unknown";
  if (base === "mcp" && ctx?.mcpClient?.name) {
    return `mcp:${ctx.mcpClient.name}${ctx.mcpClient.oauthClientId ? ` (${ctx.mcpClient.oauthClientId})` : ""}`;
  }
  return typeof base === "string" ? base : String(base);
}
