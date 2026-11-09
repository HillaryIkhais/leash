# Dependency manifest audit — what standing the app actually requires

Ground rule honored: no full CLI bundle install, no unneeded packages. This
is the trimmed, defensible list the app needs to RUN (dev + build), produced
from the app's import graph, and it includes what's already on disk.

## Already on disk — zero bytes owed

| Item | Size | Why needed |
|---|---|---|
| Node v22.23.4 | 26 MB (spend) | framework refuses 22.14 |
| `@agent-native/core` 0.226.0 tarball | 11 MB (spend) | the framework runtime, vendored exports |
| 377 CLI dep tarballs in npm cache | 308 MB (spend) | sunk; partial overlap with app deps |
| Template app scaffold (`chat`) | 0 | lives inside the core package |
| Catalog versions | 0 | pinned, local snapshot |

## Required app engine stack (musts)

| Package | Why | Approx byte cost |
|---|---|---|
| `@agent-native/toolkit` | app shell, UI kit, chat runtime imports (~66 template refs) | tgz, unknown ≤ ~5 MB |
| `@agent-native/agentkit` | agent loop + task spawning (parent/child agents) | tgz, unknown ≤ ~5 MB |
| `@agent-native/otel` | observability plugin import | tgz, small ≤ ~2 MB |
| `react`, `react-dom` `^19.2.7` | every UI route | ~5–8 MB total |
| `vite` 8.1.0 + `@react-router/dev` + `@react-router/fs-routes` + `react-router ^8.1.0` | dev server + build | ~20–30 MB |
| `@tailwindcss/vite`, `tailwindcss ^4.2.4` (+ typography plug-in) | styling | ~10–15 MB |
| `typescript-7` (npm:typescript@^7) | typecheck/build | ~10 MB |
| `tsx` | run TS server scripts | ~2–5 MB |
| `drizzle-orm ^0.45.3` | DB queries (enforcement bridge) | ~3–6 MB |
| `@electric-sql/pglite ^0.5.8` | local embedded Postgres (wasm) | ~3–5 MB |
| `zod ^4` | every action schema | ~3 MB |
| `ai 6.0.258` + **one** provider (`@openrouter/ai-sdk-provider` or `@ai-sdk/anthropic`) | agent chat loop | ~6–15 MB; other five provider SDKs CUT |
| `@fontsource-variable/inter` | typography/font | ~1–4 MB |
| `@tanstack/react-query ^5` | client API transport used by toolkit hooks | ~3–6 MB |

## Conditional — keep only what LEASH actually imports

| Package | Verdict |
|---|---|
| Radix UI components | install only the ~10 the run board uses (dialog, dropdown, tabs, switch, tooltip, select, toast, popover, label, slot) ≈ 4–8 MB install target; the rest CUT |
| `zustand` `@tanstack/*-persist` `h3` `isbot` | only if template code paths we preserve actually import them — verify at first build; likely cutting to ~2 MB |
| `node-pty` | terminal shell feature — **CUT** (native build, unused by LEASH) |
| `@xterm/*`, `embla-carousel-react`, `vaul`, `input-otp`, `cmdk`, `react-day-picker`, `react-hook-form`, `react-resizable-panels`, `sonner` | CUT unless the kept template screens genuinely import them |

## Total exposure

Realistic app install delta vs disk: **≈ 70–140 MB**, dominated by
vite/build tooling (not replaceable), not framework bloat. Exact published
sizes for the three @agent-native tarballs verified at fetch time; the plan
fetches them as individual tarballs through the chunk downloader (proven
route), so nothing exceeds known controls and any package that stalls can
be segmented the same way.
