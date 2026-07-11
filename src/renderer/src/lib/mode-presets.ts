import type { ModeConfig, ModePreset } from "../../../shared/types";

export function modeFromPreset(preset: ModePreset, modeId: string): ModeConfig {
  const isCustom = preset.id === "custom";
  return {
    id: modeId,
    iconKey: preset.iconKey,
    name: isCustom ? "New mode" : preset.name,
    description: isCustom ? "" : preset.description,
    aiEnabled: preset.aiEnabled,
    writingStyle: preset.writingStyle,
    instructionPrompt: preset.instructionPrompt,
    examples: preset.examples.map((example) => ({ ...example })),
    language: preset.language,
    context: { ...preset.context }
  };
}

export function matchingModePresetId(mode: ModeConfig, presets: ModePreset[]): string {
  return presets.find((preset) => modesMatch(mode, modeFromPreset(preset, mode.id)))?.id ?? "custom";
}

function modesMatch(left: ModeConfig, right: ModeConfig): boolean {
  return (
    left.iconKey === right.iconKey &&
    left.name === right.name &&
    left.description === right.description &&
    left.aiEnabled === right.aiEnabled &&
    left.writingStyle === right.writingStyle &&
    left.instructionPrompt === right.instructionPrompt &&
    left.language === right.language &&
    left.context.app === right.context.app &&
    left.context.selectedText === right.context.selectedText &&
    left.context.clipboardText === right.context.clipboardText &&
    JSON.stringify(left.examples) === JSON.stringify(right.examples)
  );
}
