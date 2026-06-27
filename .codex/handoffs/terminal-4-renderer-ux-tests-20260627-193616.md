# Handoff Packet: Terminal 4 Renderer UX, Accessibility, Performance, and Focused Tests

- Target: `/home/kumaraarav/dev/murmur`
- Packet: `/home/kumaraarav/dev/murmur/.codex/handoffs/terminal-4-renderer-ux-tests-20260627-193616.md`
- Timestamp: `2026-06-27 19:36:16 +08`
- Commit: `be6e1717253c0ff5194bf5dcb70d985778f0b757`
- Worktree status: dirty before this packet: `.gitignore` modified, `.codex/audits/murmur-full-repo-20260627-114324.md` deleted; do not revert unrelated changes.
- Recipient: future Codex implementation session for one dedicated terminal/worktree.
- Suggested branch/worktree: `audit/renderer-ux-tests`

## Goal

Implement the audit renderer UX/test-coverage scope only: prevent silent settings loss, surface rejected action errors, keep large history responsive, fix mode editor/selector accessibility and labels, and add focused tests for app-controller/preload/prompt/auto-mode/critical renderer contracts without duplicating existing provider/runtime/storage coverage.

Assigned GitHub issues:

- `DA-016` [#22](https://github.com/strxnd/murmur/issues/22): Settings changes can be silently lost without autosave or a guard.
- `DA-017` [#23](https://github.com/strxnd/murmur/issues/23): Rejected actions can hide errors and leave app state ready.
- `DA-018` [#25](https://github.com/strxnd/murmur/issues/25): Large history lists are filtered and mapped synchronously.
- `DA-019` [#26](https://github.com/strxnd/murmur/issues/26): Mode editor and selector need accessible names and focus fixes.
- `DA-022` [#27](https://github.com/strxnd/murmur/issues/27): Critical app-controller, preload, prompt, and auto-mode contracts lack focused tests.

## Current State

- Completed: audit findings were harvested and turned into GitHub issues; all assigned issues were open when checked with `gh issue list` on 2026-06-27.
- In progress: no implementation started in this handoff.
- Not started: all code, tests, accessibility checks, manual/Playwright smoke checks, and verification for this scope.
- Blockers: none known locally.

## Key Context

- Relevant files: `src/renderer/src/views/ConfigurationView.tsx`, `src/renderer/src/state/murmur-store.ts`, `src/renderer/src/app/App.tsx`, `src/renderer/src/views/HistoryView.tsx`, `src/renderer/src/views/ModesView.tsx`, `src/renderer/src/app/ModeSelectorOverlay.tsx`, `src/shared/prompts.ts`, `src/main/services/auto-mode.ts`, `src/main/app-controller.ts`, `src/preload/index.ts`, component/store tests and app-controller/preload test harnesses.
- Relevant commands already run:
  - `git rev-parse HEAD` -> `be6e1717253c0ff5194bf5dcb70d985778f0b757`.
  - `git status --short --branch` -> `## main...origin/main`, plus dirty `.gitignore` and deleted old audit markdown.
  - `gh issue list --repo strxnd/murmur --state all --limit 200 --json ...` -> 25 open `Audit DA-*` issues.
  - Harvest baseline recorded `mise run test` passed with 160 tests and `mise run build` passed before implementation.
- Important decisions:
  - Keep this terminal scoped to `DA-016`, `DA-017`, `DA-018`, `DA-019`, and `DA-022`.
  - Do not redesign the app shell broadly.
  - Keep UI compact and consistent with current Murmur styling.
  - `DA-022` should add focused missing coverage, not duplicate existing provider/runtime/storage tests.
- Constraints/non-goals:
  - Preserve current user workflows unless the issue requires a narrow behavior fix.
  - Respect `prefers-reduced-motion` for any new motion.
  - Do not implement security/privacy, recording, storage/download, or release issues from other terminal packets.
  - Coordinate with Terminal 1/2 if their app-controller or preload contract changes land first; rebase and test against their new contracts.

## Evidence Map

| Path or Command | Why it matters |
| --- | --- |
| `.codex/harvests/murmur-full-repo-harvest-20260627-164254.md` | Source plan; maps all assigned issues to AH-B07 and records `DA-019/022` as modified scope. |
| `src/renderer/src/views/ConfigurationView.tsx` | Settings currently persist only through manual save per harvest evidence. |
| `src/renderer/src/state/murmur-store.ts` | Action failure state and store behavior. |
| `src/renderer/src/app/App.tsx` | Top-level action/error surfaces and state wiring. |
| `src/renderer/src/views/HistoryView.tsx` | Large list filtering/mapping and virtualization target. |
| `src/renderer/src/views/ModesView.tsx` | Mode editor dialog labels/title accessibility. |
| `src/renderer/src/app/ModeSelectorOverlay.tsx` | Mode selector listbox/focus behavior. |
| `src/shared/prompts.ts` | Prompt-builder unit tests requested by `DA-022`. |
| `src/main/services/auto-mode.ts` | Auto-mode unit tests requested by `DA-022`. |
| `src/main/app-controller.ts` and `src/preload/index.ts` | Critical app-controller/preload contract tests requested by `DA-022`. |
| `gh issue list --repo strxnd/murmur --state all --limit 200 --json ...` | Verified assigned GitHub issues exist and are open. |

## Risks and Open Questions

- History virtualization may add a dependency or need a lightweight local implementation. Prefer the repo's established dependency style; avoid broad UI rewrites.
- Settings loss can be solved by debounced autosave or a real close/navigation guard. Choose the smallest reliable behavior and test it.
- Rejected-action error UI may overlap with Terminal 2 timeout failure propagation; this terminal owns renderer visibility and recovery behavior.
- Accessibility checks may need a manual browser/Electron pass if no automated axe setup exists.

## Next Steps

1. Create a dedicated worktree/branch for this packet, for example `git worktree add ../murmur-renderer-ux-tests -b audit/renderer-ux-tests`.
2. Fix settings persistence with debounced autosave plus validation/error handling, or implement a real unsaved-change guard.
3. Add focusable visible error/toast surfaces for rejected record, copy, paste, delete, reprocess, model, and runtime actions.
4. Virtualize or otherwise bound history rendering and debounce/memoize search filtering for 2,000 long entries.
5. Add `Dialog.Title` and explicit labels/ARIA names where needed in mode editor and related inputs.
6. Correct mode selector listbox/focus behavior using a focusable listbox or roving focus pattern.
7. Add focused tests for app-controller/preload contracts, recording lifecycle fake-service edges that are not covered by Terminal 2, prompt builders, auto-mode matching, and touched renderer/store behavior.
8. Run accessibility/manual or Playwright/Electron smoke checks for settings, action errors, history search, and mode selector keyboard behavior.
9. Run verification and update/close only the assigned GitHub issues if the checks pass.

## Acceptance Criteria

- Configuration changes persist without requiring a manual Save click, or the user is blocked from losing them.
- Rejected actions produce visible, recoverable errors while keeping app state coherent.
- History remains responsive with 2,000 long entries.
- Mode editor has an accessible dialog title and inputs have explicit accessible names.
- Mode selector keyboard/listbox behavior is correct and focus is visible/coherent.
- New tests cover missing app-controller, preload, prompt, auto-mode, and critical renderer/store contracts without duplicating unrelated provider/runtime/storage tests.
- `mise run test` passes.
- `mise run build` passes.
- Manual or Playwright/Electron smoke checks for settings autosave/guard, rejected action errors, history search with 2,000 entries, and mode selector keyboard behavior are completed or explicitly documented as not run.

## Fresh-Session Prompt

```text
Read this handoff packet: /home/kumaraarav/dev/murmur/.codex/handoffs/terminal-4-renderer-ux-tests-20260627-193616.md

Goal: implement only the Terminal 4 renderer UX/accessibility/performance/test scope for DA-016, DA-017, DA-018, DA-019, and DA-022 in strxnd/murmur.

Continue from the packet. Preserve the listed constraints, coordinate with other branches if app-controller/preload contracts changed, do not implement other audit issues, do not revert unrelated dirty worktree changes, and verify with the listed acceptance checks before reporting back.
```
