import { Tabs } from "@base-ui/react/tabs";
import {
  AudioLines,
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
import { cn } from "../lib/cn";
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

const sections: Array<{ id: SectionId; label: string; icon: LucideIcon }> = [
  { id: "home", label: "Home", icon: House },
  { id: "modes", label: "Modes", icon: SlidersHorizontal },
  { id: "vocabulary", label: "Vocabulary", icon: BookOpen },
  { id: "history", label: "History", icon: Clock3 },
  { id: "models", label: "Models", icon: Library },
  { id: "providers", label: "Providers", icon: KeyRound },
  { id: "configuration", label: "Settings", icon: Settings }
];

const sessionStatusLabels: Record<AppStateSnapshot["session"]["status"], string> = {
  idle: "Ready",
  recording: "Listening",
  transcribing: "Transcribing",
  processing: "Refining text",
  pasting: "Pasting",
  complete: "Complete",
  cancelled: "Cancelled",
  error: "Needs attention"
};

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

  const sessionLabel = sessionStatusLabels[state.session.status];
  const isRecording = state.session.status === "recording";

  return (
    <>
      <Tabs.Root
        value={activeSection}
        onValueChange={(value) => changeSection(value as SectionId)}
        orientation="horizontal"
        className="floating-studio grid h-screen grid-rows-[52px_minmax(0,1fr)] overflow-hidden bg-background text-foreground"
        data-recording={isRecording || undefined}
      >
        <header className="floating-studio-header">
          <div className="floating-studio-identity">
            <span className="floating-studio-logo" aria-hidden="true"><AudioLines size={18} /></span>
            <span className="text-[13px] font-semibold">Murmur</span>
          </div>
          <div className="floating-studio-session" aria-live="polite">
            <span className={cn("h-1.5 w-1.5 rounded-full bg-subtle", isRecording && "animate-pulse bg-foreground")} />
            <span>{sessionLabel}</span>
          </div>
        </header>

        <main className="floating-studio-canvas">
          <div className="floating-studio-content">
            <Tabs.Panel value="home" id="home" className={panelClassName}>
              <HomeView
                state={state}
                onOpenModels={() => changeSection("models")}
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
              <ModelsLibraryView state={state} />
            </Tabs.Panel>
            <Tabs.Panel value="history" id="history" className={panelClassName}>
              <HistoryView state={state} />
            </Tabs.Panel>
          </div>
        </main>

        <div className="floating-studio-utility" aria-label="Recording shortcut">
          <AudioLines size={16} />
          <span>{isRecording ? "Audio stream active" : `${state.settings.activationHotkey} to record`}</span>
        </div>

        <Tabs.List aria-label="Main navigation" className="floating-studio-dock">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <Tabs.Tab
                key={section.id}
                value={section.id}
                title={section.label}
                className="floating-studio-dock-button"
              >
                <Icon size={19} />
                <span>{section.label}</span>
              </Tabs.Tab>
            );
          })}
        </Tabs.List>
      </Tabs.Root>
      <OnboardingWizard state={state} open={onboardingOpen} onOpenChange={setOnboardingOpen} />
    </>
  );
}
