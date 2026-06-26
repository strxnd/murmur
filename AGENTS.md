# Repository Guidelines

## Project Structure & Module Organization

Murmur is an Electron desktop app with a React renderer.

- `src/main/`: Electron main process, IPC registration, window lifecycle, and app orchestration.
- `src/main/services/`: focused system services for STT, LLMs, storage, context capture, paste automation, and auto-mode matching.
- `src/preload/`: secure preload bridge exposed as `window.murmur`.
- `src/renderer/`: Vite/React UI entrypoint, app views, and global CSS.
- `src/shared/`: shared TypeScript types, defaults, and prompt builders.
- `out/`: generated build output. Do not edit directly.
- `node_modules/`: installed dependencies. Do not edit directly.

## Build, Test, and Development Commands

- `mise install`: install the pinned Node toolchain from `.mise.toml`.
- `mise run install`: install dependencies from `package-lock.json`.
- `mise run dev`: start Electron with the Vite renderer dev server. The wrapped npm script clears `ELECTRON_RUN_AS_NODE`.
- `mise run build`: run TypeScript checking and produce production Electron/Vite output in `out/`.
- `mise run preview`: preview the built Electron app.
- `mise run lint`: currently aliases `tsc --noEmit` for type checking.
- `mise run test`: run the Vitest test suite.

Mise tasks wrap the existing npm scripts in `package.json`; keep those scripts as the source of truth. Use `mise run build` as the minimum verification before handing off changes.

## Coding Style & Naming Conventions

Use TypeScript throughout. Keep strict typing intact and prefer shared interfaces from `src/shared/types.ts` over duplicate local shapes.

- Indentation: two spaces.
- Components: `PascalCase` React component names.
- Services/files: kebab-case filenames such as `auto-mode.ts`; service classes use `PascalCase`.
- Functions/variables: `camelCase`.
- Constants/default configs: keep in `src/shared/defaults.ts` when they are shared across processes.

Use concise comments only when they clarify non-obvious system behavior.

## UI & Animation Guidelines

Animations are important to Murmur's user experience. Use purposeful, restrained motion for interactive state changes such as opening panels, adding rows, switching modes, and revealing controls. Keep animations fast, avoid layout jank, and respect `prefers-reduced-motion`.

## Testing Guidelines

Tests are not scaffolded yet. When adding tests, keep them close to the behavior being verified:

- Shared logic: unit tests for prompt building and auto-mode matching.
- Main services: integration tests with mocked STT/LLM HTTP endpoints.
- Renderer flows: Electron or Playwright tests for recording, provider settings, and history actions.

Name tests after behavior, for example `auto-mode.test.ts` or `prompts.test.ts`.

## Security & Configuration Tips

Do not commit API keys, local provider secrets, recorded audio, SQLite data, or generated `out/` artifacts. Cloud STT/LLM providers must remain opt-in and require explicit provider configuration.
