export type GuardedSectionId = "home" | "modes" | "vocabulary" | "configuration" | "providers" | "models" | "history";

export function shouldGuardConfigurationNavigation(options: {
  currentSection: GuardedSectionId;
  nextSection: GuardedSectionId;
  hasUnsavedConfigurationChanges: boolean;
}): boolean {
  return (
    options.hasUnsavedConfigurationChanges &&
    options.currentSection === "configuration" &&
    options.nextSection !== "configuration"
  );
}
