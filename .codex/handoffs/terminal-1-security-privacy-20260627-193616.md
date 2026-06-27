# Handoff Packet: Terminal 1 Security, Privacy, and Trust Boundaries

- Target: `/home/kumaraarav/dev/murmur`
- Packet: `/home/kumaraarav/dev/murmur/.codex/handoffs/terminal-1-security-privacy-20260627-193616.md`
- Timestamp: `2026-06-27 19:36:16 +08`
- Commit: `be6e1717253c0ff5194bf5dcb70d985778f0b757`
- Worktree status: dirty before this packet: `.gitignore` modified, `.codex/audits/murmur-full-repo-20260627-114324.md` deleted; do not revert unrelated changes.
- Recipient: future Codex implementation session for one dedicated terminal/worktree.
- Suggested branch/worktree: `audit/security-privacy`

## Goal

Implement the audit security/privacy scope only: renderer trust boundary, IPC runtime validation, provider secret storage/redaction, cloud-context privacy gating, and owner-only permissions for sensitive files.

Assigned GitHub issues:

- `DA-001` [#3](https://github.com/strxnd/murmur/issues/3): Renderer trust boundary can expose the full preload bridge to unintended content.
- `DA-002` [#4](https://github.com/strxnd/murmur/issues/4): Main IPC accepts most privileged request payloads without runtime validation.
- `DA-003` [#6](https://github.com/strxnd/murmur/issues/6): Provider API keys are stored plaintext and returned to renderer snapshots.
- `DA-004` [#8](https://github.com/strxnd/murmur/issues/8): Cloud LLM prompts can include clipboard and selected text by default.
- `DA-020` [#11](https://github.com/strxnd/murmur/issues/11): Sensitive local files rely on process umask and parent directory permissions.

## Current State

- Completed: audit findings were harvested and turned into GitHub issues; all assigned issues were open when checked with `gh issue list` on 2026-06-27.
- In progress: no implementation started in this handoff.
- Not started: all code, tests, migration behavior, and verification for this scope.
- Blockers: none known locally. Secret-storage implementation choice is open.

## Key Context

- Relevant files: `src/main/app-controller.ts`, `src/preload/index.ts`, `src/shared/schemas.ts`, `src/shared/types.ts`, `src/shared/defaults.ts`, `src/shared/prompts.ts`, `src/main/services/storage.ts`, `src/main/services/app-paths.ts`, `src/main/services/stt.ts`, `src/main/services/llm.ts`, provider settings renderer UI.
- Relevant commands already run:
  - `git rev-parse HEAD` -> `be6e1717253c0ff5194bf5dcb70d985778f0b757`.
  - `git status --short --branch` -> `## main...origin/main`, plus dirty `.gitignore` and deleted old audit markdown.
  - `gh issue list --repo strxnd/murmur --state all --limit 200 --json ...` -> 25 open `Audit DA-*` issues.
  - Harvest baseline recorded `mise run test` passed with 160 tests and `mise run build` passed before implementation.
- Important decisions:
  - Keep this terminal scoped to `DA-001`, `DA-002`, `DA-003`, `DA-004`, and `DA-020`.
  - Implement runtime validation in main before privileged side effects, not just renderer-side typing.
  - Raw provider secrets must not appear in persisted config snapshots or `window.murmur.getState()`.
  - Cloud context must be explicit opt-in for cloud LLMs; do not remove local-context behavior for local LLMs.
- Constraints/non-goals:
  - Preserve `mise run dev` with the expected localhost dev renderer origin.
  - Packaged builds must ignore hostile `ELECTRON_RENDERER_URL`.
  - Do not remove preload API methods unless intentionally deprecated in code and tests.
  - Do not log or display real secrets.
  - Do not implement recording, storage/download, release, or renderer UX issues from other terminal packets.

## Evidence Map

| Path or Command | Why it matters |
| --- | --- |
| `.codex/harvests/murmur-full-repo-harvest-20260627-164254.md` | Source plan; combines `DA-001/002` as AH-B01 and `DA-003/004/020` as AH-B02. |
| `src/main/app-controller.ts` | BrowserWindow loading, IPC handlers, snapshots, provider calls, and side effects. |
| `src/preload/index.ts` | Privileged renderer bridge exposed as `window.murmur`. |
| `src/shared/schemas.ts` | Existing schema definitions; audit says they are not applied broadly to main IPC. |
| `src/main/services/storage.ts` | Persisted provider config, history/config writes, and local file modes. |
| `src/shared/prompts.ts` | Clipboard/selection/app context inclusion in LLM prompts. |
| `src/main/services/app-paths.ts` | Config/data directory creation and permissions boundary. |
| `gh issue list --repo strxnd/murmur --state all --limit 200 --json ...` | Verified assigned GitHub issues exist and are open. |

## Risks and Open Questions

- Secret storage needs a concrete choice. Prefer an OS keychain if already practical; otherwise use a main-process secret store with narrow permissions and migration tests.
- IPC sender-frame authorization must handle dev server, packaged file URLs, and tests without breaking normal renderer calls.
- Payload validation may require adding schemas for existing IPC shapes; keep schemas shared and avoid duplicate local type shapes.
- Coordinate with Terminal 2 if timeout/session error plumbing changes shared app-controller error paths.

## Next Steps

1. Create a dedicated worktree/branch for this packet, for example `git worktree add ../murmur-security-privacy -b audit/security-privacy`.
2. Implement renderer-origin policy and navigation/window-open protections for BrowserWindows that receive the preload.
3. Add CSP for packaged renderer and appropriate dev behavior.
4. Add IPC sender authorization and schema parsing for privileged handlers before mutations or provider calls.
5. Add size limits for large text/audio-like IPC payloads where they cross privileged boundaries.
6. Implement provider secret migration/redaction and ensure main resolves secrets only at call time.
7. Add explicit cloud-context opt-in and omit clipboard/selection/window metadata for cloud LLM prompts by default.
8. Create or repair sensitive directories/files with owner-only modes.
9. Add focused tests for origin policy, invalid IPC payloads, oversized payloads, secret migration/redaction, cloud prompt gating, and permissive `umask`.
10. Run the verification commands and update/close only the assigned GitHub issues if the checks pass.

## Acceptance Criteria

- Packaged builds ignore `ELECTRON_RENDERER_URL`.
- Unexpected navigation/new-window attempts cannot retain access to the preload bridge.
- Invalid privileged IPC payloads fail with typed errors and do not mutate storage, broadcast state, call providers, paste text, or delete data.
- Config files and renderer snapshots do not contain raw API keys after saving provider settings.
- Existing provider calls still authenticate after migration.
- Cloud LLM prompts omit clipboard/selection/window metadata unless the opt-in is enabled.
- Sensitive files/directories are owner-only under permissive `umask`.
- `mise run test` passes.
- `mise run build` passes.
- Manual hostile packaged launch check is either completed or explicitly documented as not run.

## Fresh-Session Prompt

```text
Read this handoff packet: /home/kumaraarav/dev/murmur/.codex/handoffs/terminal-1-security-privacy-20260627-193616.md

Goal: implement only the Terminal 1 security/privacy scope for DA-001, DA-002, DA-003, DA-004, and DA-020 in strxnd/murmur.

Continue from the packet. Preserve the listed constraints, do not implement other audit issues, do not revert unrelated dirty worktree changes, and verify with the listed acceptance checks before reporting back.
```
