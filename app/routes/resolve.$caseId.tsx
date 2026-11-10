import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { useActionMutation, useActionQuery } from "@agent-native/core/client/use-action";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";

const fmt = (c: number | null | undefined) =>
  c == null ? "—" : `$${(c / 100).toFixed(2)}`;

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-emerald-950 text-emerald-300 border-emerald-500/40",
  REVOKED: "bg-rose-950 text-rose-300 border-rose-500/40",
  EXPIRED: "bg-amber-950 text-amber-300 border-amber-500/40",
};

const STEP_STYLES: Record<string, string> = {
  approved: "text-emerald-300 border-emerald-500/30 bg-emerald-950/20",
  rejected: "text-rose-300 border-rose-500/30 bg-rose-950/20",
  replayed: "text-fuchsia-300 border-fuchsia-500/30 bg-fuchsia-950/20",
  skipped: "text-amber-300 border-amber-500/30 bg-amber-950/20",
};

const RECEIPT_STYLES: Record<string, string> = {
  ISSUED: "text-zinc-300 border-zinc-500/30",
  DELEGATED: "text-sky-300 border-sky-500/30",
  EXECUTED: "text-emerald-300 border-emerald-500/30",
  REJECTED: "text-rose-300 border-rose-500/30",
  REPLAYED: "text-fuchsia-300 border-fuchsia-500/30",
  RELEASED: "text-amber-300 border-amber-500/30",
  REVOKED: "text-rose-200 border-rose-400/40",
  REFUND_ISSUED: "text-emerald-300 border-emerald-500/30",
  CASE_RESOLVED: "text-emerald-300 border-emerald-500/30",
};

const STEP_ORDER = [
  "inspect-order",
  "determine-resolution",
  "execute-refund",
  "draft-response",
  "close-case",
] as const;

const STEP_LABELS: Record<string, string> = {
  "inspect-order": "Inspect Order",
  "determine-resolution": "Determine Resolution",
  "execute-refund": "Execute Refund",
  "draft-response": "Draft Response",
  "close-case": "Close Case",
};

const STEP_ICONS: Record<string, string> = {
  "inspect-order": "🔍",
  "determine-resolution": "🧠",
  "execute-refund": "💰",
  "draft-response": "✍️",
  "close-case": "✅",
};

const STEP_DESCRIPTIONS: Record<string, string> = {
  "inspect-order": "Read the support case and order details",
  "determine-resolution": "Analyze complaint, calculate refund amount",
  "execute-refund": "Attempt refund through LEASH gate",
  "draft-response": "Draft customer response",
  "close-case": "Record resolution status",
};

function useClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function meta() {
  return [{ title: "LEASH · Autonomous Resolution" }];
}

