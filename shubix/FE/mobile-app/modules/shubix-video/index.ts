import { requireOptionalNativeModule, type EventSubscription } from "expo";

/** The phone's video engine (android/…/ShubixVideoModule.kt). null where it is not in the app: Expo Go and the web. */
type Engine = {
  exportReel(spec: string): Promise<{ uri: string; size: number; duration: number }>;
  cancel(): Promise<void>;
  addListener(event: "onProgress", fn: (e: { progress: number }) => void): EventSubscription;
};
export const ShubixVideo = requireOptionalNativeModule<Engine>("ShubixVideo");
