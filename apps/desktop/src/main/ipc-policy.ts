export type RendererRole = "main" | "pill" | "mode-selector";

const mainRendererChannels = new Set([
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
]);

const channelsByRole: Record<RendererRole, ReadonlySet<string>> = {
  main: mainRendererChannels,
  pill: new Set(["app:get-pill-state"]),
  "mode-selector": new Set([
    "app:get-mode-selector-state",
    "mode-selector:hide",
    "mode-selector:select-mode",
    "mode-selector:move-selection"
  ])
};

export function isIpcChannelAllowed(role: RendererRole, channel: string): boolean {
  return channelsByRole[role].has(channel);
}

export function rendererRoleArgument(role: RendererRole): string {
  return `--murmur-renderer-role=${role}`;
}
