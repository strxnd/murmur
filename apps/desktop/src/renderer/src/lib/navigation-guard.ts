export type GuardedSectionId = "home" | "modes" | "vocabulary" | "configuration" | "providers" | "models" | "history";

export function shouldGuardNavigation(options: {
  currentSection: GuardedSectionId;
  nextSection: GuardedSectionId;
  hasUnsavedConfigurationChanges: boolean;
  hasUnsavedModeChanges: boolean;
}): boolean {
  return (
    options.nextSection !== options.currentSection &&
    ((options.currentSection === "configuration" && options.hasUnsavedConfigurationChanges) ||
      (options.currentSection === "modes" && options.hasUnsavedModeChanges))
  );
}
