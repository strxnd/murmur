import { Link, Outlet, useBlocker } from "@tanstack/react-router";
import {
  BookOpen,
  Clock3,
  House,
  KeyRound,
  Library,
  Settings,
  SlidersHorizontal,
  type LucideIcon
} from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type JSX } from "react";
import type { AppStateSnapshot } from "../../../shared/types";
import {
  hasUnsavedNavigationChanges,
  mainRoutePaths,
  navigationGuardMessage,
  type GuardedSectionId,
  type MainRoutePath
} from "../lib/navigation-guard";
import { shouldAutoOpenOnboarding } from "../lib/onboarding";
import { OnboardingWizard } from "../views/OnboardingWizard";

interface Section {
  id: GuardedSectionId;
  path: MainRoutePath;
  label: string;
  icon: LucideIcon;
}

interface AppShellRouteActions {
  openOnboarding: () => void;
  setConfigurationHasUnsavedChanges: (hasUnsavedChanges: boolean) => void;
  setModesHaveUnsavedChanges: (hasUnsavedChanges: boolean) => void;
}

const AppShellRouteActionsContext = createContext<AppShellRouteActions | null>(null);

const workspaceSections: Section[] = [
  { id: "home", path: mainRoutePaths.home, label: "Home", icon: House },
  { id: "modes", path: mainRoutePaths.modes, label: "Modes", icon: SlidersHorizontal },
  { id: "vocabulary", path: mainRoutePaths.vocabulary, label: "Vocabulary", icon: BookOpen },
  { id: "history", path: mainRoutePaths.history, label: "History", icon: Clock3 }
];

const systemSections: Section[] = [
  { id: "models", path: mainRoutePaths.models, label: "Models", icon: Library },
  { id: "providers", path: mainRoutePaths.providers, label: "Providers", icon: KeyRound },
  { id: "configuration", path: mainRoutePaths.configuration, label: "Settings", icon: Settings }
];

export const routePanelClassName = "h-full min-h-0 overflow-auto outline-none";

export function AppShell({ state }: { state: AppStateSnapshot }): JSX.Element {
  const [configurationHasUnsavedChanges, setConfigurationHasUnsavedChanges] = useState(false);
  const [modesHaveUnsavedChanges, setModesHaveUnsavedChanges] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [autoPromptedOnboarding, setAutoPromptedOnboarding] = useState(false);

  useEffect(() => {
    if (autoPromptedOnboarding || !shouldAutoOpenOnboarding(state)) return;
    setAutoPromptedOnboarding(true);
    setOnboardingOpen(true);
  }, [autoPromptedOnboarding, state]);

  const shouldBlockNavigation = useCallback(
    ({ current, next }: { current: { pathname: string }; next: { pathname: string } }): boolean => {
      const message = navigationGuardMessage({
        currentPathname: current.pathname,
        nextPathname: next.pathname,
        hasUnsavedConfigurationChanges: configurationHasUnsavedChanges,
        hasUnsavedModeChanges: modesHaveUnsavedChanges
      });
      return message ? !window.confirm(message) : false;
    },
    [configurationHasUnsavedChanges, modesHaveUnsavedChanges]
  );
  const hasUnsavedChanges = hasUnsavedNavigationChanges({
    hasUnsavedConfigurationChanges: configurationHasUnsavedChanges,
    hasUnsavedModeChanges: modesHaveUnsavedChanges
  });

  useBlocker({
    shouldBlockFn: shouldBlockNavigation,
    enableBeforeUnload: hasUnsavedChanges,
    disabled: !hasUnsavedChanges
  });

  const openOnboarding = useCallback(() => setOnboardingOpen(true), []);
  const routeActions = useMemo<AppShellRouteActions>(
    () => ({
      openOnboarding,
      setConfigurationHasUnsavedChanges,
      setModesHaveUnsavedChanges
    }),
    [openOnboarding]
  );
  const isRecording = state.session.status === "recording";
  const isMac = /mac|iphone|ipad|ipod/i.test(globalThis.navigator?.platform ?? "");

  return (
    <AppShellRouteActionsContext.Provider value={routeActions}>
      <div
        className="floating-studio grid h-screen grid-cols-[224px_minmax(0,1fr)] overflow-hidden bg-background text-foreground"
        data-recording={isRecording || undefined}
        data-macos={isMac || undefined}
      >
        <aside className="voice-console">
          <div className="voice-console-identity">
            <span className="voice-console-brand-copy">
              <strong>Murmur</strong>
            </span>
          </div>

          <nav aria-label="Main navigation" className="voice-console-navigation">
            <NavigationGroup label="Workspace" sections={workspaceSections} />
            <NavigationGroup label="System" sections={systemSections} />
          </nav>
        </aside>

        <main className="floating-studio-canvas">
          <div className="floating-studio-content">
            <Outlet />
          </div>
        </main>
      </div>
      <OnboardingWizard state={state} open={onboardingOpen} onOpenChange={setOnboardingOpen} />
    </AppShellRouteActionsContext.Provider>
  );
}

export function useAppShellRouteActions(): AppShellRouteActions {
  const actions = useContext(AppShellRouteActionsContext);
  if (!actions) throw new Error("Route content must be rendered inside AppShell.");
  return actions;
}

function NavigationGroup({ label, sections }: { label: string; sections: Section[] }): JSX.Element {
  return (
    <div className="voice-console-navigation-group" role="group" aria-label={label}>
      <span className="voice-console-navigation-label">{label}</span>
      {sections.map((section) => {
        const Icon = section.icon;
        return (
          <Link
            key={section.id}
            to={section.path}
            activeOptions={{ exact: true }}
            activeProps={{ "data-active": "" }}
            className="voice-console-navigation-button"
          >
            <Icon size={17} aria-hidden="true" />
            <span>{section.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
