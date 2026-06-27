export function modeSelectorOptionId(modeId: string): string {
  return `mode-selector-option-${modeId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}
