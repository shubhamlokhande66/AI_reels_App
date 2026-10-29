import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** "Get the Shubix app": shown until the app is installed, never inside it; on an iPhone the account says whether its
 * app was opened lately (iosApp); "Not now" hides it for this visit. */
const s = vi.hoisted(() => ({ offer: false, standalone: false, ios: false, iosApp: false }));
vi.mock("@/hooks/useApi", async () => {
  const { defaultText } = await import("./helpers/texts");
  return { useText: () => defaultText, useMe: () => ({ data: { authEnabled: true, user: { id: "u", email: "me@example.com", iosApp: s.iosApp } } }) };
});
vi.mock("@/lib/pwa", () => ({
  subscribeInstall: () => () => {},
  canInstall: () => s.offer,
  isStandalone: () => s.standalone,
  isIos: () => s.ios,
  install: vi.fn(async () => true),
}));

import { InstallBanner } from "@/components/molecules/InstallBanner";

const shown = () => screen.queryByRole("region", { name: "Install the Shubix app" });

beforeEach(() => {
  Object.assign(s, { offer: false, standalone: false, ios: false, iosApp: false });
  sessionStorage.clear();
});

describe("InstallBanner", () => {
  it("follows the browser's install offer (Android, Chrome, Edge): Install installs, no steps", async () => {
    s.offer = true;
    const { install } = await import("@/lib/pwa");
    const { unmount } = render(<InstallBanner />);
    expect(shown()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(install).toHaveBeenCalled();
    expect(screen.queryByText(/Add to Home Screen/)).toBeNull();
    unmount();
    s.offer = false; // installed: the browser stops offering it
    render(<InstallBanner />);
    expect(shown()).toBeNull();
  });

  it("is never shown inside the installed app", () => {
    Object.assign(s, { offer: true, ios: true, standalone: true });
    render(<InstallBanner />);
    expect(shown()).toBeNull();
  });

  it("on an iPhone: shown with the steps until the account's app was opened lately", () => {
    s.ios = true;
    const { unmount } = render(<InstallBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Install" }));   // it cannot install there: the two taps, below
    expect(screen.getByText(/Add to Home Screen/)).toBeTruthy();
    unmount();
    s.iosApp = true;
    render(<InstallBanner />);
    expect(shown()).toBeNull();
  });

  it("Not now hides it for this visit", () => {
    s.offer = true;
    const { unmount } = render(<InstallBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(shown()).toBeNull();
    unmount();
    render(<InstallBanner />);
    expect(shown()).toBeNull();
  });
});
