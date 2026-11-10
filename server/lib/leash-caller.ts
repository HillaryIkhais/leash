/**
 * Caller resolution — one place where dispatch surfaces become LEASH caller strings.
 * Uses framework-verified context: ctx.caller, ctx.mcpClient.name (real, external),
 * ctx.delegationDepth (real sub-agent provenance).
 *
 * CRITICAL: Child agent identity is now resolved from the framework's verified
 * delegation context, NOT from caller-supplied input. The input.childLabel is
 * ignored for identity — only the framework's delegation context and the registered
 * delegate label from the contract are trusted.
 */
import type { ActionRunContext } from "@agent-native/core/action";

export interface CallParams {
  /** Legacy field — IGNORED for identity. Kept for backwards compatibility. */
  childLabel?: string | undefined;
  /** any other caller-supplied fields the action passed through */
  [extra: string]: unknown;
}

export function resolveCaller(input: CallParams, ctx?: ActionRunContext): string {
  // Framework-verified delegation: if ctx.caller already contains a verified
  // subagent label (format: "subagent:<label>"), use it directly.
  // This happens when the framework spawns a child agent with a registered delegate.
  if (ctx?.caller && typeof ctx.caller === "string" && ctx.caller.startsWith("subagent:")) {
    return ctx.caller;
  }

  // Framework-verified delegation depth without explicit label in caller.
  // The framework provides delegationDepth but the label must come from
  // the registered delegate. For now, return a generic verified caller;
  // the enforcer will fail-closed if the label doesn't match a registered delegate.
  if (ctx?.delegationDepth != null && ctx.delegationDepth > 0) {
    return `subagent:verified:d${ctx.delegationDepth}`;
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
 */
export async function resolveVerifiedDelegateLabel(
  contractId: string,
  delegationDepth: number,
  db: { queryDelegate: (contractId: string, label: string) => Promise<any> }
): Promise<string | null> {
  // In a real implementation, we'd maintain a mapping from delegationDepth
  // to the registered delegate label. For now, we delegate to the enforcer's
  // delegate lookup which uses the caller string's label portion.
  // The key insight: the enforcer extracts the label from the caller string
  // "subagent:<label>" and verifies it against the contractDelegates table.
  // So the caller string MUST contain the verified label.
  return null; // Placeholder - actual resolution happens in enforcer
}
