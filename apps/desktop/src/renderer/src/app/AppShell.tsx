import { Tabs } from "@base-ui/react/tabs";
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
import { useEffect, useState, type JSX } from "react";
import type { AppStateSnapshot } from "../../../shared/types";
import { shouldGuardNavigation } from "../lib/navigation-guard";
import { shouldAutoOpenOnboarding } from "../lib/onboarding";
import { ConfigurationView } from "../views/ConfigurationView";
import { HistoryView } from "../views/HistoryView";
import { HomeView } from "../views/HomeView";
import { ModelsLibraryView } from "../views/ModelsLibraryView";
import { ModesView } from "../views/ModesView";
import { OnboardingWizard } from "../views/OnboardingWizard";
import { ProvidersView } from "../views/ProvidersView";
import { VocabularyView } from "../views/VocabularyView";

type SectionId = "home" | "modes" | "vocabulary" | "configuration" | "providers" | "models" | "history";

interface Section {
  id: SectionId;
  label: string;
  icon: LucideIcon;
}

const workspaceSections: Section[] = [
  { id: "home", label: "Home", icon: House },
  { id: "modes", label: "Modes", icon: SlidersHorizontal },
  { id: "vocabulary", label: "Vocabulary", icon: BookOpen },
  { id: "history", label: "History", icon: Clock3 }
];

const systemSections: Section[] = [
  { id: "models", label: "Models", icon: Library },
  { id: "providers", label: "Providers", icon: KeyRound },
  { id: "configuration", label: "Settings", icon: Settings }
];

const panelClassName = "h-full min-h-0 overflow-auto outline-none";

export function AppShell({ state }: { state: AppStateSnapshot }): JSX.Element {
  const [activeSection, setActiveSection] = useState<SectionId>("home");
  const [configurationHasUnsavedChanges, setConfigurationHasUnsavedChanges] = useState(false);
  const [modesHaveUnsavedChanges, setModesHaveUnsavedChanges] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [autoPromptedOnboarding, setAutoPromptedOnboarding] = useState(false);

  useEffect(() => {
    if (autoPromptedOnboarding || !shouldAutoOpenOnboarding(state)) return;
    setAutoPromptedOnboarding(true);
    setOnboardingOpen(true);
  }, [autoPromptedOnboarding, state]);

  useEffect(() => {
    if (!configurationHasUnsavedChanges && !modesHaveUnsavedChanges) return;

    const preventUnsavedChangesLoss = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", preventUnsavedChangesLoss);
    return () => window.removeEventListener("beforeunload", preventUnsavedChangesLoss);
  }, [configurationHasUnsavedChanges, modesHaveUnsavedChanges]);

  const changeSection = (nextSection: SectionId): void => {
    if (
      shouldGuardNavigation({
        currentSection: activeSection,
        nextSection,
        hasUnsavedConfigurationChanges: configurationHasUnsavedChanges,
        hasUnsavedModeChanges: modesHaveUnsavedChanges
      }) &&
      !window.confirm(
        activeSection === "modes"
          ? "You have an unsaved mode draft or edits. Discard them and switch views?"
          : "You have unsaved configuration changes. Discard them and switch views?"
      )
    ) {
      return;
    }

    setActiveSection(nextSection);
  };

  const isRecording = state.session.status === "recording";
  const isMac = /mac|iphone|ipad|ipod/i.test(globalThis.navigator?.platform ?? "");

  return (
    <>
      <Tabs.Root
        value={activeSection}
        onValueChange={(value) => changeSection(value as SectionId)}
        orientation="vertical"
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

          <Tabs.List aria-label="Main navigation" className="voice-console-navigation">
            <NavigationGroup label="Workspace" sections={workspaceSections} />
            <NavigationGroup label="System" sections={systemSections} />
          </Tabs.List>
        </aside>

        <main className="floating-studio-canvas">
          <div className="floating-studio-content">
            <Tabs.Panel value="home" id="home" className={panelClassName}>
              <HomeView
                state={state}
                onOpenModels={() => changeSection("models")}
                onOpenHistory={() => changeSection("history")}
                onOpenOnboarding={() => setOnboardingOpen(true)}
              />
            </Tabs.Panel>
            <Tabs.Panel value="modes" id="modes" className={panelClassName}>
              <ModesView state={state} onUnsavedChangesChange={setModesHaveUnsavedChanges} />
            </Tabs.Panel>
            <Tabs.Panel value="vocabulary" id="vocabulary" className={panelClassName}>
              <VocabularyView state={state} />
            </Tabs.Panel>
            <Tabs.Panel value="configuration" id="configuration" className={panelClassName}>
              <ConfigurationView state={state} onUnsavedChangesChange={setConfigurationHasUnsavedChanges} />
            </Tabs.Panel>
            <Tabs.Panel value="providers" id="providers" className={panelClassName}>
              <ProvidersView state={state} />
            </Tabs.Panel>
            <Tabs.Panel value="models" id="models" className={panelClassName}>
              <ModelsLibraryView state={state} onOpenProviders={() => changeSection("providers")} />
            </Tabs.Panel>
            <Tabs.Panel value="history" id="history" className={panelClassName}>
              <HistoryView state={state} />
            </Tabs.Panel>
          </div>
        </main>
      </Tabs.Root>
      <OnboardingWizard state={state} open={onboardingOpen} onOpenChange={setOnboardingOpen} />
    </>
  );
}

function NavigationGroup({ label, sections }: { label: string; sections: Section[] }): JSX.Element {
  return (
    <div className="voice-console-navigation-group" role="presentation">
      <span className="voice-console-navigation-label">{label}</span>
      {sections.map((section) => {
        const Icon = section.icon;
        return (
          <Tabs.Tab key={section.id} value={section.id} className="voice-console-navigation-button">
            <Icon size={17} aria-hidden="true" />
            <span>{section.label}</span>
          </Tabs.Tab>
        );
      })}
    </div>
  );
}
