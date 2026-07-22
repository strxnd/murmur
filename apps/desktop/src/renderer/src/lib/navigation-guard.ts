export const mainRoutePaths = {
  home: "/home",
  modes: "/modes",
  vocabulary: "/vocabulary",
  history: "/history",
  models: "/models",
  providers: "/providers",
  configuration: "/configuration"
} as const;

export type GuardedSectionId = keyof typeof mainRoutePaths;
export type MainRoutePath = (typeof mainRoutePaths)[GuardedSectionId];

const unsavedModeChangesMessage = "You have an unsaved mode draft or edits. Discard them and switch views?";
const unsavedConfigurationChangesMessage = "You have unsaved configuration changes. Discard them and switch views?";

export function sectionIdFromPathname(pathname: string): GuardedSectionId | null {
  const normalizedPathname = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const entry = Object.entries(mainRoutePaths).find(([, path]) => path === normalizedPathname);
  return (entry?.[0] as GuardedSectionId | undefined) ?? null;
}

export function shouldGuardNavigation(options: {
  currentSection: GuardedSectionId;
  nextSection: GuardedSectionId | null;
  hasUnsavedConfigurationChanges: boolean;
  hasUnsavedModeChanges: boolean;
}): boolean {
  return (
    options.nextSection !== options.currentSection &&
    ((options.currentSection === "configuration" && options.hasUnsavedConfigurationChanges) ||
      (options.currentSection === "modes" && options.hasUnsavedModeChanges))
  );
}

export function navigationGuardMessage(options: {
  currentPathname: string;
  nextPathname: string;
  hasUnsavedConfigurationChanges: boolean;
  hasUnsavedModeChanges: boolean;
}): string | null {
  const currentSection = sectionIdFromPathname(options.currentPathname);
  if (!currentSection) return null;

  if (
    !shouldGuardNavigation({
      currentSection,
      nextSection: sectionIdFromPathname(options.nextPathname),
      hasUnsavedConfigurationChanges: options.hasUnsavedConfigurationChanges,
      hasUnsavedModeChanges: options.hasUnsavedModeChanges
    })
  ) {
    return null;
  }

  return currentSection === "modes" ? unsavedModeChangesMessage : unsavedConfigurationChangesMessage;
}

export function hasUnsavedNavigationChanges(options: {
  hasUnsavedConfigurationChanges: boolean;
  hasUnsavedModeChanges: boolean;
}): boolean {
  return options.hasUnsavedConfigurationChanges || options.hasUnsavedModeChanges;
}
