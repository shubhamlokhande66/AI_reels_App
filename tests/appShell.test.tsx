import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/projects", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const admin = vi.hoisted(() => ({ value: false }));
const features = vi.hoisted(() => ({ value: { fastStudio: true, aiReel: true, productReel: true, story: true, editor: true, library: true, songs: true, templates: true, brands: true } as Record<string, boolean> }));
vi.mock("@/hooks/useApi", () => ({
  useAdmin: () => ({ admin: admin.value, required: true, loading: false }),
  useMe: () => ({ data: { authEnabled: true, user: { id: "u", email: "me@example.com" } } }),
  useCredits: () => ({ data: { enabled: false } }),
  useFeatures: () => features.value,
}));

import { AppShell } from "@/components/templates/AppShell";

function renderShell() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AppShell><p>content</p></AppShell>
    </QueryClientProvider>,
  );
  return within(screen.getByRole("navigation", { name: "Main" }));
}

beforeEach(() => { admin.value = false; });

describe("AppShell navigation", () => {
  it("shows people the product: create, story, editor, projects and their library", () => {
    const nav = renderShell();
    for (const [name, href] of [["Create Reel", "/projects/new"], ["Story → Reel", "/story/new"], ["Editor", "/editor"], ["Projects", "/projects"], ["Footage", "/library"], ["Songs", "/songs"]]) {
      expect(nav.getByRole("link", { name: new RegExp(name) })).toHaveAttribute("href", href);
    }
    expect(screen.getAllByText("me@example.com").length).toBeGreaterThan(0); // the sidebar and the phone menu
  });

  it("keeps the admin tools (AI Edit, Beat Sync check, Chat) out of the menu outside admin mode", () => {
    const nav = renderShell();
    for (const name of ["AI Edit", "Beat Sync check", "Chat", "AI settings"]) expect(nav.queryByRole("link", { name: new RegExp(name) })).not.toBeInTheDocument();
  });

  it("lists the admin tools in admin mode, after the product items", () => {
    admin.value = true;
    const nav = renderShell();
    expect(nav.getByRole("link", { name: /AI Edit/ })).toHaveAttribute("href", "/ai-edit/new");
    expect(nav.getByRole("link", { name: /Beat Sync check/ })).toHaveAttribute("href", "/beats/new");
    expect(nav.getByRole("link", { name: /Chat/ })).toHaveAttribute("href", "/chat");
    const links = nav.getAllByRole("link").map((a) => a.textContent ?? "");
    expect(links.findIndex((t) => t.includes("AI Edit"))).toBeGreaterThan(links.findIndex((t) => t.includes("Create Reel")));
  });
});

describe("AppShell: parts the administrator turned off", () => {
  it("leaves them out of the menu", () => {
    features.value = { ...features.value, editor: false, songs: false };
    renderShell();
    const nav = screen.getAllByRole("navigation", { name: "Main" })[0];
    expect(within(nav).queryByRole("link", { name: /Editor/ })).toBeNull();
    expect(within(nav).queryByRole("link", { name: /Songs/ })).toBeNull();
    expect(within(nav).getByRole("link", { name: /Footage/ })).toBeInTheDocument();
    features.value = { ...features.value, editor: true, songs: true };
  });
});
