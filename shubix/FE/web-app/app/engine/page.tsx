import type { Metadata } from "next";
import { FastStudio } from "@/components/studio/FastStudio";

export const metadata: Metadata = { title: "Engine", robots: { index: false, follow: false } };

/** The phone app's engine (FE/mobile-app lib/engine.tsx keeps this page hidden): Fast Studio's Create flow, worked by the
 * phone through components/studio/bridge.ts, so the phone's Reel is made by the website's own engine. Not for people:
 * outside the phone app it is the plain studio. */
export default function EnginePage() {
  return <FastStudio kind="music" engine />;
}
