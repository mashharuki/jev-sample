# Repository Guidelines

## Project Structure & Module Organization

This repository contains Jev examples. `ts-sdk-sample/src/` holds Bun-based TypeSafe AI tutorials. The transaction monitor lives in `tx-analiyze/` (keep this spelling): `src/chain.ts` fetches and decodes Base Sepolia evidence, `src/analyze.ts` calls Jev, `src/watcher.ts` implements block-order polling, `src/worker.ts` persists monitored results, `src/storage.ts` owns SQLite, and `src/mastra/` exposes the API and Gemini explainer. `tx-analiyze/web/` is the React/Vite dashboard; `tx-analiyze/test/` contains Node tests. `docs/` holds project notes and the UI upgrade plan.

## Build, Test, and Development Commands

Run transaction commands from `tx-analiyze/` after `pnpm install` and `cp .env.example .env`:

- `pnpm analyze --demo --decode-only`: inspect synthetic evidence without API calls.
- `pnpm worker`: monitor new Base Sepolia blocks, classify with Jev, and save results to SQLite. Use `--decode-only --limit 1` for a small RPC smoke test.
- `pnpm dev:api` and `pnpm dev:web`: run Mastra on port 4111 and the dashboard on port 5173 in separate terminals.
- `pnpm typecheck`, `pnpm check`, `pnpm test`, `pnpm build:web`: validate TypeScript, Biome, Node tests, and the production UI bundle.

For the Bun example, run `bun run dev` or `bun run tutorial` inside `ts-sdk-sample/`.

## Coding Style & Naming Conventions

Use strict TypeScript, ES module imports, four-space indentation in TypeScript, two-space indentation in JSON, double-quoted strings, and camelCase functions. Run `pnpm format` to apply Biome changes. Keep RPC facts, Jev classifications, and Gemini explanations distinct in data models and UI labels. Preserve integer amounts as strings when serializing chain data.

## Testing Guidelines

Place transaction tests in `tx-analiyze/test/*.test.ts`; `pnpm test` uses Node's test runner. Cover decoding ambiguity, skipped inputs, block ordering, persistence checkpoints, and API-facing behavior with deterministic fixtures. Do not assert exact AI scores. No coverage threshold is configured. Verify a real RPC flow with `--decode-only` before changing the worker.

## Commits, Pull Requests & Secrets

History uses short descriptive messages; no Conventional Commits requirement exists. Write an imperative summary, and explain behavior and validation in the pull request. Link issues when relevant and include a sanitized UI screenshot for visual changes. Store `TYPESAFE_API_KEY`, `ALCHEMY_RPC_URL`, optional `ETHEREUM_RPC_URL`, and `GOOGLE_API_KEY` in ignored `.env` files. Never expose keys through `VITE_*`, browser responses, logs, or sample output.
