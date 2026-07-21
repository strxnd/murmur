import { createMemoryHistory } from "@tanstack/react-router";
import { afterEach, describe, expect, it } from "vitest";
import { createMainRouter, resolveMainRoutePathname, type MainRouter } from "./main-router";

let router: MainRouter | null = null;

afterEach(() => {
  router?.history.destroy();
  router = null;
});

describe("main router", () => {
  it("matches the root redirect route and resolves it to home", () => {
    router = createMainRouter(createMemoryHistory({ initialEntries: ["/"] }));

    expect(router.matchRoutes("/").at(-1)?.routeId).toBe("/");
    expect(resolveMainRoutePathname("/")).toBe("/home");
  });

  it("preserves each defined main-window route in memory history", async () => {
    router = createMainRouter(createMemoryHistory({ initialEntries: ["/home"] }));

    for (const pathname of [
      "/home",
      "/modes",
      "/vocabulary",
      "/history",
      "/models",
      "/providers",
      "/configuration"
    ] as const) {
      await router.navigate({ to: pathname });
      expect(router.state.location.pathname).toBe(pathname);
      expect(resolveMainRoutePathname(pathname)).toBe(pathname);
    }
  });

  it("matches unknown paths with the catch-all redirect route", () => {
    router = createMainRouter(createMemoryHistory({ initialEntries: ["/missing-route"] }));

    expect(router.matchRoutes("/missing-route").at(-1)?.routeId).toBe("/$");
    expect(resolveMainRoutePathname("/missing-route")).toBe("/home");
  });
});
