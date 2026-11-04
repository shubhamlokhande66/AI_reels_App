import { requireNativeView, requireOptionalNativeModule, type EventSubscription } from "expo";

/** The phone's video engine (android/…/ShubixVideoModule.kt). null where it is not in the app: Expo Go and the web. */
type Engine = {
  exportReel(spec: string): Promise<{ uri: string; size: number; duration: number }>;
  cancel(): Promise<void>;
  /** the tiny web server on the phone (127.0.0.1): it serves the engine page from the APK, reads the app's files for it,
   * takes the Reel back and passes its calls on to `api` */
  fileServer(api: string): { port: number; key: string };
  addListener(event: "onProgress", fn: (e: { progress: number }) => void): EventSubscription;
};
export const ShubixVideo = requireOptionalNativeModule<Engine>("ShubixVideo");

/** The Reel playing live (android/…/ShubixPreviewView.kt): the same picture the export makes. Its ref loads a Reel (the
 * export's spec, without `output`) at a time, then plays, pauses and seeks; it tells the time ten times a second. */
export type PreviewRef = {
  load(spec: string, at: number): Promise<number>;
  play(): Promise<void>; pause(): Promise<void>; seek(at: number): Promise<void>; setMuted(muted: boolean): Promise<void>; release(): Promise<void>;
};
export type PreviewProps = {
  style?: import("react-native").StyleProp<import("react-native").ViewStyle>;
  onTime?: (e: { nativeEvent: { time: number; playing: boolean } }) => void;
  onEnded?: () => void;
  onError?: (e: { nativeEvent: { message: string } }) => void;
  ref?: import("react").Ref<PreviewRef>;
};
export const ShubixPreviewView: import("react").ComponentType<PreviewProps> | null = ShubixVideo ? requireNativeView<PreviewProps>("ShubixVideo") : null;
