import { Link } from "react-router";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useActionQuery } from "@agent-native/core/client/use-action";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";

const fmt = (c: number | null | undefined) =>
  c == null ? "—" : `$${(c / 100).toFixed(2)}`;

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-emerald-950 text-emerald-300 border-emerald-500/40",
  REVOKED: "bg-rose-950 text-rose-300 border-rose-500/40",
  EXPIRED: "bg-amber-950 text-amber-300 border-amber-500/40",
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

function useClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function meta() {
  return [{ title: "LEASH · Case Resolution" }];
}

export default function CaseResolution() {
  const { caseId = "" } = useParams();
  const now = useClock();
  useSetPageTitle("LEASH · Case Resolution");

  const [contractId, setContractId] = useState<string | null>(null);

  // Query for the run contract data
  const run = useActionQuery("get-run", { contractId: contractId || "" }, { 
    refetchInterval: 2000, 
    enabled: !!contractId 
  });

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

  const errText = (e: unknown): string => {
    const msg = e instanceof Error ? e.message : String(e);
    return msg;
  };

  // Try to find the contract for this case
  useEffect(() => {
    if (caseId && !contractId) {
      // We'd need a new action to find contract by caseId
      // For now, the user should use the chat to resolve the case
    }
  }, [caseId]);

  return (
    <div className="dark mx-auto flex h-full max-w-7xl flex-col gap-6 overflow-y-auto bg-background p-6 text-foreground">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.25em] text-white/40">leash · case resolution</div>
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

      {/* Resolution Flow Explanation */}
      <section className="rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-5">
        <h2 className="mb-4 text-[11px] uppercase tracking-[0.25em] text-emerald-400">How Resolution Works</h2>
        <div className="space-y-4 text-sm text-white/70">
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-semibold">1</div>
            <div>
              <p className="font-semibold text-white">Human creates contract</p>
              <p className="text-white/50">At /run, human defines budget, permitted actions, and expiry</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-sky-500/20 flex items-center justify-center text-sky-400 font-semibold">2</div>
            <div>
              <p className="font-semibold text-white">Agent receives task in chat</p>
              <p className="text-white/50">Human navigates to chat with a prompt asking agent to resolve the case</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-semibold">3</div>
            <div>
              <p className="font-semibold text-white">Agent uses LEASH-governed actions</p>
              <p className="text-white/50">Agent calls inspect-order, issue-refund, draft-response — all enforced by LEASH</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 font-semibold">4</div>
            <div>
              <p className="font-semibold text-white">LEASH enforces boundaries</p>
              <p className="text-white/50">Budget, count, forbidden actions, and delegation limits enforced at execution</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-rose-500/20 flex items-center justify-center text-rose-400 font-semibold">5</div>
            <div>
              <p className="font-semibold text-white">Human inspects & revokes</p>
              <p className="text-white/50">Control room at /run/:contractId shows live receipts; human can revoke anytime</p>
            </div>
          </div>
        </div>
      </section>

      {/* Action Links */}
      <section className="grid gap-4 sm:grid-cols-2">
        <Link
          to="/chat"
          className="rounded-xl border border-sky-500/30 bg-sky-950/30 p-5 text-left hover:border-sky-500/50 transition"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-sky-500/20 flex items-center justify-center text-sky-400">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-white">Open Chat to Resolve</h3>
              <p className="text-sm text-white/50">Chat with the agent to resolve the case using LEASH-governed actions</p>
            </div>
          </div>
        </Link>

        {contractId && (
          <Link
            to={`/run/${contractId}`}
            className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-5 text-left hover:border-emerald-500/50 transition"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-white">Open Control Room</h3>
                <p className="text-sm text-white/50">Watch live enforcement receipts, budget, delegates, and revoke contract</p>
              </div>
            </div>
          </Link>
        )}
      </section>

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
            <div className="p-6 text-sm text-white/40">No receipts yet — the ledger is empty until the agent acts.</div>
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
    </div>
  );
}