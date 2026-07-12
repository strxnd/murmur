# Repository Guidelines

## Project Structure & Module Organization

Murmur is an Electron desktop app with a React renderer.

- App current state is early development; do not focus on migrating old user profiles or legacy features.

- `apps/desktop/`: Electron desktop app package.
- `apps/desktop/src/main/`: Electron main process, IPC registration, window lifecycle, and app orchestration.
- `apps/desktop/src/main/services/`: focused system services for STT, LLMs, storage, context capture, paste automation, and auto-mode matching.
- `apps/desktop/src/preload/`: secure preload bridge exposed as `window.murmur`.
- `apps/desktop/src/renderer/`: Vite/React UI entrypoint, app views, and global CSS.
- `apps/desktop/src/shared/`: shared TypeScript types, defaults, and prompt builders.
- `apps/marketing/`: public marketing website package.
- `docs/`: project documentation, including desktop architecture and operations.
- `scripts/`: repository-level build, runtime, and release tooling.
- `resources/`: native helper sources and generated helper binaries.
- `patches/`: patches applied while preparing third-party runtimes.
- `tsconfig.base.json`: shared TypeScript compiler settings.
- `apps/desktop/out/`: generated desktop build output. Do not edit directly.
- `node_modules/`: installed dependencies. Do not edit directly.

## Build, Test, and Development Commands

- `mise install`: install the pinned Node toolchain from `.mise.toml`.
- `mise run install`: install dependencies from `package-lock.json`.
- `mise run dev`: start Electron with the Vite renderer dev server. The wrapped npm script clears `ELECTRON_RUN_AS_NODE`.
- `mise run build`: run TypeScript checking and produce production Electron/Vite output in `apps/desktop/out/`.
- `mise run preview`: preview the built Electron app.
- `mise run lint`: currently aliases `tsc --noEmit` for type checking.
- `mise run test`: run the Vitest test suite.

Mise tasks wrap the root npm scripts, which delegate to workspace scripts. Keep package scripts as the source of truth. Use `mise run build` as the minimum verification before handing off changes.

## Coding Style & Naming Conventions

Use TypeScript throughout. Keep strict typing intact and prefer shared interfaces from `apps/desktop/src/shared/types.ts` over duplicate local shapes.

- Indentation: two spaces.
- Components: `PascalCase` React component names.
- Services/files: kebab-case filenames such as `auto-mode.ts`; service classes use `PascalCase`.
- Functions/variables: `camelCase`.
- Constants/default configs: keep in `apps/desktop/src/shared/defaults.ts` when they are shared across processes.

Use concise comments only when they clarify non-obvious system behavior.

## UI & Animation Guidelines

Animations are important to Murmur's user experience. Use purposeful, restrained motion for interactive state changes such as opening panels, adding rows, switching modes, and revealing controls. Keep animations fast, avoid layout jank, and respect `prefers-reduced-motion`.

## Testing Guidelines

The current test suite uses Vitest. Keep new tests close to the behavior being verified:

- Shared logic: unit tests for prompt building, model activation, and auto-mode matching.
- Main services: tests with mocked filesystem, STT/LLM HTTP endpoints, and desktop dependencies.
- Renderer helpers: unit tests near the relevant library or hook.
- Renderer flows: add Electron or Playwright tests only when the behavior needs real process or renderer integration.

Name tests after behavior, for example `auto-mode.test.ts` or `prompts.test.ts`.

## Security & Configuration Tips

Do not commit API keys, local provider secrets, recorded audio, SQLite data, or generated `out/` artifacts. Cloud STT/LLM providers must remain opt-in and require explicit provider configuration.
