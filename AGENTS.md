# Repository Guidelines

## Project Structure & Module Organization

This repository contains Jev/TypeSafe AI learning examples and experiments.

- `ts-sdk-sample/src/index.ts`: minimal support-ticket classification example.
- `ts-sdk-sample/src/tutorial.ts`: department routing, urgency scoring, and refund detection example.
- `ts-sdk-sample/`: Bun package with its own dependencies, lockfile, TypeScript configuration, and environment template.
- `tx-analiyze/`: transaction-analysis scaffold containing only a package manifest. Preserve the existing directory spelling.
- `docs/quickstart.md`: HTTP API example; `docs/memo.md`: proposed transaction-analysis MVP and tooling.
- `README.md`: project overview and reference links. No dedicated test or asset directories currently exist.

## Build, Test, and Development Commands

Run SDK commands from `ts-sdk-sample/`:

```sh
cd ts-sdk-sample
bun install               # Install dependencies using bun.lock
cp .env.example .env      # Create local configuration; add your API key
bun run dev              # Run the minimal classification example
bun run tutorial         # Run the expanded routing example
bunx tsc --noEmit         # Check types without generating JavaScript
```

The examples call the live API and require `TYPESAFE_API_KEY`. There is no build script; Bun executes TypeScript directly. `tx-analiyze/package.json` specifies `pnpm@11.24.0`, but has no working application commands; its test script deliberately fails.

## Coding Style & Naming Conventions

Match existing TypeScript: four-space indentation, double-quoted strings, ES module imports, camelCase variables/functions, and small async entrypoints. Use two-space indentation for JSON. Follow the strict compiler settings, including unchecked-index protection. Preserve API field names such as `refund_requested`.

No formatter or linter is configured. Biome is proposed in `docs/memo.md`, not installed. Keep examples focused; the transaction-analysis plan calls for Japanese Jev context instructions and a minimal script-based MVP.

## Testing Guidelines

No automated test framework, test naming convention, or coverage threshold is established. For code changes, run the type check and manually exercise the affected example with local credentials. Report validation performed and avoid assertions tied to exact model scores. If adding automated tests, prefer `*.test.ts` beside the relevant source and document the runner command.

## Commit & Pull Request Guidelines

History uses short messages such as `add sample code` and `Update README.md`; no Conventional Commits requirement exists. Prefer concise, descriptive imperative messages over `update`.

Pull requests should explain the change, affected package, and validation results. Link relevant issues and include sanitized sample output for behavioral changes. Keep API keys in ignored `.env` files; never commit credentials or expose them in logs or PR descriptions.
