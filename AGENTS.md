# Repository Guidelines

## Project Structure & Module Organization

Murmur is an Electron desktop app with a React renderer.

- `src/main/`: Electron main process, IPC registration, window lifecycle, and app orchestration.
- `src/main/services/`: focused system services for STT, LLMs, storage, context capture, paste automation, and auto-mode matching.
- `src/preload/`: secure preload bridge exposed as `window.murmur`.
- `src/renderer/`: Vite/React UI entrypoint, app views, and global CSS.
- `src/shared/`: shared TypeScript types, defaults, prompt builders, and replacement utilities.
- `out/`: generated build output. Do not edit directly.
- `node_modules/`: installed dependencies. Do not edit directly.

## Build, Test, and Development Commands

- `npm install`: install dependencies from `package-lock.json`.
- `npm run dev`: start Electron with the Vite renderer dev server. The script clears `ELECTRON_RUN_AS_NODE`.
- `npm run build`: run TypeScript checking and produce production Electron/Vite output in `out/`.
- `npm run preview`: preview the built Electron app.
- `npm run lint`: currently aliases `tsc --noEmit` for type checking.

There is no dedicated test command yet; use `npm run build` as the minimum verification before handing off changes.

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

- Shared logic: unit tests for prompt building, replacements, and auto-mode matching.
- Main services: integration tests with mocked STT/LLM HTTP endpoints.
- Renderer flows: Electron or Playwright tests for recording, provider settings, and history actions.

Name tests after behavior, for example `auto-mode.test.ts` or `replacements.test.ts`.

## Commit & Pull Request Guidelines

This directory has no git history yet, so no existing convention can be inferred. Use short imperative commit messages with one of these prefixes:

- `feat: add OpenAI-compatible STT provider validation`
- `fix: restore clipboard after paste fallback`
- `chore: update Electron build configuration`

Pull requests should include a concise summary, verification steps, known limitations, and screenshots or short recordings for UI changes.

## Security & Configuration Tips

Do not commit API keys, local provider secrets, retained audio, SQLite data, or generated `out/` artifacts. Cloud STT/LLM providers must remain opt-in and respect local-only mode.
