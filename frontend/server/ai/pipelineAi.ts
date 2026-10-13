import "server-only";
import { AIUnavailable } from "@/server/core/errors";
import type { AudioAnalysis } from "@/server/models/analysis";
import type { ClipInput, ClipSemantic } from "@/server/models/clip";
import type { Timeline } from "@/server/models/timeline";
import type { EditingStyle } from "@/server/styles";
import type { AiFix } from "@/server/director/creativeReview";
import type { CreativePlan } from "@/server/director/creative";
import type { Word } from "@/server/video/render/text";

/** Every AI step the Reel pipeline can take, behind one boundary. Each one may throw an AppError; the pipeline then
 * falls back to the rule engine and says so in the Reel's warnings. The providers (OpenAI, Gemini, Claude, Ollama),
 * the director, the reviewer and Whisper captions are wired in here. */

const NOT_YET = "The AI provider is not connected in this version yet";
const unavailable = (what: string) => new AIUnavailable(`${NOT_YET} (${what}).`, { code: "AI_UNAVAILABLE" });

export interface DirectedReel {
  timeline: Timeline; postCopy: Record<string, unknown> | null; creative: CreativePlan | null; pace: string | null;
  aiLog: unknown; log: { shot: number; changes: string[] }[]; fixes: string[]; problems: string[];
}

export interface PipelineAi {
  /** What each clip shows (vision model), once per clip. */
  understandClip(file: string, clip: ClipInput, language: string): Promise<ClipSemantic>;
  /** The whole edit planned by the AI director; null = it found no usable plan. */
  directReel(o: { clips: ClipInput[]; audio: AudioAnalysis; style: EditingStyle; duration: number; brief: unknown; hooks: unknown; direction: string | null; seed: number; settings: unknown }): Promise<DirectedReel | null>;
  /** Title, description and hashtags. */
  writeCopy(o: { projectName: string; style: string; bpm: number; duration: number; clipNames: string[] }): Promise<Record<string, unknown>>;
  /** Pick one of the ranked song parts: index into `candidates`, with a reason. */
  chooseSongPart(o: { duration: number; brief: string; concept: string | null; footage: string; newVersion: boolean; candidates: unknown[] }): Promise<{ pick: number; reason: string }>;
  /** The style for "auto". */
  suggestStyle(o: { clips: ClipInput[]; audio: AudioAnalysis; projectName: string }): Promise<{ styleId: string; reason: string }>;
  /** The order of the clips: clip id -> 0..1 (0 = early). */
  suggestOrder(o: { clips: ClipInput[]; audio: AudioAnalysis; duration: number; brief: string; language: string }): Promise<{ hint: Record<string, number>; reason: string; structure?: string[] }>;
  /** The AI reviewer's named fixes for a rendered Reel. */
  review(o: { card: Record<string, unknown>; timeline: Timeline; plan: unknown }): Promise<{ fixes: AiFix[]; summary: string }>;
  /** Word timings of speech or lyrics (Whisper). */
  transcribe(file: string, start: number, duration: number, progress: (f: number) => void): Promise<Word[]>;
  /** Which provider made the decisions (for "AI: Gemini" on the project page). */
  info(tasks: string[], director: boolean): { provider: string; model: string; local: boolean; tasks: string[]; director: boolean; fallbackUsed: boolean } | null;
}

const fallback: PipelineAi = {
  understandClip: async () => { throw unavailable("clip understanding"); },
  directReel: async () => { throw unavailable("AI director"); },
  writeCopy: async () => { throw unavailable("title and description"); },
  chooseSongPart: async () => { throw unavailable("song part"); },
  suggestStyle: async () => { throw unavailable("style"); },
  suggestOrder: async () => { throw unavailable("clip order"); },
  review: async () => { throw unavailable("reviewer"); },
  transcribe: async () => { throw unavailable("speech recognition for captions"); },
  info: () => null,
};

const g = globalThis as unknown as { __pipelineAi?: PipelineAi };
export const pipelineAi = (): PipelineAi => g.__pipelineAi ?? fallback;
/** Installed by the AI layer once it is loaded. */
export const setPipelineAi = (ai: PipelineAi) => { g.__pipelineAi = ai; };
