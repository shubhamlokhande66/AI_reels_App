import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
const api = vi.hoisted(() => ({ deleteProject: vi.fn() }));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api }));

import { ProjectCard } from "@/components/ProjectCard";
import type { ProjectSummary } from "@/types/api";

const project = (over: Partial<ProjectSummary> = {}) =>
  ({ id: "p1", name: "Gold launch", status: "completed", style: "luxury", duration: 15, videoCount: 3, updatedAt: new Date().toISOString(),
     thumbnailUrl: null, ...over }) as unknown as ProjectSummary;

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("Project card: delete without opening the project", () => {
  beforeEach(() => api.deleteProject.mockReset().mockResolvedValue(undefined));

  it("asks first and deletes only after 'Yes, delete'", async () => {
    wrap(<ProjectCard project={project()} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete Gold launch" }));
    expect(api.deleteProject).not.toHaveBeenCalled();
    expect(screen.getByText("Delete this project and all its files?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(api.deleteProject).toHaveBeenCalledWith("p1"));
  });

  it("'No' cancels, and the delete button is not inside the project link", async () => {
    wrap(<ProjectCard project={project()} />);
    const btn = screen.getByRole("button", { name: "Delete Gold launch" });
    expect(btn.closest("a")).toBeNull();
    await userEvent.click(btn);
    await userEvent.click(screen.getByRole("button", { name: "No" }));
    expect(screen.getByRole("button", { name: "Delete Gold launch" })).toBeInTheDocument();
    expect(api.deleteProject).not.toHaveBeenCalled();
  });

  it("is not offered while the project is processing", () => {
    wrap(<ProjectCard project={project({ status: "processing" })} />);
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
  });
});
