import { Tabs } from "@base-ui/react/tabs";
import { BookOpen, Clock3, Home, KeyRound, Library, Settings, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { useEffect, useState, type JSX } from "react";
import type { AppStateSnapshot } from "../../../shared/types";
import { HomeView } from "../views/HomeView";
import { ModesView } from "../views/ModesView";
import { VocabularyView } from "../views/VocabularyView";
import { ConfigurationView } from "../views/ConfigurationView";
import { ProvidersView } from "../views/ProvidersView";
import { ModelsLibraryView } from "../views/ModelsLibraryView";
import { HistoryView } from "../views/HistoryView";
import { cn } from "../lib/cn";
import { shouldAutoOpenOnboarding } from "../lib/onboarding";
import { OnboardingWizard } from "../views/OnboardingWizard";

type SectionId = "home" | "modes" | "vocabulary" | "configuration" | "providers" | "models" | "history";

const sections: Array<{ id: SectionId; label: string; icon: LucideIcon }> = [
  { id: "home", label: "Home", icon: Home },
  { id: "modes", label: "Modes", icon: SlidersHorizontal },
  { id: "vocabulary", label: "Vocabulary", icon: BookOpen },
  { id: "configuration", label: "Configuration", icon: Settings },
  { id: "providers", label: "Providers", icon: KeyRound },
  { id: "models", label: "Models", icon: Library },
  { id: "history", label: "History", icon: Clock3 }
];

export function AppShell({ state }: { state: AppStateSnapshot }): JSX.Element {
  const [activeSection, setActiveSection] = useState<SectionId>("home");
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [autoPromptedOnboarding, setAutoPromptedOnboarding] = useState(false);
  const isCompact = useMediaQuery("(max-width: 980px)");

  useEffect(() => {
    if (autoPromptedOnboarding || !shouldAutoOpenOnboarding(state)) return;
    setAutoPromptedOnboarding(true);
    setOnboardingOpen(true);
  }, [autoPromptedOnboarding, state]);

  return (
    <>
      <Tabs.Root
        value={activeSection}
        onValueChange={(value) => setActiveSection(value as SectionId)}
        orientation={isCompact ? "horizontal" : "vertical"}
        className="grid h-screen grid-cols-[16rem_minmax(0,1fr)] bg-background text-foreground max-[980px]:grid-cols-1 max-[980px]:grid-rows-[auto_minmax(0,1fr)]"
      >
        <aside className="flex min-w-0 flex-col border-r border-border bg-surface max-[980px]:sticky max-[980px]:top-0 max-[980px]:z-30 max-[980px]:border-b max-[980px]:border-r-0">
        <div className="flex min-h-20 items-center gap-3 border-b border-border px-4 max-[980px]:min-h-16">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-border bg-foreground font-display text-2xl text-background">
            M
          </div>
          <div className="min-w-0">
            <div className="truncate font-display text-2xl leading-none text-foreground">Murmur</div>
            <div className="mt-1 flex items-center gap-2 text-xs capitalize text-muted-foreground">
              <span className={cn("h-1.5 w-1.5 rounded-full bg-muted-foreground", state.session.status === "recording" && "animate-pulse bg-foreground")} />
              {state.session.status}
            </div>
          </div>
        </div>

        <Tabs.List className="flex flex-1 flex-col gap-1 p-3 max-[980px]:flex-row max-[980px]:overflow-x-auto">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <Tabs.Tab
                key={section.id}
                value={section.id}
                className="flex min-h-10 items-center gap-2 rounded-md px-3 text-left text-sm text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/30 data-[active]:bg-foreground data-[active]:font-medium data-[active]:text-background max-[980px]:shrink-0"
              >
                <Icon size={16} />
                <span className="truncate">{section.label}</span>
              </Tabs.Tab>
            );
          })}
        </Tabs.List>

        </aside>

        <section className="min-w-0 overflow-auto">
          <Tabs.Panel value="home" id="home" className="outline-none">
            <HomeView
              state={state}
              onOpenModels={() => setActiveSection("models")}
              onOpenOnboarding={() => setOnboardingOpen(true)}
            />
          </Tabs.Panel>
          <Tabs.Panel value="modes" id="modes" className="outline-none">
            <ModesView state={state} />
          </Tabs.Panel>
          <Tabs.Panel value="vocabulary" id="vocabulary" className="outline-none">
            <VocabularyView state={state} />
          </Tabs.Panel>
          <Tabs.Panel value="configuration" id="configuration" className="outline-none">
            <ConfigurationView state={state} />
          </Tabs.Panel>
          <Tabs.Panel value="providers" id="providers" className="outline-none">
            <ProvidersView state={state} />
          </Tabs.Panel>
          <Tabs.Panel value="models" id="models" className="outline-none">
            <ModelsLibraryView state={state} />
          </Tabs.Panel>
          <Tabs.Panel value="history" id="history" className="outline-none">
            <HistoryView state={state} />
          </Tabs.Panel>
        </section>
      </Tabs.Root>
      <OnboardingWizard state={state} open={onboardingOpen} onOpenChange={setOnboardingOpen} />
    </>
  );
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const handleChange = (): void => setMatches(media.matches);
    handleChange();
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}
