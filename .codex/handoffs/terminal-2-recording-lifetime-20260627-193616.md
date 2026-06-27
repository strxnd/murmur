# Handoff Packet: Terminal 2 Recording Lifecycle and Bounded Runtime Cleanup

- Target: `/home/kumaraarav/dev/murmur`
- Packet: `/home/kumaraarav/dev/murmur/.codex/handoffs/terminal-2-recording-lifetime-20260627-193616.md`
- Timestamp: `2026-06-27 19:36:16 +08`
- Commit: `be6e1717253c0ff5194bf5dcb70d985778f0b757`
- Worktree status: dirty before this packet: `.gitignore` modified, `.codex/audits/murmur-full-repo-20260627-114324.md` deleted; do not revert unrelated changes.
- Recipient: future Codex implementation session for one dedicated terminal/worktree.
- Suggested branch/worktree: `audit/recording-lifetime`

## Goal

Implement the audit recording/lifetime cleanup scope only: stop-before-ready handling, bounded audio capture, provider response-body/SSE timeouts, visible timeout failure propagation, bounded whisper-server diagnostics, and clipboard polling disposal.

Assigned GitHub issues:

- `DA-005` [#5](https://github.com/strxnd/murmur/issues/5): Stop-before-recorder-ready can still strand a session.
- `DA-006` [#10](https://github.com/strxnd/murmur/issues/10): STT and LLM timeouts do not cover response body or SSE reads.
- `DA-007` [#9](https://github.com/strxnd/murmur/issues/9): Audio buffers are unbounded and copied on stop/IPC/STT.
- `DA-024` [#16](https://github.com/strxnd/murmur/issues/16): Long-lived whisper-server output is accumulated without a cap.
- `DA-025` [#20](https://github.com/strxnd/murmur/issues/20): Clipboard tracking interval is not disposed.

## Current State

- Completed: audit findings were harvested and turned into GitHub issues; all assigned issues were open when checked with `gh issue list` on 2026-06-27.
- In progress: no implementation started in this handoff.
- Not started: all code, tests, profiling, and verification for this scope.
- Blockers: none known locally. Coordinate with Terminal 3 before changing model/runtime download timeout helpers if both terminals are active.

## Key Context

- Relevant files: `src/main/app-controller.ts`, `src/renderer/src/hooks/useRecordingBridge.ts`, `src/preload/index.ts`, `src/main/services/http.ts`, `src/main/services/stt.ts`, `src/main/services/llm.ts`, `src/main/services/context.ts`, recording tests/service tests.
- Relevant commands already run:
  - `git rev-parse HEAD` -> `be6e1717253c0ff5194bf5dcb70d985778f0b757`.
  - `git status --short --branch` -> `## main...origin/main`, plus dirty `.gitignore` and deleted old audit markdown.
  - `gh issue list --repo strxnd/murmur --state all --limit 200 --json ...` -> 25 open `Audit DA-*` issues.
  - Harvest baseline recorded `mise run test` passed with 160 tests and `mise run build` passed before implementation.
- Important decisions:
  - Keep this terminal scoped to `DA-005`, `DA-006`, `DA-007`, `DA-024`, and `DA-025`.
  - Recording fixes must preserve the current UX/pill state semantics unless max-duration feedback requires a narrow UI addition.
  - Provider timeout errors must flow back to app/session state visibly; hanging in `transcribing` is not acceptable.
  - Cleanup must not remove user-initiated cancellation behavior.
- Constraints/non-goals:
  - Do not regress local STT WAV expectations.
  - Do not change provider payloads except for abort/timeout control.
  - Do not implement model integrity, storage persistence, release, or renderer UX issues from other terminal packets.
  - If adding shared timeout helpers, keep the interface small enough for Terminal 3 to reuse for downloads.

## Evidence Map

| Path or Command | Why it matters |
| --- | --- |
| `.codex/harvests/murmur-full-repo-harvest-20260627-164254.md` | Source plan; maps `DA-005/007` to AH-B03 and `DA-006/024/025` to AH-B04. |
| `src/renderer/src/hooks/useRecordingBridge.ts` | Recorder startup, `getUserMedia`, audio buffering, and stop/cancel race behavior. |
| `src/main/app-controller.ts` | Main recording session lifecycle and terminal session state. |
| `src/main/services/http.ts` | Likely location for reusable timeout/body-read helpers. |
| `src/main/services/stt.ts` | STT provider calls, SSE/body reads, whisper-server output handling. |
| `src/main/services/llm.ts` | LLM body/SSE reads and timeout propagation. |
| `src/main/services/context.ts` | Clipboard tracking interval lifecycle. |
| `gh issue list --repo strxnd/murmur --state all --limit 200 --json ...` | Verified assigned GitHub issues exist and are open. |

## Risks and Open Questions

- Moving audio encoding/chunking off the renderer hot path may require a worker or transferable-buffer design; choose the smallest design that bounds memory and stop-time work.
- Session terminal state changes can interact with Terminal 1 IPC validation and Terminal 4 action-error UI.
- Provider timeout helpers may overlap with Terminal 3 download timeout work; prefer adding reusable helpers in one place and keeping download-specific changes in Terminal 3.
- Manual 5 and 10 minute recording profiling may be hard in automation; document exact manual result if completed.

## Next Steps

1. Create a dedicated worktree/branch for this packet, for example `git worktree add ../murmur-recording-lifetime -b audit/recording-lifetime`.
2. Add session-scoped recorder startup state and pending stop/cancel handling while mic startup is in flight.
3. Stop and release late-arriving streams for obsolete or already-stopped sessions.
4. Add acknowledgement or terminal error/cancel path so main does not wait indefinitely.
5. Replace unbounded `Float32Array[]` retention with bounded chunking, streaming, transferable buffers, or equivalent measured approach.
6. Add max recording duration and coherent state/user feedback.
7. Add total-timeout and idle-body-timeout behavior to STT/LLM body/SSE reads.
8. Ensure timeout errors reject through `AppController` into visible/recoverable session state.
9. Replace unbounded whisper-server retained output with a bounded ring buffer.
10. Store and clear context clipboard polling intervals in `ContextService.dispose()` and guard duplicate initialization.
11. Add focused lifecycle, timeout, ring-buffer, and interval-disposal tests.
12. Run verification and update/close only the assigned GitHub issues if the checks pass.

## Acceptance Criteria

- Start then immediate stop before mic readiness reaches a terminal session state and stops all tracks.
- Long recordings have bounded memory behavior and do not synchronously freeze the renderer on stop.
- Existing short recordings still transcribe successfully.
- A server that flushes headers and stalls the body causes bounded timeout for STT and LLM reads.
- Timeout errors leave session/UI state recoverable rather than stuck.
- Whisper diagnostics retained output remains bounded during verbose output.
- Context clipboard reads stop after dispose.
- `mise run test -- src/renderer/src/hooks/useRecordingBridge.test.ts src/main/app-controller.test.ts` passes once those tests exist.
- `mise run test -- src/main/services/http.test.ts src/main/services/stt.test.ts src/main/services/llm.test.ts src/main/services/context.test.ts` passes once those tests exist.
- `mise run test` passes.
- `mise run build` passes.

## Fresh-Session Prompt

```text
Read this handoff packet: /home/kumaraarav/dev/murmur/.codex/handoffs/terminal-2-recording-lifetime-20260627-193616.md

Goal: implement only the Terminal 2 recording/lifetime scope for DA-005, DA-006, DA-007, DA-024, and DA-025 in strxnd/murmur.

Continue from the packet. Preserve the listed constraints, coordinate before changing download-specific timeout behavior, do not implement other audit issues, do not revert unrelated dirty worktree changes, and verify with the listed acceptance checks before reporting back.
```
