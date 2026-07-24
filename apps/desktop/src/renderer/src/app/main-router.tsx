import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory
} from "@tanstack/react-router";
import type { ReactNode, JSX } from "react";
import type { AppStateSnapshot } from "../../../shared/types";
import { mainRoutePaths, sectionIdFromPathname, type MainRoutePath } from "../lib/navigation-guard";
import { useMurmurStore } from "../state/murmur-store";
import { ConfigurationView } from "../views/ConfigurationView";
import { HistoryView } from "../views/HistoryView";
import { HomeView } from "../views/HomeView";
import { ModelsLibraryView } from "../views/ModelsLibraryView";
import { ModesView } from "../views/ModesView";
import { ProvidersView } from "../views/ProvidersView";
import { VocabularyView } from "../views/VocabularyView";
import { AppShell, routePanelClassName, useAppShellRouteActions } from "./AppShell";

const rootRoute = createRootRoute({
  component: MainRouteShell
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: ({ location }) => redirectToMainRoute(location.pathname)
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: mainRoutePaths.home,
  component: HomeRoute
});

const modesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: mainRoutePaths.modes,
  component: ModesRoute
});

const vocabularyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: mainRoutePaths.vocabulary,
  component: VocabularyRoute
});

const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: mainRoutePaths.history,
  component: HistoryRoute
});

const modelsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: mainRoutePaths.models,
  component: ModelsRoute
});

const providersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: mainRoutePaths.providers,
  component: ProvidersRoute
});

const configurationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: mainRoutePaths.configuration,
  component: ConfigurationRoute
});

const unknownRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$",
  beforeLoad: ({ location }) => redirectToMainRoute(location.pathname)
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  homeRoute,
  modesRoute,
  vocabularyRoute,
  historyRoute,
  modelsRoute,
  providersRoute,
  configurationRoute,
  unknownRoute
]);

export function createMainRouter(history: RouterHistory = createHashHistory()) {
  return createRouter({
    routeTree,
    history
  });
}

export type MainRouter = ReturnType<typeof createMainRouter>;

let browserMainRouter: MainRouter | null = null;

export function getMainRouter(): MainRouter {
  browserMainRouter ??= createMainRouter();
  return browserMainRouter;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: MainRouter;
  }
}

export function resolveMainRoutePathname(pathname: string): MainRoutePath {
  const section = sectionIdFromPathname(pathname);
  return section ? mainRoutePaths[section] : mainRoutePaths.home;
}

function redirectToMainRoute(pathname: string): never {
  throw redirect({ to: resolveMainRoutePathname(pathname), replace: true });
}

function MainRouteShell(): JSX.Element {
  return <AppShell state={useRequiredSnapshot()} />;
}

function HomeRoute(): JSX.Element {
  const state = useRequiredSnapshot();
  const navigate = homeRoute.useNavigate();
  const { openOnboarding } = useAppShellRouteActions();

  return (
    <RoutePanel id="home">
      <HomeView
        state={state}
        onOpenModels={() => void navigate({ to: mainRoutePaths.models })}
        onOpenHistory={() => void navigate({ to: mainRoutePaths.history })}
        onOpenOnboarding={openOnboarding}
      />
    </RoutePanel>
  );
}

function ModesRoute(): JSX.Element {
  const { setModesHaveUnsavedChanges } = useAppShellRouteActions();
  return (
    <RoutePanel id="modes">
      <ModesView state={useRequiredSnapshot()} onUnsavedChangesChange={setModesHaveUnsavedChanges} />
    </RoutePanel>
  );
}

function VocabularyRoute(): JSX.Element {
  return (
    <RoutePanel id="vocabulary">
      <VocabularyView state={useRequiredSnapshot()} />
    </RoutePanel>
  );
}

function HistoryRoute(): JSX.Element {
  return (
    <RoutePanel id="history">
      <HistoryView state={useRequiredSnapshot()} />
    </RoutePanel>
  );
}

function ModelsRoute(): JSX.Element {
  const navigate = modelsRoute.useNavigate();
  return (
    <RoutePanel id="models">
      <ModelsLibraryView
        state={useRequiredSnapshot()}
        onOpenProviders={() => void navigate({ to: mainRoutePaths.providers })}
      />
    </RoutePanel>
  );
}

function ProvidersRoute(): JSX.Element {
  const { setProvidersHaveUnsavedChanges } = useAppShellRouteActions();
  return (
    <RoutePanel id="providers">
      <ProvidersView state={useRequiredSnapshot()} onUnsavedChangesChange={setProvidersHaveUnsavedChanges} />
    </RoutePanel>
  );
}

function ConfigurationRoute(): JSX.Element {
  const { setConfigurationHasUnsavedChanges } = useAppShellRouteActions();
  return (
    <RoutePanel id="configuration">
      <ConfigurationView
        state={useRequiredSnapshot()}
        onUnsavedChangesChange={setConfigurationHasUnsavedChanges}
      />
    </RoutePanel>
  );
}

function RoutePanel({ id, children }: { id: string; children: ReactNode }): JSX.Element {
  return (
    <div id={id} className={routePanelClassName}>
      {children}
    </div>
  );
}

function useRequiredSnapshot(): AppStateSnapshot {
  const snapshot = useMurmurStore((state) => state.snapshot);
  if (!snapshot) throw new Error("The main router requires an initialized application snapshot.");
  return snapshot;
}
