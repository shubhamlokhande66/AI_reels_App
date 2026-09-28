import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/projects" }));

import { AppShell } from "@/components/AppShell";

describe("AppShell navigation", () => {
  it("lists Beat Sync as its own item, alongside Projects and Create Reel", () => {
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );
    const nav = screen.getByRole("navigation", { name: "Main" });
    const links = Array.from(nav.querySelectorAll("a")).map((a) => a.textContent ?? "");
    const beatIndex = links.findIndex((t) => t.includes("Beat Sync"));
    expect(beatIndex).toBeGreaterThan(-1);
    expect(beatIndex).toBeGreaterThan(links.findIndex((t) => t.includes("Create Reel")));
    expect(screen.getByRole("link", { name: /Beat Sync/ })).toHaveAttribute("href", "/beats/new");
  });

  it("lists AI Edit as its own item, after Beat Sync", () => {
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );
    const nav = screen.getByRole("navigation", { name: "Main" });
    const links = Array.from(nav.querySelectorAll("a")).map((a) => a.textContent ?? "");
    const aiIndex = links.findIndex((t) => t.includes("AI Edit"));
    expect(aiIndex).toBeGreaterThan(-1);
    expect(aiIndex).toBeGreaterThan(links.findIndex((t) => t.includes("Beat Sync")));
    expect(screen.getByRole("link", { name: /AI Edit/ })).toHaveAttribute("href", "/ai-edit/new");
  });

  it("lists Chat as its own item, after AI Edit", () => {
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );
    const nav = screen.getByRole("navigation", { name: "Main" });
    const links = Array.from(nav.querySelectorAll("a")).map((a) => a.textContent ?? "");
    const chatIndex = links.findIndex((t) => t.includes("Chat"));
    expect(chatIndex).toBeGreaterThan(-1);
    expect(chatIndex).toBeGreaterThan(links.findIndex((t) => t.includes("AI Edit")));
    expect(screen.getByRole("link", { name: /Chat/ })).toHaveAttribute("href", "/chat");
  });
});
