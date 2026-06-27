# Handoff Packet: Terminal 3 Storage, Downloads, Runtime Packaging, and CI

- Target: `/home/kumaraarav/dev/murmur`
- Packet: `/home/kumaraarav/dev/murmur/.codex/handoffs/terminal-3-storage-download-release-20260627-193616.md`
- Timestamp: `2026-06-27 19:36:16 +08`
- Commit: `be6e1717253c0ff5194bf5dcb70d985778f0b757`
- Worktree status: dirty before this packet: `.gitignore` modified, `.codex/audits/murmur-full-repo-20260627-114324.md` deleted; do not revert unrelated changes.
- Recipient: future Codex implementation session for one dedicated terminal/worktree.
- Suggested branch/worktree: `audit/storage-download-release`

## Goal

Implement the audit storage/download/release scope only: model/runtime download timeouts, model integrity and archive safety, download progress churn, text retention, atomic persistence, runtime asset reachability checks, target-aware bundled runtime staging, Linux helper packaging, CI, and the vulnerable `geist -> next -> postcss` production dependency path.

Assigned GitHub issues:

- `DA-008` [#14](https://github.com/strxnd/murmur/issues/14): STT runtime catalog URLs are unreachable while manifest verification still passes.
- `DA-009` [#7](https://github.com/strxnd/murmur/issues/7): Large downloads can trigger per-chunk full storage rewrites and full renderer broadcasts.
- `DA-010` [#12](https://github.com/strxnd/murmur/issues/12): Model and runtime download body reads can hang after headers.
- `DA-011` [#13](https://github.com/strxnd/murmur/issues/13): Downloaded STT model files and archives are accepted without integrity checks.
- `DA-012` [#21](https://github.com/strxnd/murmur/issues/21): The textRetentionDays privacy setting is exposed but not enforced.
- `DA-013` [#24](https://github.com/strxnd/murmur/issues/24): Config and history writes are not atomic.
- `DA-014` [#15](https://github.com/strxnd/murmur/issues/15): The native Linux paste helper packaging depends on an ignored local binary.
- `DA-015` [#17](https://github.com/strxnd/murmur/issues/17): Runtime staging defaults to the current host platform instead of the requested package target.
- `DA-021` [#18](https://github.com/strxnd/murmur/issues/18): No CI workflow enforces the local verification path.
- `DA-023` [#19](https://github.com/strxnd/murmur/issues/19): Production dependency audit fails because geist pulls Next and a vulnerable PostCSS.

## Current State

- Completed: audit findings were harvested and turned into GitHub issues; all assigned issues were open when checked with `gh issue list` on 2026-06-27.
- In progress: no implementation started in this handoff.
- Not started: all code, tests, dependency changes, CI workflow, and verification for this scope.
- Blockers: runtime release URL remediation may require GitHub release ownership or publishing credentials outside the local repo.

## Key Context

- Relevant files: `src/shared/model-catalog.ts`, `src/shared/stt-runtime-catalog.ts`, `src/shared/types.ts`, `src/main/services/model-library.ts`, `src/main/services/stt-runtime.ts`, `src/main/services/storage.ts`, `src/main/app-controller.ts`, `src/main/services/http.ts`, `scripts/check-runtime-manifest.mjs`, `scripts/stage-bundled-runtimes.mjs`, `scripts/build-linux-fast-paste.mjs`, `package.json`, `package-lock.json`, `.github/workflows/*`, docs/font imports.
- Relevant commands already run:
  - `git rev-parse HEAD` -> `be6e1717253c0ff5194bf5dcb70d985778f0b757`.
  - `git status --short --branch` -> `## main...origin/main`, plus dirty `.gitignore` and deleted old audit markdown.
  - `gh issue list --repo strxnd/murmur --state all --limit 200 --json ...` -> 25 open `Audit DA-*` issues.
  - Current `package.json` scripts include `build`, `test`, `runtimes:manifest-check`, `linux-helper:build`, `pack`, and `dist`.
  - Harvest baseline recorded `mise run test` passed with 160 tests and `mise run build` passed before implementation.
  - Harvest recorded `npm audit --omit=dev --audit-level=moderate` failed through `geist -> next -> postcss`.
  - Harvest recorded all four cataloged runtime asset URL checks returned HTTP 404.
- Important decisions:
  - Keep this terminal scoped to the assigned storage/download/release issues.
  - Packaged builds should continue to rely on bundled runtimes; do not reintroduce remote runtime downloads for packaged apps.
  - Runtime manifest release-mode checks should verify reachability, while local fast checks can remain shape/local checks.
  - Retention must not delete user data except according to explicit `textRetentionDays` semantics.
  - Package scripts in `package.json` remain the source of truth; keep `mise` task behavior aligned.
- Constraints/non-goals:
  - Do not infer release truth from stale `dist/`.
  - Do not make model downloads require network beyond the selected artifact URL.
  - Preserve existing history item schema where possible.
  - Do not duplicate Terminal 2 provider STT/LLM timeout work; reuse helpers if they already exist, but own download-timeout behavior here.
  - Do not implement renderer UX/accessibility issues from Terminal 4.

## Evidence Map

| Path or Command | Why it matters |
| --- | --- |
| `.codex/harvests/murmur-full-repo-harvest-20260627-164254.md` | Source plan; combines AH-B05 and AH-B06 plus download-timeout part of AH-B04. |
| `src/main/services/model-library.ts` | Model download, progress persistence, artifact activation, and archive handling. |
| `src/main/services/stt-runtime.ts` | Runtime download body reads, extraction, cache receipts, and cleanup. |
| `src/main/services/storage.ts` | History/config persistence, retention, atomic write behavior. |
| `src/shared/model-catalog.ts` | Needs pinned model/archive SHA-256 metadata. |
| `src/shared/stt-runtime-catalog.ts` | Runtime asset URL metadata and 404 finding. |
| `scripts/check-runtime-manifest.mjs` | Current manifest verification does not enforce release URL reachability. |
| `scripts/stage-bundled-runtimes.mjs` | Current staging defaults to host platform. |
| `scripts/build-linux-fast-paste.mjs` and `package.json` | Linux helper must be built or explicitly optional before packaging consumes it. |
| `.github/` | Harvest found no CI workflow files. |
| `npm audit --omit=dev --audit-level=moderate` | Required production audit verification. |
| `npm ls next postcss --all` | Verifies removal of vulnerable Geist/Next/PostCSS chain. |

## Risks and Open Questions

- This is the broadest terminal. Sequence it as storage/download correctness first, then release/CI/dependency checks, to reduce merge conflict risk.
- Runtime asset URL remediation may need publishing assets, not just code. If publishing is unavailable, implement release-mode verification and document the external asset gap.
- Model hashes require correct upstream artifact digests. Do not invent hashes; compute from trusted downloaded artifacts or source-controlled fixtures.
- Atomic writes should be tested with injected failures; be careful not to truncate existing config/history on test failure.
- CI may expose failures that were not visible locally. Keep workflow aligned with `mise install`, `npm ci`, `mise run lint`, `mise run test`, `mise run build`, and runtime manifest checks.

## Next Steps

1. Create a dedicated worktree/branch for this packet, for example `git worktree add ../murmur-storage-download-release -b audit/storage-download-release`.
2. Add body timeout behavior and cleanup for model and runtime downloads, reusing Terminal 2 helpers if present.
3. Add model catalog SHA-256 metadata and validate direct files before final activation.
4. Verify archive hashes before extraction and reject unsafe archive members before extraction.
5. Throttle download progress persistence and use narrower progress emissions where practical.
6. Define and enforce `textRetentionDays`, including `0`, on startup/read/write/settings changes and delete retained audio for pruned rows.
7. Make JSON writes temp-file/fsync/rename based and SQLite rewrites transactional.
8. Add runtime manifest release/CI mode for remote asset reachability.
9. Fix or document cataloged runtime asset URL availability while keeping packaged builds bundled-runtime based.
10. Make Linux helper packaging clean-checkout safe by building before `pack`/`dist` or explicitly making it optional with tests/docs.
11. Make runtime staging target-aware with explicit platform/arch and fixture tests for `linux-x64` and `linux-arm64`.
12. Add GitHub Actions CI using mise and the local verification path.
13. Replace `geist` or otherwise remove the `geist -> next -> postcss` production dependency path.
14. Run verification and update/close only the assigned GitHub issues if the checks pass.

## Acceptance Criteria

- Header-flushed stalled bodies timeout for model and runtime downloads.
- Timeout cleanup removes `.part` files, extraction staging, cache receipts, and persisted download state.
- Hash mismatch leaves no activated model artifact and produces a recoverable error state.
- Unsafe archives are rejected before extraction.
- Large downloads have bounded storage writes and renderer broadcasts.
- Old history beyond retention is pruned in SQLite and JSON backends, including retained audio cleanup.
- Injected write failures do not truncate config or clear history.
- Runtime release URL reachability is checked in release CI or an explicit release verification command.
- Clean-checkout packaging builds or safely handles `resources/bin/linux-fast-paste`.
- Cross-target runtime staging stages the requested platform/arch.
- CI enforces the local verification path.
- `npm audit --omit=dev --audit-level=moderate` passes.
- `npm ls next postcss` no longer shows Next through Geist.
- `mise run test` passes.
- `mise run build` passes.

## Fresh-Session Prompt

```text
Read this handoff packet: /home/kumaraarav/dev/murmur/.codex/handoffs/terminal-3-storage-download-release-20260627-193616.md

Goal: implement only the Terminal 3 storage/download/release scope for DA-008, DA-009, DA-010, DA-011, DA-012, DA-013, DA-014, DA-015, DA-021, and DA-023 in strxnd/murmur.

Continue from the packet. Preserve the listed constraints, coordinate before changing provider timeout behavior owned by Terminal 2, do not implement other audit issues, do not revert unrelated dirty worktree changes, and verify with the listed acceptance checks before reporting back.
```
