/** Pure guards for the Music Reel picker. Keep source files untouched; warn before copying very large selections. */
export const MUSIC_REEL_MAX_CLIPS = 30;
const LARGE_SINGLE_FILE_BYTES = 512 * 1024 * 1024;
const LARGE_SELECTION_BYTES = 1024 * 1024 * 1024;

export type MusicReelPickedAsset = { type?: string | null; fileSize?: number | null };
export type MusicReelSelectionInspection = { error: string | null; videoCount: number; totalBytes: number; totalSizeLabel: string; requiresLargeFileConfirmation: boolean };

export function inspectMusicReelSelection(
  assets: readonly MusicReelPickedAsset[],
  existingCount = 0,
  existingAssets: readonly MusicReelPickedAsset[] = [],
): MusicReelSelectionInspection {
  const allAssets = [...existingAssets, ...assets];
  const totalBytes = allAssets.reduce((sum, asset) => {
    const size = asset.fileSize;
    return sum + (typeof size === "number" && Number.isFinite(size) && size > 0 ? size : 0);
  }, 0);
  const videoCount = allAssets.filter((asset) => asset.type === "video" || asset.type == null).length;
  const error = existingCount < 0 || existingCount > MUSIC_REEL_MAX_CLIPS
    ? "The current clip selection is invalid. Remove clips and try again."
    : existingCount + assets.length > MUSIC_REEL_MAX_CLIPS
      ? "A Music Reel can contain up to " + MUSIC_REEL_MAX_CLIPS + " clips. Remove some clips before adding more."
      : assets.some((asset) => asset.type && asset.type !== "video" && asset.type !== "image")
        ? "This media type is not supported. Choose a video or photo."
        : null;
  const mib = totalBytes / (1024 * 1024);
  const totalSizeLabel = totalBytes > 0 ? (mib >= 1024 ? (mib / 1024).toFixed(1) + " GB" : Math.round(mib) + " MB") : "size unavailable";
  return { error, videoCount, totalBytes, totalSizeLabel, requiresLargeFileConfirmation: !error && (totalBytes >= LARGE_SELECTION_BYTES || allAssets.some((asset) => (asset.fileSize ?? 0) >= LARGE_SINGLE_FILE_BYTES)) };
}
