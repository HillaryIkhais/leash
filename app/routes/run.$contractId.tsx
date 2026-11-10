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

const RECEIPT_STYLES: Record<string, string> = {
  ISSUED: "text-zinc-300 border-zinc-500/30",
  DELEGATED: "text-sky-300 border-sky-500/30",
  EXECUTED: "text-emerald-300 border-emerald-500/30",
  REJECTED: "text-rose-300 border-rose-500/30",
  REPLAYED: "text-fuchsia-300 border-fuchsia-500/30",
  RELEASED: "text-amber-300 border-amber-500/30",
  REVOKED: "text-rose-200 border-rose-400/40",
  REFUND_ISSUED: "text-emerald-300 border-emerald-500/30",
};

function newRequestId(tag: string) {
  return `${tag}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function useClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function meta() {
  return [{ title: "LEASH · Run control" }];
}

export default function RunControl() {
  const { contractId = "" } = useParams();
  const now = useClock();
  useSetPageTitle("LEASH · Run control");

  const run = useActionQuery("get-run", { contractId }, { refetchInterval: 4000 });

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

  const [lastRefundReceipt, setLastRefundReceipt] = useState<string | null>(null);

  // Mutations — same actions, same gate the agent uses, frontend surface
  const refund = useActionMutation("issue-refund", {
    onSettled: () => run.refetch(),
  });
  const inspect = useActionMutation("inspect-order", { onSettled: () => run.refetch() });
  const draft = useActionMutation("draft-response", { onSettled: () => run.refetch() });
  const owner = useActionMutation("change-account-owner", { onSettled: () => run.refetch() });
  const revoke = useActionMutation("revoke-contract", { onSettled: () => run.refetch() });
  const delegate = useActionMutation("delegate-contract", { onSettled: () => run.refetch() });

  const errText = (e: unknown): string => {
    const msg = e instanceof Error ? e.message : String(e);
    return msg;
  };

  // The beats, as callable one-taps
  const beat = (tag: string, fn: () => void, tone: string, caption: string) => (
    <button
      key={tag}
      onClick={fn}
      disabled={run.isFetching || (c ?? { status: "" }).status !== "ACTIVE"}
      className={`group relative flex flex-col items-start gap-1 rounded-xl border p-4 text-left transition
        ${tone} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <span className="text-sm font-semibold">{tag}</span>
      <span className="text-xs text-white/50">{caption}</span>
    </button>
  );

  return (
    <div className="dark mx-auto flex h-full max-w-6xl flex-col gap-6 overflow-y-auto bg-background p-6 text-foreground">
      {/* Authority Contract Visualization */}
      {c && (
        <div className="relative rounded-2xl border border-emerald-500/25 bg-zinc-950/80 shadow-[0_0_60px_-15px_rgba(16,185,129,0.15)] overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-white/40">
              active run contract
            </span>
            <span className={`flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${STATUS_STYLES[c.status] ?? ""}`}>
              <span className="relative inline-flex size-2">
                <span className="absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping" style={{ backgroundColor: c.status === "ACTIVE" ? "#34d399" : c.status === "REVOKED" ? "#fb7185" : "#fbbf24" }} />
                <span className="relative inline-flex size-2 rounded-full" style={{ backgroundColor: c.status === "ACTIVE" ? "#34d399" : c.status === "REVOKED" ? "#fb7185" : "#fbbf24" }} />
              </span>
              {c.status}
            </span>
          </div>

          <div className="grid grid-cols-3 divide-x divide-white/10 border-b border-white/10 px-5 py-4">
            {[
              { label: "refund ceiling", value: fmt(c.budgetCents) },
              { label: "max refunds", value: `${c.maxRefunds}` },
              { label: "lifetime", value: secondsLeft != null ? `${mm}:${ss}` : "expired" },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className="font-mono text-2xl font-semibold tabular-nums text-white">{s.value}</div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-white/40">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 px-5 py-3">
            {c.permittedActions.map((a: string) => (
              <span
                key={a}
                className="rounded-full border border-emerald-500/40 bg-emerald-950/40 px-2.5 py-1 font-mono text-[11px] text-emerald-300"
              >
                {a}
              </span>
            ))}
            {c.forbiddenActions.map((a: string) => (
              <span
                key={a}
                className="rounded-full border border-rose-500/40 bg-rose-950/40 px-2.5 py-1 font-mono text-[11px] text-rose-300 line-through decoration-rose-400/60"
              >
                {a}
              </span>
            ))}
          </div>

          {/* Budget Progress */}
          <div className="border-t border-white/10 px-5 py-4">
            <div className="flex justify-between text-xs text-white/50 mb-2">
              <span>spent {fmt(c.spentCents)} of {fmt(c.budgetCents)} · refunds {c.refundsUsed}/{c.maxRefunds}</span>
              <span>{height}% consumed</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${height}%`, background: "linear-gradient(90deg,#34d399,#fbbf24,#fb7185)" }}
              />
            </div>
          </div>

          {/* Authority Flow Visualization */}
          <div className="border-t border-white/10 px-5 py-3">
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/40 mb-2">Authority Flow</div>
            <div className="space-y-1.5 font-mono text-[11px]">
              <div className="flex items-center gap-2 text-emerald-400">
                <span className="size-1.5 rounded-full bg-emerald-400" /> Human issued contract
              </div>
              <div className="flex items-center gap-2 text-white/60 ml-2 border-l border-white/10 pl-2">
                <span className="size-1.5 rounded-full bg-sky-400" /> Root agent (full envelope)
              </div>
              {delegates.length > 0 && delegates.map((d) => (
                <div key={d.label} className="flex items-center gap-2 text-white/50 ml-2 border-l border-white/10 pl-2">
                  <span className="size-1.5 rounded-full bg-purple-400" /> Child: {d.label} (attenuated)
                </div>
              ))}
              <div className="flex items-center gap-2 text-rose-400 ml-2 border-l border-rose-500/30 pl-2">
                <span className="size-1.5 rounded-full bg-rose-400" /> Revocation terminates all
              </div>
            </div>
          </div>
        </div>
      )}

      {/* header */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.25em] text-white/40">leash · active run</div>
          <h1 className="text-2xl font-semibold">
            {c?.title ?? "Loading run…"}
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
          <div className="text-4xl font-semibold tabular-nums">{fmt(c?.remainingCents)}</div>
          <div className="text-xs text-white/40">remaining of {fmt(c?.budgetCents)} ceiling</div>
          {secondsLeft != null && (
            <div className="mt-1 text-xs tabular-nums text-white/50">
              {mm}:{ss} to expiry
            </div>
          )}
        </div>
      </header>

      {/* beats */}
      <section>
        <h2 className="mb-3 text-[11px] uppercase tracking-[0.25em] text-white/40">Enforcement beats</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {beat(
            "Inspect order",
            () => inspect.mutate({ caseId: c?.caseId ?? contractId, requestId: newRequestId("inspect") }),
            "border-sky-500/30 bg-sky-950/30 text-sky-200",
            "permitted read · expected EXECUTED",
          )}
          {beat(
            "Refund $18.00",
            () => {
              const rid = newRequestId("refund1800");
              setLastRefundReceipt(rid);
              refund.mutate({ caseId: c?.caseId ?? contractId, amountCents: 1800, requestId: rid });
            },
            "border-emerald-500/30 bg-emerald-950/30 text-emerald-200",
            "legit refund · expected EXECUTED",
          )}
          {beat(
            "Refund $70.00",
            () => refund.mutate({ caseId: c?.caseId ?? contractId, amountCents: 7000, requestId: newRequestId("refund7000") }),
            "border-amber-500/30 bg-amber-950/30 text-amber-200",
            "over ceiling · expected REJECTED budget_exceeded",
          )}
          {beat(
            "Change account owner",
            () => owner.mutate({ caseId: c?.caseId ?? contractId, newOwner: "attacker@mail.com", requestId: newRequestId("owner") }),
            "border-rose-500/30 bg-rose-950/30 text-rose-200",
            "forbidden action · expected REJECTED forbidden_action",
          )}
          {beat(
            "Delegate child (narrower)",
            () =>
              delegate.mutate({
                contractId,
                parentLabel: "",
                childLabel: "ops-child",
                permittedActions: ["inspect-order", "draft-response"],
                maxRefunds: 0,
                budgetCapCents: 0,
              }),
            "border-purple-500/30 bg-purple-950/30 text-purple-200",
            "child envelope: no refunds, no money",
          )}
          {beat(
            "Child tries refund $1",
            () =>
              refund.mutate({
                caseId: c?.caseId ?? contractId,
                amountCents: 100,
                requestId: newRequestId("child-refund"),
              }),
            "border-rose-500/30 bg-rose-950/30 text-rose-200",
            "child outside envelope · REJECTED",
          )}
          {beat(
            "Replay last refund",
            () => {
              if (!lastRefundReceipt) return;
              refund.mutate({ caseId: c?.caseId ?? contractId, amountCents: 1800, requestId: lastRefundReceipt });
            },
            "border-fuchsia-500/30 bg-fuchsia-950/30 text-fuchsia-200",
            lastRefundReceipt ? "same requestId · expected REPLAYED, never twice" : "run a refund first",
          )}
          {beat(
            "Revoke run",
            () => revoke.mutate({ contractId }),
            "border-white/30 bg-white/10 text-white",
            "human-only · kills every held authorization",
          )}
        </div>
      </section>

      {/* delegates */}
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

      {/* receipts */}
      <section>
        <h2 className="mb-3 text-[11px] uppercase tracking-[0.25em] text-white/40">Execution receipts</h2>
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
    </div>
  );
}
