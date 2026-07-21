# Testing

The repository test suites use Vitest.

```sh
bun run test
```

The root test command runs desktop and repository-script tests. Root `lint` and `build` verify the desktop application:

```sh
bun run lint
bun run build
```

`bun run build` is the minimum verification before handing off changes because it typechecks the desktop workspace and produces the Electron/Vite production build.

## Focused Tests

Run a desktop test file from the repository root:

```sh
bun run --cwd apps/desktop test -- src/main/services/storage.test.ts
```

Run a named desktop test:

```sh
bun run --cwd apps/desktop test -- src/main/services/storage.test.ts -t "writes config state to the config dir"
```

Run repository-script tests with:

```sh
bun run test:scripts
```

## Current Test Coverage

Desktop tests cover shared model activation, storage, STT behavior, STT runtime lookup, STT setup, model library behavior, context metadata, clipboard behavior, paste behavior, Linux text automation, native/global shortcut detection, renderer navigation, dialogs, and renderer helper logic.

Representative desktop files:

- `apps/desktop/src/shared/model-activation.test.ts`
- `apps/desktop/src/main/services/storage.test.ts`
- `apps/desktop/src/main/services/stt-runtime.test.ts`
- `apps/desktop/src/main/services/model-library.test.ts`
- `apps/desktop/src/main/services/linux-text-automation.test.ts`
- `apps/desktop/src/renderer/src/lib/stt-setup.test.ts`
- `apps/desktop/src/renderer/src/components/ui/controls.test.tsx`

Repository scripts keep tests under `scripts/`, including runtime staging behavior.

## Adding Tests

- Shared desktop logic should get unit tests near `apps/desktop/src/shared/`.
- Main services should be tested with mocked filesystem, process, HTTP, or desktop dependencies.
- Desktop renderer helpers and navigation should be tested near the relevant renderer modules.
- End-to-end Electron flows are not currently scaffolded; add them only when the behavior needs real process or renderer integration.

Documentation-only changes should still run `bun run build` as the minimum repository verification.
