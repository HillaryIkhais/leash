import { useState } from "react";
import { useNavigate } from "react-router";
import { useActionMutation } from "@agent-native/core/client/use-action";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import {
  useChatThreads,
  navigateWithAgentChatViewTransition,
  chatThreadPath,
} from "@agent-native/toolkit/app/chat/agentkit-chat/rail";

const DEFAULTS = {
  customer: "Sasha Lindqvist",
  orderRef: "ORD-22911",
  orderTotalCents: 18900,
  complaint:
    "Item arrived damaged (the ceramic handle snapped). Customer is upset; asks for a resolution today.",
};

export function meta() {
  return [{ title: "LEASH · Issue run contract" }];
}

export default function RunLauncher() {
  useSetPageTitle("LEASH · Issue run contract");
  const navigate = useNavigate();
  const [form, setForm] = useState({ ...DEFAULTS });
  const [ceiling, setCeiling] = useState(20000);
  const [maxRefunds, setMaxRefunds] = useState(2);
  const [minutes, setMinutes] = useState(10);

  const open = useActionMutation("open-case");
  const issue = useActionMutation("issue-contract");

  const { createThread } = useChatThreads(undefined, "chat", undefined, {
    autoCreate: false,
  });

  const launch = async () => {
    const opened: any = await open.mutateAsync({
      customer: form.customer,
      orderRef: form.orderRef,
      orderTotalCents: form.orderTotalCents,
      complaint: form.complaint,
    });
    const issued: any = await issue.mutateAsync({
      caseId: opened.caseId,
      title: `Support run · ${form.orderRef}`,
      budgetCents: ceiling,
      maxRefunds,
      permittedActions: ["inspect-order", "issue-refund", "draft-response"],
      forbiddenActions: ["change-account-owner"],
      minutes,
    });

    // Create a new chat thread for the agent to resolve this case
    const threadId = await createThread();
    if (!threadId) {
      throw new Error("Failed to create chat thread");
    }

    // Navigate to chat with initial message asking agent to resolve the case
    const initialMessage = `Please resolve support case ${opened.caseId} (order ${form.orderRef} for ${form.customer}). 

The customer complaint: "${form.complaint}"

Please:
1. Inspect the order to understand the details
2. Determine an appropriate resolution based on the complaint
3. If a refund is warranted, execute it through the LEASH-governed issue-refund action
4. Draft a customer response explaining the resolution
5. Report the final outcome

The contract budget is $${(ceiling / 100).toFixed(2)} with max ${maxRefunds} refunds.`;

    navigateWithAgentChatViewTransition(navigate, chatThreadPath(threadId), {
      state: {
        initialMessage,
        initialComposerOptions: {
          mode: "act",
        },
      },
    });
  };

  const row = (
    label: string, value: string, onInput: (v: string) => void,
    type: "text" | "number" = "text",
  ) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-white/50">{label}</span>
      <input
        type={type}
        value={value}
        onInput={(e) => onInput((e.target as HTMLInputElement).value)}
        className="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-2 outline-none focus:border-emerald-400/60"
      />
    </label>
  );

  return (
    <div className="dark mx-auto flex h-full max-w-4xl flex-col gap-8 overflow-y-auto bg-background p-6 text-foreground">
      <header>
        <div className="text-[11px] uppercase tracking-[0.25em] text-white/40">leash · issue authority</div>
        <h1 className="text-2xl font-semibold">Write the run contract</h1>
        <p className="mt-1 max-w-2xl text-sm text-white/50">
          One delegated job, one live envelope: ceiling, count, permitted and
          forbidden actions, lifetime. Every agent, child agent, and external
          MCP client touching this case inherits exactly this.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        {row("Customer", form.customer, (v) => setForm({ ...form, customer: v }))}
        {row("Order ref", form.orderRef, (v) => setForm({ ...form, orderRef: v }))}
        {row("Order total (cents)", String(form.orderTotalCents), (v) => setForm({ ...form, orderTotalCents: Number(v) }), "number")}
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="text-white/50">Complaint</span>
          <textarea
            rows={2}
            value={form.complaint}
            onInput={(e) => setForm({ ...form, complaint: (e.target as HTMLTextAreaElement).value })}
            className="rounded-lg border border-white/15 bg-white/[0.04] px-3 py-2 outline-none focus:border-emerald-400/60"
          />
        </label>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="mb-4 text-[11px] uppercase tracking-[0.25em] text-white/40">Contract terms</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {row("Refund ceiling (cents)", String(ceiling), (v) => setCeiling(Number(v)), "number")}
          {row("Max refunds", String(maxRefunds), (v) => setMaxRefunds(Number(v)), "number")}
          {row("Lifetime (minutes)", String(minutes), (v) => setMinutes(Number(v)), "number")}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-emerald-500/40 bg-emerald-950/40 px-2 py-1 text-emerald-300">permitted: inspect-order, issue-refund, draft-response</span>
          <span className="rounded-full border border-rose-500/40 bg-rose-950/40 px-2 py-1 text-rose-300">forbidden: change-account-owner</span>
        </div>
      </section>

      <div>
        <button
          onClick={launch}
          disabled={open.isPending || issue.isPending}
          className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-6 py-3 font-semibold text-emerald-200 transition hover:bg-emerald-900/50 disabled:opacity-40"
        >
          {open.isPending || issue.isPending ? "…" : "Issue contract → start agent resolution in chat"}
        </button>
        {(open.isError || issue.isError) && (
          <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-950/30 p-3 text-sm text-rose-200">
            {String((open.error ?? issue.error) instanceof Error ? ((open.error ?? issue.error) as Error).message : (open.error ?? issue.error))}
          </div>
        )}
      </div>
    </div>
  );
}