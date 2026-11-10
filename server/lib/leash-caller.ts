/**
 * Caller resolution — one place where dispatch surfaces become LEASH caller strings.
 * Uses framework-verified context: ctx.caller, ctx.mcpClient.name (real, external),
 * ctx.delegationDepth (real sub-agent provenance).
 *
 * IMPORTANT: The Agent-Native framework does NOT provide cryptographically verified
 * child agent identity. The `ctx.caller` is a fixed union type:
 *   "tool" | "http" | "frontend" | "mcp-widget" | "mcp-widget-write" | "cli" | "mcp" | "webmcp" | "a2a" | "automation"
 * 
 * The framework provides `delegationDepth` (number) but no label. Child agent
 * identity in LEASH is registered in `contractDelegates` and the enforcer trusts
 * the caller string format "subagent:<label>" IF the caller provides it.
 * This is a TRUST MODEL, not a cryptographic guarantee. The framework does not
 * bind delegationDepth to a specific registered label.
 * 
 * For true delegation provenance, the application would need to implement
 * its own agent spawning mechanism that sets a verified caller string.
 */
import type { ActionRunContext } from "@agent-native/core/action";

export interface CallParams {
  /** Legacy field — IGNORED for identity. Kept for backwards compatibility. */
  childLabel?: string | undefined;
  /** any other caller-supplied fields the action passed through */
  [extra: string]: unknown;
}

export function resolveCaller(input: CallParams, ctx?: ActionRunContext): string {
  // If the caller explicitly provides a subagent label (e.g., from a custom
  // agent spawning mechanism that sets ctx.caller), use it.
  // Note: The framework does NOT set caller to "subagent:<label>" by default.
  if (ctx?.caller && typeof ctx.caller === "string" && ctx.caller.startsWith("subagent:")) {
    return ctx.caller;
  }

  // Framework provides delegationDepth but no label. We cannot derive a
  // verified label from depth alone. Return a generic delegation marker.
  // The enforcer will fail-closed if this doesn't match a registered delegate.
  if (ctx?.delegationDepth != null && ctx.delegationDepth > 0) {
    return `subagent:depth:${ctx.delegationDepth}`;
  }

  // No delegation context — use base caller
  const base = ctx?.caller ?? "unknown";
  if (base === "mcp" && ctx?.mcpClient?.name) {
    return `mcp:${ctx.mcpClient.name}${ctx.mcpClient.oauthClientId ? ` (${ctx.mcpClient.oauthClientId})` : ""}`;
  }
  return typeof base === "string" ? base : String(base);
}

/**
 * Resolve the verified delegate label for a given delegation depth.
 * This MUST be called from the enforcer where we have DB access to the
 * contract's delegate registry. Never trust caller-supplied labels.
 * 
 * NOTE: The framework does not bind delegationDepth to a specific label.
 * This function is a placeholder — true binding requires application-level
 * agent spawning that sets ctx.caller to "subagent:<registered-label>".
 */
export async function resolveVerifiedDelegateLabel(
  contractId: string,
  delegationDepth: number,
  db: { queryDelegate: (contractId: string, label: string) => Promise<any> }
): Promise<string | null> {
  // The framework provides delegationDepth but not a label mapping.
  // Without application-level binding, we cannot resolve depth -> label.
  // Return null to indicate unverified identity; enforcer will fail-closed.
  return null;
}
