import { describe, expect, it } from "vitest";
import { ipcChannelsByRole, isIpcChannelAllowed, rendererRoleArgument, type RendererRole } from "./ipc-policy";

const expectedChannelsByRole = {
  main: [
    "app:get-state",
    "automation:permission-status",
    "automation:permission-request",
    "settings:update",
    "hotkeys:capture-start",
    "hotkeys:capture-end",
    "modes:set",
    "mode:activate",
    "providers:set-stt",
    "providers:set-llm",
    "provider:validate-stt",
    "provider:validate-llm",
    "codex:refresh",
    "codex:login-start",
    "codex:login-cancel",
    "codex:logout",
    "rules:set-auto-mode",
    "vocabulary:set",
    "models:get-library",
    "models:download",
    "models:cancel-download",
    "models:activate",
    "models:delete",
    "models:toggle-favorite",
    "stt-setup:get",
    "stt-runtime:download",
    "stt-runtime:repair",
    "stt-runtime:cancel-download",
    "stt-setup:setup-bundled",
    "stt-setup:skip",
    "dictation:start",
    "dictation:stop",
    "dictation:cancel",
    "dictation:complete-recording",
    "dictation:recording-error",
    "recording:level",
    "onboarding:test-paste",
    "onboarding:dictation-scope",
    "history:copy",
    "history:repaste",
    "history:delete",
    "history:clear",
    "history:reprocess",
    "data:clear-local"
  ],
  pill: ["app:get-pill-state"],
  "mode-selector": [
    "app:get-mode-selector-state",
    "mode-selector:hide",
    "mode-selector:select-mode",
    "mode-selector:move-selection"
  ]
} as const satisfies Record<RendererRole, readonly string[]>;

const rendererRoles = Object.keys(expectedChannelsByRole) as RendererRole[];
const knownChannels = new Set(rendererRoles.flatMap((role) => [...expectedChannelsByRole[role]]));

describe("renderer IPC policy", () => {
  it("matches the complete reviewed channel allowlist for every renderer role", () => {
    for (const role of rendererRoles) {
      expect(ipcChannelsByRole[role]).toEqual(expectedChannelsByRole[role]);
      const expectedChannels = new Set<string>(expectedChannelsByRole[role]);
      for (const channel of knownChannels) {
        expect(isIpcChannelAllowed(role, channel), `${role} access to ${channel}`).toBe(expectedChannels.has(channel));
      }
    }
  });

  it("denies unknown and explicitly privileged channels outside their roles", () => {
    for (const role of rendererRoles) expect(isIpcChannelAllowed(role, "unknown:channel")).toBe(false);
    expect(isIpcChannelAllowed("pill", "settings:update")).toBe(false);
    expect(isIpcChannelAllowed("pill", "dictation:cancel")).toBe(false);
    expect(isIpcChannelAllowed("mode-selector", "data:clear-local")).toBe(false);
    expect(isIpcChannelAllowed("mode-selector", "app:get-state")).toBe(false);
  });

  it("encodes immutable renderer roles in BrowserWindow arguments", () => {
    expect(rendererRoleArgument("mode-selector")).toBe("--murmur-renderer-role=mode-selector");
  });
});
