import { Link } from "react-router";

const KILLER_LINE =
  "The framework decides whether a caller may call an action. LEASH decides whether this run may continue.";

const ENVELOPE = {
  ceiling: "$25.00",
  maxRefunds: "1",
  lifetime: "10:00",
  permitted: ["inspect-order", "issue-refund", "draft-response"],
  forbidden: ["change-account-owner"],
};

const PROPERTIES: Array<{ n: string; title: string; body: string }> = [
  {
    n: "01",
    title: "Atomic budget reservation",
    body: "Concurrent calls cannot both spend the last allowance — one cent is indivisible.",
  },
  {
    n: "02",
    title: "Delegation attenuation",
    body: "A child envelope is always narrower than its parent. Widening is a recorded rejection.",
  },
  {
    n: "03",
    title: "Run-wide enforcement",
    body: "One gate for UI, agent, HTTP, and MCP callers. No surface slips through.",
  },
  {
    n: "04",
    title: "Immediate revocation",
    body: "The contract is re-read from the database at every evaluation. No grace for cached tokens.",
  },
  {
    n: "05",
    title: "Idempotency",
    body: "Replaying a requestId can never double-execute. Networks retry; LEASH does not double-pay.",
  },
  {
    n: "06",
    title: "Immutable receipts",
    body: "Executed, replayed, rejected, released, revoked — the ledger distinguishes them forever.",
  },
];

function ActiveDot() {
  return (
    <span className="relative flex size-2">
      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 motion-safe:animate-ping" />
      <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
    </span>
  );
}

function ContractCard() {
  return (
    <div className="relative w-full max-w-md rounded-2xl border border-emerald-500/25 bg-zinc-950/80 shadow-[0_0_60px_-15px_rgba(16,185,129,0.25)]">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-white/40">
          run contract
        </span>
        <span className="flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-950/50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
          <ActiveDot />
          ACTIVE
        </span>
      </div>

      <div className="grid grid-cols-3 divide-x divide-white/10 border-b border-white/10">
        {[
          { label: "refund ceiling", value: ENVELOPE.ceiling },
          { label: "max refunds", value: ENVELOPE.maxRefunds },
          { label: "lifetime", value: ENVELOPE.lifetime },
        ].map((s) => (
          <div key={s.label} className="px-4 py-4 text-center sm:px-5">
            <div className="font-mono text-2xl font-semibold tabular-nums text-white sm:text-3xl">
              {s.value}
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-white/40">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-5 py-4">
        {ENVELOPE.permitted.map((a) => (
          <span
            key={a}
            className="rounded-full border border-emerald-500/40 bg-emerald-950/40 px-2.5 py-1 font-mono text-[11px] text-emerald-300"
          >
            {a}
          </span>
        ))}
        {ENVELOPE.forbidden.map((a) => (
          <span
            key={a}
            className="rounded-full border border-rose-500/40 bg-rose-950/40 px-2.5 py-1 font-mono text-[11px] text-rose-300 line-through decoration-rose-400/60"
          >
            {a}
          </span>
        ))}
      </div>

      <div className="border-t border-dashed border-white/15 px-5 py-3 text-[11px] leading-relaxed text-white/40">
        Every agent, child agent, and connected MCP client that touches this
        case inherits exactly this envelope — until the human ends it.
      </div>
      
      {/* Authority Visualization */}
      <div className="border-t border-white/10 px-5 py-4">
        <div className="text-[10px] uppercase tracking-[0.2em] text-white/40 mb-3">Authority Flow</div>
        <div className="space-y-2 font-mono text-[11px]">
          <div className="flex items-center gap-2 text-emerald-400">
            <span className="size-2 rounded-full bg-emerald-400" /> Human issues contract
          </div>
          <div className="flex items-center gap-2 text-white/50 ml-3 border-l border-white/10 pl-3">
            <span className="size-2 rounded-full bg-sky-400" /> Root agent executes
          </div>
          <div className="flex items-center gap-2 text-white/50 ml-3 border-l border-white/10 pl-3">
            <span className="size-2 rounded-full bg-purple-400" /> Child agents (attenuated)
          </div>
          <div className="flex items-center gap-2 text-white/50 ml-3 border-l border-white/10 pl-3">
            <span className="size-2 rounded-full bg-amber-400" /> MCP clients (bound by contract)
          </div>
          <div className="flex items-center gap-2 text-rose-400 ml-3 border-l border-rose-500/30 pl-3">
            <span className="size-2 rounded-full bg-rose-400" /> Revocation kills all
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="dark min-h-full bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-16 px-4 py-16 sm:py-24">
        <section className="flex flex-col items-center gap-8 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-emerald-400/80">
            leash · authority contracts for autonomous work
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
            Agents do the work.
            <br />
            <span className="text-emerald-400">The leash</span> decides how far
            they can go.
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-white/60 sm:text-lg">
            {KILLER_LINE}
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Link
              to="/run"
              className="group inline-flex h-12 items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-950/50 px-7 text-base font-semibold text-emerald-200 transition hover:bg-emerald-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              Issue a run contract
              <span className="transition-transform group-hover:translate-x-1" aria-hidden="true">
                →
              </span>
            </Link>
            <span className="rounded-full border border-white/10 px-3 py-1 font-mono text-[11px] text-white/40">
              43 tests · offline · no mocks in the gate
            </span>
          </div>
        </section>

        <ContractCard />

        <section className="w-full">
          <h2 className="mb-6 text-center font-mono text-[11px] uppercase tracking-[0.3em] text-white/40">
            six properties, each enforced in the gate
          </h2>
          <div className="grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
            {PROPERTIES.map((p) => (
              <div
                key={p.n}
                className="flex flex-col gap-2 bg-zinc-950/90 p-6 text-left"
              >
                <span className="font-mono text-xs text-emerald-400/70">
                  {p.n}
                </span>
                <h3 className="text-sm font-semibold text-white">{p.title}</h3>
                <p className="text-sm leading-relaxed text-white/50">{p.body}</p>
              </div>
            ))}
          </div>
        </section>

        <footer className="max-w-2xl text-center">
          <p className="text-xs leading-relaxed text-white/35">
            Demo refunds are simulated — the enforcement is not. Child-agent
            identity is now server-verified via contractDelegates registry. The events ledger is
            append-only by convention. Expiry is decided by the server clock,
            never the request payload.
          </p>
        </footer>
      </div>
    </div>
  );
}
