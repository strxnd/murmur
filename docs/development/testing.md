# Testing

The current test suite uses Vitest.

```sh
mise run test
```

`mise run lint` and `mise run build` both run TypeScript checking. `mise run build` is the minimum verification before handing off changes because it also runs the Electron/Vite production build.

## Current Test Coverage

Tests exist for shared model activation, storage, STT behavior, STT runtime lookup, STT setup, model library behavior, context metadata, clipboard behavior, paste behavior, Linux text automation, native/global shortcut detection, and renderer helper logic.

Representative files:

- `src/shared/model-activation.test.ts`
- `src/main/services/storage.test.ts`
- `src/main/services/stt-runtime.test.ts`
- `src/main/services/model-library.test.ts`
- `src/main/services/linux-text-automation.test.ts`
- `src/renderer/src/lib/stt-setup.test.ts`

## Adding Tests

- Shared logic should get unit tests near `src/shared/`.
- Main services should be tested with mocked filesystem, process, HTTP, or desktop dependencies.
- Renderer helpers should be tested near `src/renderer/src/lib/` or relevant hooks.
- End-to-end Electron flows are not currently scaffolded; add them only when the behavior needs real process or renderer integration.

Documentation-only changes should still run `mise run build` as the minimum repo verification.
