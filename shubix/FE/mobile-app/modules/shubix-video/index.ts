import { requireOptionalNativeModule, type EventSubscription } from "expo";

/** The phone's video engine (android/…/ShubixVideoModule.kt). null where it is not in the app: Expo Go and the web. */
type Engine = {
  exportReel(spec: string): Promise<{ uri: string; size: number; duration: number }>;
  cancel(): Promise<void>;
  /** the tiny web server on the phone (127.0.0.1) through which the engine page reads the app's files and sends the Reel back */
  fileServer(): { port: number; key: string };
  addListener(event: "onProgress", fn: (e: { progress: number }) => void): EventSubscription;
};
export const ShubixVideo = requireOptionalNativeModule<Engine>("ShubixVideo");
