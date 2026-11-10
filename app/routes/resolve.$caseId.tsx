import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router";
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
  pending: "text-white/40 border-white/10 bg-white/[0.02]",
  running: "text-sky-300 border-sky-500/30 bg-sky-950/20 animate-pulse",
  approved: "text-emerald-300 border-emerald-500/30 bg-emerald-950/20",
  rejected: "text-rose-300 border-rose-500/30 bg-rose-950/20",
  replayed: "text-fuchsia-300 border-fuchsia-500/30 bg-fuchsia-950/20",
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
  const navigate = useNavigate();
  const now = useClock();
  useSetPageTitle("LEASH · Autonomous Resolution");

  const [contractId, setContractId] = useState<string | null>(null);
  const [resolution, setResolution] = useState<any>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [stepStatus, setStepStatus] = useState<Record<string, "pending" | "running" | "approved" | "rejected" | "replayed">>({});

  const resolve = useActionMutation("resolve-case", {
    onSettled: () => run.refetch(),
  });

  const revoke = useActionMutation("revoke-contract", { onSettled: () => run.refetch() });

  // Query for the run contract data - we need to find the contract for this case first
  const run = useActionQuery("get-run", { contractId: contractId || "" }, { 
    refetchInterval: 2000, 
    enabled: !!contractId 
  });

  const errText = (e: unknown): string => {
    const msg = e instanceof Error ? e.message : String(e);
    return msg;
  };

  // Start autonomous resolution
  const startResolution = async () => {
    if (!caseId) return;
    setIsResolving(true);
    setResolution(null);
    setStepStatus({});
    setCurrentStep("inspect-order");

    try {
      const requestId = `resolve-${Date.now()}`;
      const result = await resolve.mutateAsync({
        caseId,
        requestIdPrefix: requestId,
        maxRefundAmountCents: 2500, // $25 max
      });

      if (result.ok && result.resolution) {
        setResolution(result.resolution);
        setContractId(result.contractId);
        // Simulate step progression for UI
        for (const step of STEP_ORDER) {
          setCurrentStep(step);
          setStepStatus(prev => ({ ...prev, [step]: "running" }));
          await new Promise(r => setTimeout(r, 800));
          const stepResult = result.resolution.steps.find((s: any) => s.step === step);
          setStepStatus(prev => ({ ...prev, [step]: stepResult?.outcome === "approved" ? "approved" : "rejected" }));
        }
        setCurrentStep(null);
      }
    } catch (error) {
      console.error("Resolution failed:", error);
    } finally {
      setIsResolving(false);
    }
  };

  const c = run.data?.contract;
  const case_ = run.data?.case as
    | { customer: string; orderRef: string; orderTotalCents: number; complaint: string }
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

      {/* Budget Bar */}
      {c && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-2 flex justify-between text-xs text-white/50">
            <span>
              spent {fmt(c.spentCents)} · refunds {c.refundsUsed}/{c.maxRefunds}
            </span>
            <span>{height}% of ceiling</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${height}%`, background: "linear-gradient(90deg,#34d399,#fbbf24,#fb7185)" }}
            />
          </div>
        </div>
      )}

      {/* Autonomous Agent Execution */}
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
              Agent working…
            </span>
          )}
          {resolution && (
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              resolution.status === "resolved_with_refund"
                ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-300"
                : "border-amber-500/40 bg-amber-950/40 text-amber-300"
            }`}>
              {resolution.status === "resolved_with_refund" ? "Resolved with Refund" : "Resolved (No Refund)"}
            </span>
          )}
        </div>

        {/* Step Timeline */}
        <div className="space-y-3">
          {STEP_ORDER.map((stepKey) => {
            const status = stepStatus[stepKey] || "pending";
            const stepResult = resolution?.steps?.find((s: any) => s.step === stepKey);
            const isCurrent = currentStep === stepKey;
            
            return (
              <div
                key={stepKey}
                className={`flex items-center gap-4 rounded-xl border p-4 transition-all ${STEP_STYLES[status]}`}
              >
                <div className="flex items-center gap-3 min-w-[180px]">
                  <div className={`size-8 flex items-center justify-center rounded-full border-2 font-mono text-xs ${
                    status === "pending" ? "border-white/20 text-white/30" :
                    status === "running" ? "border-sky-400 text-sky-400 animate-pulse" :
                    status === "approved" ? "border-emerald-400 text-emerald-400" :
                    status === "rejected" ? "border-rose-400 text-rose-400" :
                    "border-fuchsia-400 text-fuchsia-400"
                  }`}>
                    {status === "pending" ? "⏳" : status === "running" ? "⚙️" : status === "approved" ? "✓" : status === "rejected" ? "✗" : "↻"}
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
                        `Refund: $${(stepResult.details.determinedRefundCents / 100).toFixed(2)} · ${stepResult.details.resolutionReason}`
                      ) : stepKey === "execute-refund" && stepResult.details ? (
                        `Refund executed: $${(stepResult.details.amountCents / 100).toFixed(2)}`
                      ) : stepKey === "draft-response" && stepResult.details ? (
                        `Response drafted (${stepResult.details.draft?.length || 0} chars)`
                      ) : "Completed"
                    ) : (
                      `Rejected: ${stepResult.details?.message || stepResult.details?.reason || "Unknown"}`
                    )}
                  </div>
                )}

                {isCurrent && status === "running" && (
                  <div className="text-xs text-sky-400 animate-pulse">Processing…</div>
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
                {resolution.status === "resolved_with_refund" ? "Resolved with Refund" : "Resolved (No Refund)"}
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

      {/* Receipts Timeline */}
      <section>
        <h2 className="mb-3 text-[11px] uppercase tracking-[0.25em] text-white/40">Execution Receipts</h2>
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

      {/* Contract Controls */}
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
          </div>
        </section>
      )}
    </div>
  );
}