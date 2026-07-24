import { describe, expect, it } from "vitest";
import { isIpcChannelAllowed, rendererRoleArgument } from "./ipc-policy";

describe("renderer IPC policy", () => {
  it("keeps privileged application channels exclusive to the main renderer", () => {
    expect(isIpcChannelAllowed("main", "settings:update")).toBe(true);
    expect(isIpcChannelAllowed("pill", "settings:update")).toBe(false);
    expect(isIpcChannelAllowed("mode-selector", "data:clear-local")).toBe(false);
  });

  it("allows each auxiliary renderer only its focused surface", () => {
    expect(isIpcChannelAllowed("pill", "app:get-pill-state")).toBe(true);
    expect(isIpcChannelAllowed("pill", "dictation:cancel")).toBe(false);
    expect(isIpcChannelAllowed("mode-selector", "app:get-mode-selector-state")).toBe(true);
    expect(isIpcChannelAllowed("mode-selector", "mode-selector:select-mode")).toBe(true);
    expect(isIpcChannelAllowed("mode-selector", "app:get-state")).toBe(false);
  });

  it("encodes immutable renderer roles in BrowserWindow arguments", () => {
    expect(rendererRoleArgument("mode-selector")).toBe("--murmur-renderer-role=mode-selector");
  });
});