export default function AutonomousResolution() {
  const { caseId = "" } = useParams();
  const now = useClock();
  useSetPageTitle("LEASH · Autonomous Resolution");

  const [contractId, setContractId] = useState<string | null>(null);
  const [resolution, setResolution] = useState<any>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [executionError, setExecutionError] = useState<string | null>(null);

  const resolve = useActionMutation("resolve-case", {
    onSettled: () => run.refetch(),
  });

  const revoke = useActionMutation("revoke-contract", { onSettled: () => run.refetch() });
  const testRefund = useActionMutation("issue-refund", { onSettled: () => run.refetch() });

  // Query for the run contract data
  const run = useActionQuery("get-run", { contractId: contractId || "" }, { 
    refetchInterval: 2000, 
    enabled: !!contractId 
  });

  const errText = (e: unknown): string => {
    const msg = e instanceof Error ? e.message : String(e);
    return msg;
  };

  // Start autonomous resolution - no artificial animation
  const startResolution = async () => {
    if (!caseId) return;
    setIsResolving(true);
    setResolution(null);
    setExecutionError(null);

    try {
      const requestId = `resolve-${Date.now()}`;
      const result = await resolve.mutateAsync({
        caseId,
        requestIdPrefix: requestId,
      });

      if (result.ok && result.resolution) {
        setResolution(result.resolution);
        setContractId(result.contractId);
      }
    } catch (error) {
      setExecutionError(errText(error));
    } finally {
      setIsResolving(false);
    }
  };

  // Attempt an action after revocation to demonstrate enforcement
  const testRevocation = async () => {
    if (!contractId || !c) return;
    await testRefund.mutateAsync({
      caseId: c.caseId,
      amountCents: 100,
      requestId: `test-revoked-${Date.now()}`,
    });
  };

  const c = run.data?.contract;
  const case_ = run.data?.case as
    | { customer: string; orderRef: string; orderTotalCents: number; complaint: string; status?: string; resolutionRefundCents?: number; resolutionReason?: string }
    | undefined;
  const receipts: Array<{
    id: string; type: string; action: string | null; caller: string;
    amountCents: number | null; code: string | null; detail?: string | null; createdAt: number;
  }> = run.data?.receipts ?? [];
  const delegates: Array<{
    label: string; permittedActions: string[]; maxRefunds: number; budgetCapCents: number;
  }> = run.data?.delegates ?? [];

  const height = c ? Math.min(100, Math.round((c.spentCents / Math.max(1, c.budgetCents)) * 100)) : 0;
  const secondsLeft = c ? Math.max(0, Math.floor((c.expiresAt - now) / 1000)) : null;
  const mm = secondsLeft == null ? "--" : String(Math.floor(secondsLeft / 60));
  const ss = secondsLeft == null ? "--" : String(secondsLeft % 60).padStart(2, "0");

  // Derive step status from actual resolution steps (not artificial animation)
  const stepStatus = useMemo(() => {
    if (!resolution?.steps) return {};
    const status: Record<string, "approved" | "rejected" | "replayed" | "skipped"> = {};
    for (const step of resolution.steps) {
      status[step.step] = step.outcome === "approved" ? "approved" : 
                           step.outcome === "rejected" ? "rejected" :
                           step.outcome === "replayed" ? "replayed" : "skipped";
    }
    return status;
  }, [resolution]);

  // Determine if this is the key enforcement demo (budget exceeded)
  const isBudgetExceededDemo = resolution?.status === "partial_refund_rejected";

  return (
    <div className="dark mx-auto flex h-full max-w-7xl flex-col gap-6 overflow-y-auto bg-background p-6 text-foreground">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.25em] text-white/40">leash · autonomous resolution</div>
          <h1 className="text-2xl font-semibold">
            Support Case Resolution
            {c && (
              <span className={`ml-3 inline-block rounded-full border px-2 py-0.5 align-middle text-xs ${STATUS_STYLES[c.status] ?? ""}`}>
                {c.status}
              </span>
            )}
          </h1>
          <div className="mt-1 text-sm text-white/50">
            {case_?.customer ?? "—"} · order {case_?.orderRef ?? "—"} · {fmt(case_?.orderTotalCents)}
          </div>
        </div>
        <div className="text-right">
          {c && (
            <>
              <div className="text-4xl font-semibold tabular-nums">{fmt(c.remainingCents)}</div>
              <div className="text-xs text-white/40">remaining of {fmt(c.budgetCents)} ceiling</div>
            </>
          )}
          {secondsLeft != null && (
            <div className="mt-1 text-xs tabular-nums text-white/50">
              {mm}:{ss} to expiry
            </div>
          )}
        </div>
      </header>

      {run.isError && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 p-4 text-sm text-rose-200">
          Failed to load run: {errText(run.error)}
        </div>
      )}

      {executionError && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 p-4 text-sm text-rose-200">
          Resolution failed: {executionError}
        </div>
      )}

      {/* Budget Bar - highlight enforcement */}
      {c && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-2 flex justify-between text-xs text-white/50">
            <span>
              spent {fmt(c.spentCents)} · refunds {c.refundsUsed}/{c.maxRefunds}
              {isBudgetExceededDemo && (
                <span className="ml-2 rounded-full border border-rose-500/40 bg-rose-950/40 px-2 py-0.5 text-xs text-rose-300">
                  LEASH ENFORCED: budget exceeded
                </span>
              )}
            </span>
            <span>{height}% of ceiling</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${height}%`, background: isBudgetExceededDemo 
                ? "linear-gradient(90deg,#fb7185,#f87171)" 
                : "linear-gradient(90deg,#34d399,#fbbf24,#fb7185)" }}
            />
          </div>
          {isBudgetExceededDemo && (
            <p className="mt-2 text-sm text-rose-300 font-mono">
              Agent determined ${fmt(resolution.determinedRefundCents)} refund · Contract ceiling: ${fmt(c.budgetCents)} · REJECTED: budget_exceeded
            </p>
          )}
        </div>
      )}

      {/* Autonomous Agent Execution - REAL steps from action result */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[11px] uppercase tracking-[0.25em] text-white/40">Agent Execution</h2>
          {!isResolving && !resolution && (
            <button
              onClick={startResolution}
              disabled={isResolving}
              className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-4 py-2 font-semibold text-emerald-200 transition hover:bg-emerald-900/50 disabled:opacity-40"
            >
              Start Autonomous Resolution
            </button>
          )}
          {isResolving && (
            <span className="flex items-center gap-2 text-sm text-sky-300">
              <span className="size-2 rounded-full bg-sky-400 animate-pulse" />
              Agent executing…
            </span>
          )}
          {resolution && (
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              resolution.status === "resolved_with_refund"
                ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-300"
                : resolution.status === "partial_refund_rejected"
                ? "border-rose-500/40 bg-rose-950/40 text-rose-300"
                : "border-amber-500/40 bg-amber-950/40 text-amber-300"
            }`}>
              {resolution.status === "resolved_with_refund" ? "Resolved with Refund" : 
               resolution.status === "partial_refund_rejected" ? "Refund Rejected by LEASH (Budget Enforced)" :
               "Resolved (No Refund)"}
            </span>
          )}
        </div>

        {/* Step Timeline - derived from actual execution results */}
        <div className="space-y-3">
          {STEP_ORDER.map((stepKey) => {
            const status = stepStatus[stepKey] || "pending";
            const stepResult = resolution?.steps?.find((s: any) => s.step === stepKey);
            
            // Only show steps that were actually executed/attempted
            if (!stepResult && status === "pending") return null;
            
            const isKeyEnforcementStep = stepKey === "execute-refund" && stepResult?.outcome === "rejected";
            
            return (
              <div
                key={stepKey}
                className={`flex items-center gap-4 rounded-xl border p-4 transition-all ${STEP_STYLES[status] || "text-white/40 border-white/10 bg-white/[0.02]"}`}
              >
                <div className="flex items-center gap-3 min-w-[180px]">
                  <div className={`size-8 flex items-center justify-center rounded-full border-2 font-mono text-xs ${
                    status === "approved" ? "border-emerald-400 text-emerald-400" :
                    status === "rejected" ? "border-rose-400 text-rose-400" :
                    status === "replayed" ? "border-fuchsia-400 text-fuchsia-400" :
                    status === "skipped" ? "border-amber-400 text-amber-400" :
                    "border-white/20 text-white/30"
                  }`}>
                    {STEP_ICONS[stepKey] || (status === "approved" ? "✓" : status === "rejected" ? "✗" : status === "replayed" ? "↻" : "⏳")}
                  </div>
                  <div>
                    <div className="font-medium">{STEP_LABELS[stepKey]}</div>
                    <div className="text-xs text-white/50 font-mono">{stepKey}</div>
                  </div>
                </div>
                
                {stepResult && (
                  <div className="flex-1 min-w-0 text-sm text-white/70 font-mono">
                    {stepResult.outcome === "approved" ? (
                      stepKey === "determine-resolution" && stepResult.details ? (
                        <>
                          Refund determined: <span className="text-emerald-300">${fmt(stepResult.details.determinedRefundCents)}</span>{' '}
                          <span className="text-white/50">(contract budget: {fmt(stepResult.details.contractBudgetCents)})</span>
                        </>
                      ) : stepKey === "execute-refund" && stepResult.details ? (
                        stepResult.details.amountCents ? (
                          <>Refund executed: <span className="text-emerald-300">${fmt(stepResult.details.amountCents)}</span></>
                        ) : (
                          <>Rejected: <span className="text-rose-300">{stepResult.details.message || stepResult.details.reason || "LEASH rejected"}</span></>
                        )
                      ) : stepKey === "draft-response" && stepResult.details ? (
                        `Response drafted (${stepResult.details.draft?.length || 0} chars)`
                      ) : "Completed"
                    ) : (
                      <>Rejected: <span className="text-rose-300">{stepResult.details?.message || stepResult.details?.reason || stepResult.details?.code || "Unknown"}</span></>
                    )}
                  </div>
                )}

                {status === "pending" && (
                  <div className="text-xs text-white/40">Not reached</div>
                )}

                {/* Key enforcement indicator */}
                {isKeyEnforcementStep && (
                  <div className="flex items-center gap-1.5 rounded-full border border-rose-500/40 bg-rose-950/40 px-2 py-0.5 text-xs text-rose-300">
                    <span className="size-1.5 rounded-full bg-rose-400" />
                    ENFORCED
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Resolution Details */}
      {resolution && (
        <section className="rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-5">
          <h2 className="mb-4 text-[11px] uppercase tracking-[0.25em] text-emerald-400">Resolution Outcome</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="text-xs text-white/40">Status</div>
              <div className="font-semibold text-emerald-300">
                {(() => {
                  switch (resolution.status) {
                    case "resolved_with_refund": return "Resolved with Refund";
                    case "resolved_no_refund": return "Resolved (No Refund)";
                    case "partial_refund_rejected": return "Refund Rejected by LEASH (Budget Enforced)";
                    case "partial_response_failed": return "Partial — Response Failed";
                    case "failed": return "Failed — Required Action Failed";
                    default: return resolution.status;
                  }
                })()}
              </div>
            </div>
            <div>
              <div className="text-xs text-white/40">Refund Amount</div>
              <div className="font-semibold text-white tabular-nums">{fmt(resolution.refundAmountCents)}</div>
            </div>
            <div className="sm:col-span-2">
              <div className="text-xs text-white/40">Reason</div>
              <div className="font-mono text-sm text-white/80">{resolution.resolutionReason}</div>
            </div>
            <div className="sm:col-span-2">
              <div className="text-xs text-white/40">Customer Response</div>
              <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70 whitespace-pre-wrap font-mono">
                {resolution.customerResponse}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Case Status from DB */}
      {case_ && case_.status && (
        <section className="rounded-2xl border border-sky-500/20 bg-sky-950/20 p-4">
          <h2 className="mb-3 text-[11px] uppercase tracking-[0.25em] text-sky-400">Case Record</h2>
          <div className="grid gap-2 sm:grid-cols-3 text-sm">
            <div>
              <div className="text-xs text-white/40">Case Status</div>
              <div className="font-semibold text-sky-300">{case_.status}</div>
            </div>
            <div>
              <div className="text-xs text-white/40">Recorded Refund</div>
              <div className="font-semibold text-white tabular-nums">{fmt(case_.resolutionRefundCents)}</div>
            </div>
            <div>
              <div className="text-xs text-white/40">Reason</div>
              <div className="font-mono text-white/70 truncate">{case_.resolutionReason}</div>
            </div>
          </div>
        </section>
      )}

      {/* Delegates */}
      {delegates.length > 0 && (
        <section>
          <h2 className="mb-3 text-[11px] uppercase tracking-[0.25em] text-white/40">Delegates</h2>
          <div className="flex flex-wrap gap-2">
            {delegates.map((d) => (
              <div key={d.label} className="rounded-xl border border-sky-500/30 bg-sky-950/30 px-3 py-2 text-xs text-sky-200">
                <div className="font-semibold">{d.label}</div>
                <div className="opacity-70">
                  {d.permittedActions.join(", ")} · refunds {d.maxRefunds} · cap {fmt(d.budgetCapCents)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Receipts Timeline - REAL events from contract ledger */}
      <section>
        <h2 className="mb-3 text-[11px] uppercase tracking-[0.25em] text-white/40">Execution Receipts (Contract Ledger)</h2>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03]">
          {receipts.length === 0 && (
            <div className="p-6 text-sm text-white/40">No receipts yet — the ledger is empty until the run starts.</div>
          )}
          <ul className="divide-y divide-white/5">
            {receipts.map((r) => (
              <li key={r.id} className={`flex flex-wrap items-center justify-between gap-2 border-l-4 bg-white/[0.02] px-4 py-2.5 text-sm ${RECEIPT_STYLES[r.type] ?? "border-white/20 text-white/70"}`}>
                <span className="font-mono text-xs uppercase">{r.type}{r.code ? ` · ${r.code}` : ""}</span>
                <span className="text-xs text-white/60">
                  {r.action ?? "—"} · {r.caller}
                  {r.amountCents != null && r.amountCents > 0 && ` · ${fmt(r.amountCents)}`}
                </span>
                <time className="font-mono text-[11px] text-white/30">
                  {new Date(r.createdAt).toLocaleTimeString()}
                </time>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Contract Controls - including revocation test */}
      {c && c.status === "ACTIVE" && (
        <section className="rounded-2xl border border-rose-500/20 bg-rose-950/20 p-4">
          <h2 className="mb-3 text-[11px] uppercase tracking-[0.25em] text-rose-400">Contract Controls</h2>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => revoke.mutate({ contractId: c.id })}
              disabled={revoke.isPending}
              className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-2 font-semibold text-rose-200 transition hover:bg-rose-900/50 disabled:opacity-40"
            >
              Revoke Contract
            </button>
            {resolution && (
              <button
                onClick={testRevocation}
                disabled={revoke.isPending}
                className="rounded-xl border border-amber-500/40 bg-amber-950/40 px-4 py-2 font-semibold text-amber-200 transition hover:bg-amber-900/50 disabled:opacity-40"
              >
                Test Enforcement After Revocation
              </button>
            )}
          </div>
          <p className="mt-2 text-xs text-white/50">
            Revocation takes effect immediately. Any subsequent action will be rejected with "contract_revoked".
          </p>
        </section>
      )}
    </div>
  );
}