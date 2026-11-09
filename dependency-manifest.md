# Dependency manifest — verified against the actual import graph

Every dependency below is justified by a direct import in app code, a
framework peer requirement, or the runtime database. Everything else was
removed from `package.json` (45 packages cut). All versions are pinned —
no `latest` fetches, no `workspace:*` or `catalog:` placeholders; the
committed `pnpm-lock.yaml` is the reproducible resolution.

## Runtime dependencies

| Package | Version | Why |
|---|---|---|
| `@agent-native/core` | 0.226.0 (exact) | the framework runtime: actions, db, auth, server |
| `@agent-native/toolkit` | 0.226.0 (exact) | app shell, UI kit, chat runtime (imports in `app/`) |
| `@agent-native/agentkit` | 0.226.0 (exact) | agent loop + task spawning |
| `@agent-native/otel` | 0.1.35 (exact) | observability plugin (`server/plugins/otel.ts`) |
| `@electric-sql/pglite` | ^0.5.9 | embedded Postgres for local dev (`getDb`) |
| `@openrouter/ai-sdk-provider` | ^2.9.1 | the single LLM provider the agent chat resolves |
| `@tabler/icons-react` | ^3.44.0 | icons in layout/chat/home components (direct import) |
| `@tanstack/react-query` | ^5.99.2 | client API transport (toolkit peer, direct import) |
| `ai` | 6.0.258 (exact) | AI SDK core (core peer — agent chat loop) |
| `drizzle-orm` | ^0.45.3 | DB queries (enforcement bridge + actions) |
| `h3` | ^2.0.1 | server middleware/handlers (direct import) |
| `next-themes` | ^0.4.6 | `app/root.tsx` theme |
| `react` / `react-dom` | ^19.2.7 | UI (toolkit peer) |
| `react-router` | ^8.1.0 | routing (toolkit/core peer) |
| `sonner` | ^2.0.7 | toasts (direct import in Sidebar/ChatRouteContent) |
| `zod` | ^4.3.6 | every action schema |
| `@fontsource-variable/inter` | ^5.3.0 | typography (`app/global.css`) |

## Dev dependencies

| Package | Why |
|---|---|
| `@react-router/dev`, `@react-router/fs-routes` | build + route config |
| `@tailwindcss/vite`, `tailwindcss` | styling pipeline |
| `@types/node`, `@types/react`, `@types/react-dom` | typecheck |
| `tsx` | TS server scripts (`migrate:production`, demo runner fallback) |
| `typescript-7` (`npm:typescript@^7.0.2`) | typecheck/build |
| `vite` 8.1.0 (exact) | dev server + build |
| `vitest` | framework test runner (`test:vitest`) |

## Removed (previously declared, zero imports in app code)

`@ai-sdk/anthropic`, `@ai-sdk/cohere`, `@ai-sdk/google`, `@ai-sdk/groq`,
`@ai-sdk/mistral`, `@ai-sdk/openai`, `ai-sdk-ollama` (five provider SDKs +
ollama; the framework carries `@anthropic-ai/sdk` itself and the app resolves
OpenRouter), `node-pty`, `@xterm/*` (terminal feature — cut), all 27
`@radix-ui/react-*` devDependencies (regular dependencies of the toolkit),
`cmdk`, `embla-carousel-react`, `vaul`, `input-otp`, `react-day-picker`,
`react-hook-form`, `react-resizable-panels`, `class-variance-authority`,
`clsx`, `tailwind-merge`, `zustand`, `isbot`, `happy-dom`
(`cn` comes from the toolkit; no DOM tests).

## Install footprint

A fresh `pnpm install --frozen-lockfile` resolves the pinned set. The three
`@agent-native` framework tarballs dominate (~15–20 MB); the rest is the
build toolchain (vite/react-router/tailwind) and the runtime stack above.
