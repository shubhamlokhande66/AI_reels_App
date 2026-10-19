import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

const api = vi.hoisted(() => ({
  voices: vi.fn(),
  systemVoices: vi.fn(),
  createVoice: vi.fn(),
  updateVoice: vi.fn(),
  deleteVoice: vi.fn(),
  previewVoice: vi.fn(),
  brands: vi.fn(),
  createBrand: vi.fn(),
  updateBrand: vi.fn(),
  deleteBrand: vi.fn(),
  uploadLogo: vi.fn(),
  features: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api }));

import BrandsPage from "@/app/brands/page";
import TemplatesPage from "@/app/templates/page";
import VoicesPage from "@/app/voices/page";

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const voiceProfile = { id: "v1", name: "Warm", voice: null, language: "en", speed: 1, pitch: 0, energy: "medium", emotion: "friendly", pauseStyle: "natural", pronunciations: { Namora: "Nuh-more-uh" } };

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  api.voices.mockResolvedValue([voiceProfile]);
  api.systemVoices.mockResolvedValue({
    provider: "sapi", available: true, voices: [{ id: "x", name: "Zira", language: "en-US", gender: "female" }],
    languages: { en: true, hi: false, mr: false }, note: "Hindi and Marathi need a Windows voice pack.",
  });
  api.brands.mockResolvedValue([]);
});

describe("Voices page", () => {
  it("shows honest language coverage and lists profiles", async () => {
    wrap(<VoicesPage />);
    expect(await screen.findByText("Warm")).toBeInTheDocument();
    expect(await screen.findByText(/Hindi: no voice installed/)).toBeInTheDocument();
    expect(screen.getByText(/English: voice available/)).toBeInTheDocument();
    expect(screen.getByText(/Hindi and Marathi need a Windows voice pack/)).toBeInTheDocument();
  });

  it("saves a profile with parsed pronunciations", async () => {
    api.createVoice.mockResolvedValue(voiceProfile);
    wrap(<VoicesPage />);
    await userEvent.click(await screen.findByRole("button", { name: /New voice profile/ }));
    await userEvent.type(screen.getByPlaceholderText(/My Marathi Voice/), "Crisp");
    await userEvent.type(screen.getByLabelText("Pronunciation"), "GIF = jif");
    await userEvent.click(screen.getByRole("button", { name: "Save voice profile" }));
    await waitFor(() => expect(api.createVoice).toHaveBeenCalled());
    expect(api.createVoice.mock.calls[0][0]).toMatchObject({ name: "Crisp", pronunciations: { GIF: "jif" }, language: "en" });
  });
});

describe("Brands page", () => {
  it("creates a brand with colours, defaults and no logo", async () => {
    api.createBrand.mockResolvedValue({ id: "b1" });
    wrap(<BrandsPage />);
    await userEvent.click(await screen.findByRole("button", { name: /New brand|Create brand/ }));
    await userEvent.type(screen.getByPlaceholderText("e.g. My Brand"), "NAMORA");
    await userEvent.type(screen.getByPlaceholderText("Shop the collection"), "Shop now");
    await userEvent.click(screen.getByRole("button", { name: "Save brand" }));
    await waitFor(() => expect(api.createBrand).toHaveBeenCalled());
    expect(api.createBrand.mock.calls[0][0]).toMatchObject({ name: "NAMORA", cta: "Shop now", watermark: { enabled: true, position: "br" } });
    expect(api.uploadLogo).not.toHaveBeenCalled();
  });
});

describe("Templates page", () => {
  it("shows the ready-made templates, each opening the Create page with it", async () => {
    wrap(<TemplatesPage />);
    expect(await screen.findByRole("link", { name: /Make a Reel with Beat montage|Beat montage/ })).toHaveAttribute("href", "/create/edit?tpl=montage");
    expect(screen.getByText("Festivals")).toBeInTheDocument();
  });

  it("finds templates by what they are", async () => {
    wrap(<TemplatesPage />);
    await userEvent.type(await screen.findByLabelText("Search templates"), "recipe");
    expect(screen.getByRole("link", { name: /Recipe/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Beat montage/ })).toBeNull();
  });
});
