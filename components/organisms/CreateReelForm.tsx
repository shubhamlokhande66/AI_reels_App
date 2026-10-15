"use client";

import { audioBlobUrl } from "@/lib/audioUrl";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkFootage, readVideoSeconds, type FootageCheck } from "@/lib/footage";
import { FootageGate } from "@/components/molecules/FootageGate";
import { ClipCheckPanel, FLAG_TEXT, clipCheck, resolutionNote } from "@/components/organisms/ClipCheckPanel";
import { TaskLog, type LogLine, type TaskLogState } from "@/components/molecules/TaskLog";
import { Stepper } from "@/components/molecules/Stepper";
import { SongPartPicker } from "@/components/molecules/SongPartPicker";
import { BeatMap, PlanTable } from "@/components/organisms/BeatMap";
import { SongAnalysis } from "@/components/organisms/SongAnalysis";
import { ReferencePicker, ReferenceReel, ReferenceStatus } from "@/components/organisms/ReferenceReel";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { useAdmin, useTrends } from "@/hooks/useApi";
import { api, errorMessage } from "@/lib/api";
import { FEATURES } from "@/lib/features";
import { MAX_AUDIO_MB, MAX_VIDEO_MB, PICKER_AUDIO, PICKER_VIDEO, formatBytes, formatDuration, isAudioFile, isVideoFile, tooBig } from "@/lib/format";
import { Dropzone } from "@/components/molecules/Dropzone";
import { SongPicker } from "@/components/organisms/Songs";
import { ProgressBar } from "@/components/molecules/ProgressStages";
import { DurationSelector, OrderModeSelector, PaceSelector, SequenceSelector, StepOptions, StyleSelector, type PaceChoice } from "@/components/organisms/StyleSelector";
import { btnPrimary, btnSecondary, Card, Spinner } from "@/components/atoms";
import { ErrorBanner } from "@/components/molecules";
import { LocalVideo, VideoList } from "@/components/molecules/VideoList";
import { LANGUAGES, type Concept, type Language, type MinClip, type Project, type ReelPlatform, type Sequence, type Template } from "@/types/api";

const AUDIO_MODES = [
  ["music", "Music only"],
  ["voice_music", "Voice-over + music"],
  ["voice", "Voice-over only"],
  ["original", "Original clip audio"],
  ["none", "No audio"],
] as const;
type AudioModeId = (typeof AUDIO_MODES)[number][0];
const SELECT = "w-full rounded-xl border border-border bg-surface px-3 py-2 outline-none focus:border-accent sm:w-auto";

type Step = "idle" | "creating" | "videos" | "checking" | "audio" | "starting";
const STEP_LABEL: Record<Step, string> = {
  idle: "",
  creating: "Creating project…",
  videos: "Uploading videos…",
  checking: "Checking your clips (quality, sharpness, light, shake, length)…",
  audio: "Uploading music…",
  starting: "Starting the render…",
};
// The create flow: 1 clips (checked before anything else), 2 the song (its part chosen), 3 style and generate.
type Stage = "song" | "length" | "clips" | "rest"; // music first: the song decides the edit

const CAPTION_STYLES = ["minimal", "bold", "karaoke", "highlight", "luxury"];

const PLATFORMS: { id: ReelPlatform; label: string; hint: string }[] = [
  { id: "instagram", label: "Instagram Reels", hint: "Edited and checked for how Instagram ranks Reels" },
  { id: "none", label: "General", hint: "The editor's own defaults, no platform rules" },
];
// What Instagram mode changes, in plain words (each line maps to a rule in server/platforms/instagram.ts)
const INSTAGRAM_RULES = [
  "Opens on your most eye-catching moment and cuts by 1.8 s, before people decide to scroll on.",
  "Your hook text is on screen from the first frame, and the music starts right away (most people watch muted at first).",
  "A new shot every 1-3.5 s to keep people watching, and an ending that loops back into the start for rewatches.",
  "No fade to black. A brand logo shows only in the last 2 s (Reels with a logo on screen are recommended less).",
  "Caption with searchable words, at most 5 specific hashtags, a line asking people to send it, and alt text.",
  "A ranking check after the render: what passes, what to fix, and how to post it.",
];

// The creative direction, the one choice that shapes the whole Reel (director/creative.py DIRECTIONS).
const DIRECTIONS: { id: Concept; label: string; blurb: string }[] = [
  { id: "auto", label: "✦ Let the AI decide", blurb: "The director reads your clips, song and words and picks the concept." },
  { id: "viral", label: "Viral", blurb: "The strongest hook first, fast cuts on the hits, the big moment on the drop." },
  { id: "cinematic", label: "Cinematic", blurb: "A story in order: shots breathe, slow pushes, a held ending." },
  { id: "premium", label: "Premium", blurb: "Product and brand first: close-ups, the reveal on the drop, a hero ending." },
];

// Tap-to-add examples for the AI instruction box (plain words, not settings)
const INSTRUCTION_IDEAS = [
  "Luxury feel, slow and elegant.",
  "Lots of close-ups of the details.",
  "Energetic, cut on every beat.",
  "Start with the best shot.",
  "End on the full look.",
  "Add text: New Collection.",
];

let keySeq = 0;

/** Where the cuts land (sent as cutEveryBeat). */
const CUT_ON = [
  { id: "key", every: false, label: "Key beats (recommended)", hint: "Bar starts, the drop and each new part of the song: about one cut per bar, clean and on the music." },
  { id: "every", every: true, label: "Every beat", hint: "A new shot on every beat: very fast and energetic. Beats closer than the shortest shot are grouped." },
] as const;

export function CreateReelForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [videos, setVideos] = useState<LocalVideo[]>([]);
  const videosRef2 = useRef<LocalVideo[]>([]); // the clips still waiting to upload, for a retry
  videosRef2.current = videos;
  const [clipSeconds, setClipSeconds] = useState<Record<string, number | null>>({}); // read in the browser, nothing uploaded
  const [gate, setGate] = useState<FootageCheck | null>(null); // not enough footage: add clips or shorten, before anything is created
  const [stage, setStage] = useState<Stage>("song");
  const [project, setProject] = useState<Project | null>(null); // the project once its clips were uploaded and checked
  const [songReady, setSongReady] = useState(false); // the song is uploaded, so its best parts can be shown
  const [log, setLog] = useState<TaskLogState | null>(null); // the live popup while clips / the song are checked
  const lineSeq = useRef(0);
  const closeLog = useCallback(() => setLog(null), []);
  const retry = useRef<(() => void) | null>(null); // what the popup's Retry runs: the step that stopped, from where it stopped
  const formRef = useRef<HTMLFormElement>(null);
  const videosRef = useRef<HTMLElement>(null);
  const [audio, setAudio] = useState<File | null>(null);
  const [duration, setDuration] = useState(15);
  const [audioStart, setAudioStart] = useState<number | null>(null); // null = the app picks the best part of the song
  const [style, setStyle] = useState("auto"); // the AI picks the style from the instructions, clips and song
  const [concept, setConcept] = useState<Concept>("auto"); // the creative direction
  const { admin } = useAdmin(); // the AI switches and the trend tools are the administrator's
  const [pace, setPace] = useState<PaceChoice>("auto"); // the AI picks the pace too
  const [sequence, setSequence] = useState<Sequence>("mixed");
  const [teaser, setTeaser] = useState(true);
  const [stepLabels, setStepLabels] = useState(true);
  const [orderMode, setOrderMode] = useState<"auto" | "manual">("auto");
  const [captions, setCaptions] = useState(false);
  const [captionStyle, setCaptionStyle] = useState("minimal");
  const [aiDirector, setAiDirector] = useState(true); // the AI plans every shot; the safety layer checks it
  const [autoReview, setAutoReview] = useState(true); // the Quality Reviewer scores the edit and improves it before rendering
  const [soundEffects, setSoundEffects] = useState(false); // whooshes, risers, impacts placed by the director
  const [deleteMedia, setDeleteMedia] = useState(false); // privacy: delete the uploads once the final Reel exists
  const [ai, setAi] = useState(true); // quality over speed by default: the app looks at every clip before picking shots (a few minutes on a local computer)
  const [trendId, setTrendId] = useState("");
  const [audioMode, setAudioMode] = useState<AudioModeId>("music");
  const [language, setLanguage] = useState<Language>("en");
  const [platform, setPlatform] = useState<ReelPlatform>("instagram"); // where it will be posted: Instagram tunes the edit and checks it
  const [hookText, setHookText] = useState("");
  const [ctaText, setCtaText] = useState("");
  const [brief, setBrief] = useState("");
  const [brandId, setBrandId] = useState("");
  const [reference, setReference] = useState("auto"); // edit like a learned trend: the AI picks one unless the user does
  const [templateId, setTemplateId] = useState("");
  const [refFile, setRefFile] = useState<File | null>(null);
  const [refUseMusic, setRefUseMusic] = useState(true);
  const [beatPlan, setBeatPlan] = useState(true); // cut exactly by the beat map's plan
  const [everyBeat, setEveryBeat] = useState(false); // where cuts land: key beats (false) or every beat (true)
  const [minClip, setMinClip] = useState<MinClip>(0.35); // with the plan: the shortest shot; faster beats are grouped
  const [refMusic, setRefMusic] = useState<string | null>(null); // the reference Reel's music is the song (its name)
  const [refError, setRefError] = useState<string | null>(null); // "make it like this Reel": studied when the clips are checked
  const templates = useQuery({ queryKey: ["templates"], queryFn: api.templates });
  const brands = useQuery({ queryKey: ["brands"], queryFn: api.brands });
  const learned = useQuery({ queryKey: ["references"], queryFn: api.references });
  // the song's beat map (step 1), fetched while the song is prepared; the audio plays from the file in the browser
  const [songProjectId, setSongProjectId] = useState<string | null>(null); // the project, created when the song is added (step 1)
  const pid = project?.id ?? songProjectId;
  const beatMapQ = useQuery({ queryKey: ["beatMap", pid], queryFn: () => api.beatMap(pid!), enabled: songReady && !!pid, staleTime: Infinity });
  const beatMap = audio ? beatMapQ.data : undefined;
  // the song analysis document (Essentia beats and onsets, transients, frame features, events), made when the song is added
  const analysisQ = useQuery({ queryKey: ["songAnalysis", pid], queryFn: () => api.songAnalysis(pid!), enabled: songReady && !!pid, staleTime: Infinity });
  // the part the app picks when the user leaves it to the app (the best suggestion): the plan below shows that part
  const partsQ = useQuery({ queryKey: ["songParts", pid, duration], queryFn: () => api.songParts(pid!, duration, 6), enabled: songReady && !!pid && !!audio, staleTime: Infinity });
  const planStart = audioStart ?? partsQ.data?.parts[0]?.start ?? null;
  const songAnalysis = audio ? analysisQ.data : undefined;
  const audioUrl = useMemo(() => (audio ? audioBlobUrl(audio) : ""), [audio]);
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);
  const trends = useTrends();
  const [step, setStep] = useState<Step>("idle");
  const [uploadPct, setUploadPct] = useState(0);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Progress is remembered so "try again" resumes instead of duplicating the project/uploads.
  const done = useRef<{ projectId?: string; videos?: boolean; audio?: boolean; template?: boolean; brand?: boolean }>({});


  const busy = step !== "idle";
  const needsMusic = audioMode === "music";
  const usesMusic = audioMode === "music" || audioMode === "voice_music"; // the song plays in these modes, so its part matters
  const canSubmit = (videos.length > 0 || (project?.videos.length ?? 0) > 0) && (audio !== null || refMusic !== null || !needsMusic) && !busy;
  const canCheck = (videos.length > 0 || (project?.videos.length ?? 0) > 0) && !busy;
  const check = project ? clipCheck(project, duration, sequence === "talk") : null;

  // Arriving from "Use template" / a style / a trend card: adjust state during render, once the lists have loaded.
  const params = useSearchParams();
  const wantedTemplate = params.get("template");
  const wantedStyle = params.get("style");
  const wantedTrend = params.get("trend");
  const [linkApplied, setLinkApplied] = useState<string | null>(null);
  const linkKey = `${wantedStyle ?? ""}|${wantedTrend ?? ""}`;
  const trendFromLink = wantedTrend ? trends.data?.find((x) => x.id === wantedTrend) : undefined;
  if ((wantedStyle || trendFromLink) && linkApplied !== linkKey) {
    setLinkApplied(linkKey);
    if (wantedStyle) setStyle(wantedStyle);
    if (trendFromLink) {
      setTrendId(trendFromLink.id);
      if ([15, 30, 60].includes(trendFromLink.recommendedDuration)) setDuration(trendFromLink.recommendedDuration);
      setCaptionStyle(trendFromLink.captionStyle);
    }
  }
  const chosenTemplate = templateId ? templates.data?.find((x) => x.id === templateId) : undefined;
  const chosenTrend = trendId ? trends.data?.find((x) => x.id === trendId) : undefined;
  const [appliedFor, setAppliedFor] = useState<string | null>(null);
  const fromLink = wantedTemplate ? templates.data?.find((x) => x.id === wantedTemplate) : undefined;
  if (fromLink && appliedFor !== wantedTemplate) {
    setAppliedFor(wantedTemplate);
    setTemplateId(fromLink.id);
    applyTemplate(fromLink);
  }

  function applyTemplate(t: Template) {
    setDuration(t.duration);
    setStyle(t.style);
    setPace(t.pace);
    setCaptions(t.captions);
    setCaptionStyle(t.captionStyle);
    setAudioMode(t.audioMode as AudioModeId);
    setLanguage(t.language);
    setAi(t.ai);
  }


  // a new length or new clips must be checked again before the next step
  function backToClips() {
    if (stage !== "clips") setStage("clips");
  }

  // ---- the live log popup
  function startLog(title: string) {
    setLog({ title, lines: [], progress: null, barKey: "start", state: "running" });
  }
  /** A new line; the previous running line is finished (✓). */
  function addLine(text: string, status: LogLine["status"] = "running") {
    const id = `l${++lineSeq.current}`;
    setLog((l) => l && { ...l, lines: [...l.lines.map((x) => (x.status === "running" ? { ...x, status: "done" as const } : x)), { id, text, status, at: Date.now() }] });
  }
  function setBar(progress: number | null, barKey?: string) {
    setLog((l) => l && { ...l, progress, barKey: barKey ?? l.barKey });
  }
  function finishLog(state: TaskLogState["state"], summary: string) {
    setLog((l) => l && {
      ...l, state, summary, progress: null,
      lines: l.lines.map((x) => (x.status === "running" ? { ...x, status: state === "error" ? ("error" as const) : ("done" as const) } : x)),
    });
  }

  async function ensureProject(seconds: number = duration): Promise<string> {
    if (!done.current.projectId) {
      setStep("creating");
      const p = await api.createProject(name.trim() || "Untitled Reel", { duration: seconds, sequence });
      done.current.projectId = p.id;
    }
    return done.current.projectId;
  }

  /** Step 1: upload the clips, analyse them (once: every later step and Reel reuses it) and show the verdict, with a
   * live log in a popup. Starts by itself when clips are added. */
  async function checkClips(seconds: number = duration, files: LocalVideo[] = videos) {
    retry.current = () => void checkClips(seconds, files.filter((v) => videosRef2.current.includes(v)));
    setError(null);
    setGate(null);
    startLog("Checking your clips");
    try {
      addLine(done.current.projectId ? "Opening your project" : "Creating your project");
      const id = await ensureProject(seconds);
      if (refFile) {
        addLine(`Studying your reference Reel: ${refFile.name} (its cut timing, hook, beat sync and look)`);
        try {
          const info = await api.setReferenceReel(id, refFile, refUseMusic);
          qc.setQueryData(["reference-reel", id], info);
          setRefMusic(info.usesAudio ? info.name : null);
          if (info.usesAudio) addLine("Its music will be your song, from the same point, so the cuts match the original", "done");
          addLine(`Your Reel will follow it: ${info.shots} shots, ${info.hookSeconds ? `${info.hookSeconds.toFixed(1)} s hook` : "same hook"}`, "done");
          setRefFile(null);
        } catch (e) {
          addLine(`The reference Reel could not be used: ${errorMessage(e)}`, "warn");
          setRefError(errorMessage(e)); // shown on the card in step 1, so it is not missed
        }
      }
      if (files.length) {
        addLine(`Uploading ${files.length} clip${files.length === 1 ? "" : "s"}`);
        setStep("videos");
        setBar(0, "upload");
        const res = await api.uploadVideos(id, files.map((v) => v.file), (f) => setBar(f * 100));
        setVideos((cur) => cur.filter((v) => !files.includes(v)));
        for (const f of res.failed) addLine(`Skipped ${f.name}: ${f.error.message}`, "warn");
      }
      done.current.videos = true;
      await api.updateProject(id, { duration: seconds, sequence });
      const names = (await api.getProject(id)).videos.filter((v) => !v.purged).map((v) => v.name);
      setStep("checking");
      setBar(0, "analysis");
      const job = await api.analyze(id);
      let shown = -1;
      for (;;) {
        const j = await api.getJob(id, job.id);
        setBar(j.progress);
        const st = j.stages.find((x) => x.name === "analyzing_videos");
        if (st && st.status !== "completed" && names.length) {
          const k = Math.min(names.length - 1, Math.floor((st.progress / 100) * names.length));
          if (k !== shown) {
            shown = k;
            addLine(`Analysing clip ${k + 1} of ${names.length}: ${names[k]} (light, sharpness, motion, shake, faces, best moments)`);
          }
        }
        if (j.status === "completed") break;
        if (j.status === "failed" || j.status === "cancelled") throw Object.assign(new Error(j.error?.message ?? "The clip check failed."), { code: j.error?.code });
        await new Promise((r) => setTimeout(r, 1200));
      }
      addLine(`Checking the footage against a ${seconds}s Reel`);
      const fresh = await api.getProject(id);
      setProject(fresh);
      const verdict = clipCheck(fresh, seconds, sequence === "talk");
      for (const v of fresh.videos.filter((x) => !x.purged)) {
        const an = v.analysis;
        const res = resolutionNote(v);
        const words = [...(an?.flags ?? []).filter((f) => !(res && f === "low_resolution")).map((f) => FLAG_TEXT[f]?.text).filter(Boolean), ...(res ? [res.text] : [])];
        const bad = !!an && !an.usable;
        addLine(`${v.name}: ${an ? `quality ${Math.round(an.qualityScore * 100)}%` : "not analysed"}${words.length ? ` · ${words.join(" · ")}` : ""}${bad ? " · cannot be used" : ""}`,
          bad ? "error" : words.length ? "warn" : "done");
      }
      const f = verdict.footage;
      const lowRes = fresh.videos.filter((x) => !x.purged && resolutionNote(x)).length;
      const resNote = lowRes ? ` ⚠ ${lowRes} clip${lowRes === 1 ? " is" : "s are"} low resolution, so the Reel will look soft: the originals from your phone's camera give a sharp Reel.` : "";
      addLine(`About ${Math.round(f.footage)}s of good footage; a ${seconds}s Reel needs about ${Math.ceil(f.needed)}s${f.ok ? "" : ` (about ${Math.ceil(f.needed - f.footage)}s more, or the Reel would slow shots down and repeat moments)`}`, f.ok ? "done" : "error");
      if (verdict.passed && sequence === "talk") {
        finishLog(lowRes ? "problem" : "ok", `All checks passed: ${names.length} clip${names.length === 1 ? "" : "s"}. Their own voice is kept, so no song is needed.${resNote}`);
        setAudioMode("original");
        setStage("rest");
      } else if (verdict.passed) {
        finishLog(lowRes ? "problem" : "ok", `All checks passed: ${names.length} clip${names.length === 1 ? "" : "s"}, about ${Math.round(f.footage)}s of footage. Next: style and generate.${resNote}`);
        setStage("rest");
      } else {
        const parts = [verdict.blocked.length ? `${verdict.blocked.length} clip${verdict.blocked.length === 1 ? " cannot" : "s cannot"} be used (remove or replace)` : "",
          f.ok ? "" : `about ${Math.ceil(f.needed - f.footage)}s more good footage is needed (add clips, or make the Reel ${f.fits}s)`].filter(Boolean);
        finishLog("problem", `To continue: ${parts.join("; ")}.`);
        if (!f.ok) setGate(f);
      }
    } catch (err) {
      const msg = errorMessage(err);
      addLine(msg, "error");
      finishLog("error", "The check stopped. Fix the problem above and add the clips again, or try again.");
      setError({ message: msg, code: (err as { code?: string }).code });
    } finally {
      setStep("idle");
    }
  }

  async function removeClip(mediaId: string) {
    if (!project) return;
    try {
      await api.deleteVideo(project.id, mediaId);
      const fresh = await api.getProject(project.id);
      setProject(fresh);
      const verdict = clipCheck(fresh, duration, sequence === "talk");
      setGate(verdict.footage.ok ? null : verdict.footage);
      if (verdict.passed && stage === "clips") setStage("rest");
    } catch (err) {
      setError({ message: errorMessage(err), code: (err as { code?: string }).code });
    }
  }

  /** A new Reel length: the clips need no new analysis, only the footage check against the new length. */
  function changeDuration(d: number) {
    setDuration(d);
    setGate(null);
    if (!project) return;
    const verdict = clipCheck(project, d, sequence === "talk");
    if (!verdict.footage.ok) setGate(verdict.footage);
    if (!verdict.passed && stage === "rest") setStage("clips");
    setAudioStart(null); // the best song part depends on the length
  }

  /** Step 2: the song is uploaded and analysed right away, with a live log, and the app's choice of part is shown. */
  async function pickSong(file: File) {
    retry.current = () => void pickSong(file);
    setError(null);
    if (file.size > MAX_AUDIO_MB * 1024 * 1024) {
      setError({ message: `The song is larger than ${MAX_AUDIO_MB} MB (${Math.round(file.size / 1024 / 1024)} MB). Use an MP3 or a shorter file.`, code: "FILE_TOO_LARGE" });
      return;
    }
    setAudio(file);
    setAudioStart(null);
    setSongReady(false);
    startLog("Preparing your song");
    try {
      const id = await ensureProject();
      setSongProjectId(id);
      addLine("Uploading the song");
      setStep("audio");
      setBar(0, "song");
      await api.uploadAudio(id, file, (f) => setBar(f * 100));
      done.current.audio = true;
      setBar(null);
      addLine("Analysing the music: beats, key beats (where cuts go), hits, build-ups, breakdowns, drops and the song's parts");
      const map = await api.beatMap(id);
      qc.setQueryData(["beatMap", id], map);
      addLine(`${map.bpm} BPM · ${map.counts.major} key beats · ${map.counts.beat} beats · ${map.counts.bars} bars · ${map.counts.drops} drops · ${map.counts.rises} build-ups · ${map.counts.falls} breakdowns`);
      addLine("Song analysis (Essentia): beats, onsets, transients and events");
      const analysis = await api.songAnalysis(id);
      qc.setQueryData(["songAnalysis", id], analysis);
      addLine(analysis.status === "completed"
        ? `${analysis.tempo.bpm} BPM · ${analysis.beats.length} beats · ${analysis.sections.length} sections · ${analysis.candidate_events.length} events`
        : `Song analysis failed: ${analysis.errors.join("; ")}`);
      const parts = await api.songParts(id, duration, 6);
      qc.setQueryData(["songParts", id, duration], parts);
      addLine(`${parts.bpm} BPM · ${parts.parts.length} good part${parts.parts.length === 1 ? "" : "s"} found for a ${duration}s Reel`);
      const best = parts.parts[0];
      if (best) {
        addLine(`Best part: ${formatDuration(best.start)} – ${formatDuration(best.end)} (${best.reasons.join(", ")})`);
        setAudioStart(best.start);
      }
      finishLog("ok", "Explore the beat map below, then choose the Reel length.");
      setSongReady(true);
    } catch (err) {
      const msg = errorMessage(err);
      addLine(msg, "error");
      finishLog("error", "The song could not be prepared. Try another file.");
      setError({ message: msg, code: (err as { code?: string }).code });
    } finally {
      setStep("idle");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    if (stage !== "rest") return; // steps 1 and 2 come first
    if (!done.current.projectId) {
      // the gate: a Reel can only show as much real footage as the clips have (lengths unknown to the browser are not guessed)
      const lens = videos.map((v) => clipSeconds[v.key]);
      if (lens.every((s) => typeof s === "number")) {
        const check = checkFootage(lens, duration);
        if (!check.ok) {
          setGate(check);
          return;
        }
      }
    }
    setGate(null);
    try {
      const settings = { duration, style, pace, concept, sequence, ...(sequence === "steps" ? { teaser, stepLabels, orderMode } : {}), captions: FEATURES.captions && captions, captionStyle, ai: FEATURES.ai && ai, aiDirector, beatPlan: beatPlan && !!audio, cutEveryBeat: everyBeat, platform, ...(platform === "instagram" ? { exportPreset: "instagram_reel", hookText: hookText.trim(), ctaText: ctaText.trim() } : {}), minClip, autoReview, soundEffects, deleteMediaAfterRender: deleteMedia, audioMode, language, brief: brief.trim(), reference, ...(trendId ? { trendId } : {}), ...(audio && usesMusic && audioStart !== null ? { audioStart } : {}) };
      if (!done.current.projectId) {
        setStep("creating");
        const p = await api.createProject(name.trim() || "Untitled Reel", settings);
        done.current.projectId = p.id;
      } else {
        await api.updateProject(done.current.projectId, { ...(name.trim() ? { name: name.trim() } : {}), ...settings });
      }
      const id = done.current.projectId;
      if (!done.current.videos) {
        setStep("videos");
        setUploadPct(0);
        const res = await api.uploadVideos(id, videos.map((v) => v.file), setUploadPct);
        setVideos([]);
        if (res.failed.length) {
          const names = res.failed.map((f) => `${f.name}: ${f.error.message}`).join("; ");
          setNotice(`Some clips were skipped — ${names}`);
        }
        done.current.videos = true;
      }
      if (audio && !done.current.audio) {
        setStep("audio");
        setUploadPct(0);
        await api.uploadAudio(id, audio, setUploadPct);
        done.current.audio = true;
      }
      if (templateId && !done.current.template) {
        await api.applyTemplate(id, templateId);
        done.current.template = true;
      }
      if (brandId && !done.current.brand) {
        await api.applyBrand(id, brandId);
        done.current.brand = true;
      }
      setStep("starting");
      await api.generate(id);
      await qc.invalidateQueries({ queryKey: ["projects"] });
      router.push(`/projects/${id}`);
    } catch (err) {
      setError({ message: errorMessage(err), code: (err as { code?: string }).code });
      setStep("idle");
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-8" aria-label="Create Reel">
      {(chosenTemplate || chosenTrend) && (
        <div className="lux-card flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm">
          <p className="min-w-0">
            <span className="text-accent">✦</span>{" "}
            {chosenTemplate ? (
              <>
                Using template <span className="font-medium">{chosenTemplate.name}</span>
                <span className="text-muted"> · {chosenTemplate.duration}s · its style, pace and captions are set</span>
              </>
            ) : (
              <>
                Using trend <span className="font-medium">{chosenTrend?.trendName}</span>
                <span className="text-muted"> · {chosenTrend?.cutFrequency} cuts, {chosenTrend?.transitionStyle} transitions</span>
              </>
            )}
          </p>
          <button
            type="button"
            className="shrink-0 text-xs text-muted hover:text-accent"
            disabled={busy}
            onClick={() => {
              if (chosenTemplate) setTemplateId("");
              else setTrendId("");
            }}
          >
            Clear
          </button>
        </div>
      )}
      <Stepper
        current={stage}
        onOpen={(id) => setStage(id as Stage)}
        steps={[
          { id: "song", title: "Music", done: stage !== "song" && (songReady || !audio),
            summary: audio && beatMap ? `${audio.name} · ${beatMap.bpm} BPM` : !audio && refMusic ? "the reference Reel's music" : !audio && stage !== "song" ? "no music" : undefined },
          { id: "length", title: "Length", done: stage === "clips" || stage === "rest",
            summary: stage === "clips" || stage === "rest" ? `${duration}s${audio && audioStart !== null ? ` · ${formatDuration(audioStart)} – ${formatDuration(audioStart + duration)}` : ""}` : undefined },
          { id: "clips", title: "Clips", done: !!check?.passed,
            summary: check?.passed ? `${project?.videos.filter((v) => !v.purged).length} clips · ${Math.round(check.footage.footage)}s of footage` : undefined },
          { id: "rest", title: "Style & generate", done: false },
        ]}
      />

      {stage === "clips" && (<>

      {project ? (
        <ReferenceReel projectId={project.id} disabled={busy} initialError={refError} />
      ) : (
        <ReferencePicker file={refFile} onFile={(f) => { setRefFile(f); setRefError(null); }} disabled={busy}
          useMusic={refUseMusic} onUseMusic={setRefUseMusic} />
      )}

      <section ref={videosRef} className="space-y-3">
        <h2 className="text-sm font-medium">3 · Your clips</h2>
        <p className="text-xs text-muted">Add your clips: they are uploaded and checked right away (light, sharpness, shake, resolution, length).</p>
        <Dropzone
          label="Drag & drop your clips here"
          hint="MP4, MOV, M4V, WEBM, MKV, AVI · up to 500 MB each"
          accept={PICKER_VIDEO}
          multiple
          disabled={busy}
          validate={isVideoFile}
          onReject={(n) => setError({ message: `Unsupported video file: ${n.join(", ")}`, code: "UNSUPPORTED_MEDIA" })}
          onFiles={(picked) => {
            setError(null);
            const big = tooBig(picked, MAX_VIDEO_MB);
            if (big.length) setError({ message: `These clips are larger than ${MAX_VIDEO_MB} MB and were not added: ${big.join(", ")}. Shorten or compress them, then add them again.`, code: "FILE_TOO_LARGE" });
            const files = picked.filter((x) => x.size <= MAX_VIDEO_MB * 1024 * 1024);
            if (!files.length) return;
            const added = files.map((file) => ({ key: `v${++keySeq}`, file }));
            setVideos((cur) => [...cur, ...added]);
            setGate(null);
            backToClips();
            for (const v of added) readVideoSeconds(v.file).then((s) => setClipSeconds((m) => ({ ...m, [v.key]: s })));
            void checkClips(duration, added); // straight into the check: a popup shows every step
          }}
        />
        <VideoList items={videos} onChange={setVideos} disabled={busy} />
        <h3 className="pt-2 text-sm font-medium">How should the clips be used?</h3>
        <SequenceSelector value={sequence} onChange={setSequence} disabled={busy} />
        {sequence === "steps" && <StepOptions teaser={teaser} stepLabels={stepLabels} onTeaser={setTeaser} onStepLabels={setStepLabels} disabled={busy} />}
        {sequence === "steps" && (
          <>
            <h3 className="pt-1 text-sm font-medium">Clip order</h3>
            <OrderModeSelector value={orderMode} onChange={setOrderMode} disabled={busy} />
            <p className="text-xs text-muted">
              {orderMode === "auto"
                ? "Clips follow the time in their file names (WhatsApp and phone names work); otherwise the order of the list above."
                : "Drag a clip above to any position, or use its ↑ / ↓ buttons, to set the exact order (1, 2, 3, …)."}{" "}
              The Reel is as long as the steps need, up to the length you choose.
            </p>
          </>
        )}
      </section>


      {project && check && (
        <ClipCheckPanel project={project} result={check} onRemove={removeClip} busy={busy} />
      )}
      {gate && (
        <FootageGate
          check={gate}
          onAddClips={() => {
            setGate(null);
            videosRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          onShorten={(s) => {
            setDuration(s);
            setGate(null);
            void checkClips(s); // check again at the shorter length
          }}
          onClose={() => setGate(null)}
        />
      )}
      {stage === "clips" && (
        <button type="button" className={`${btnSecondary} w-fit`} disabled={busy} onClick={() => setStage("length")}>
          ‹ Back to length
        </button>
      )}
      {stage === "clips" && (videos.length > 0 || project) && !log && (
        <div className="space-y-2">
          <button type="button" className={btnSecondary} disabled={!canCheck} onClick={() => void checkClips()}>
            {busy ? "Working…" : "Check my clips again"}
          </button>
          <p className="text-xs text-muted">
            Step 3: your clips are uploaded and checked (light, sharpness, shake, resolution, length) against the Reel length. The
            check is done once; every Reel from these clips reuses it.
          </p>
          {busy && (
            <div aria-live="polite">
              <p className="mb-1 text-sm text-muted">{STEP_LABEL[step]}</p>
              {step === "videos" && <ProgressBar key="upload" value={uploadPct * 100} label="Upload progress" showEta />}
            </div>
          )}
        </div>
      )}

      </>)}

      {stage === "song" && (
      <section className="space-y-3">
        <section>
        <label htmlFor="project-name" className="mb-1.5 block text-sm font-medium">
          Project name <span className="font-normal text-muted">(optional: you can rename it later)</span>
        </label>
        <input
          id="project-name"
          value={name}
          maxLength={120}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Namora Luxury Reel"
          className="w-full rounded-xl border border-border bg-surface px-3 py-2 outline-none focus:border-accent"
        />
      </section>
        <h2 className="text-sm font-medium">
          1 · Music <span className="font-normal text-muted">(start here: every beat of the song is analysed, and the edit follows it)</span>
        </h2>
        {refMusic && !audio && (
          <Card className="space-y-1 border-accent/50">
            <p className="text-sm font-medium"><span className="text-accent">♪</span> Using the music from “{refMusic}”</p>
            <p className="text-xs text-muted">
              Same song from the same point as the part being copied, so every cut lands where the original&apos;s does. Add your own
              song below to use it instead.
            </p>
          </Card>
        )}
        {audio ? (
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{audio.name}</p>
                <p className="text-xs text-muted">{formatBytes(audio.size)}</p>
              </div>
              <button type="button" disabled={busy} className={btnSecondary} onClick={() => { setAudio(null); setAudioStart(null); setSongReady(false); }}>
                Remove music
              </button>
            </div>
            {songReady && beatMap && audioUrl ? (
              <div className="border-t border-border pt-4">
                <h3 className="mb-3 text-sm font-medium">Beat map: every beat, and the video effect it gets</h3>
                <BeatMap data={beatMap} src={audioUrl} />
              </div>
            ) : null}
            {songReady && songAnalysis && pid ? (
              <div className="border-t border-border pt-4">
                <SongAnalysis projectId={pid} data={songAnalysis} />
              </div>
            ) : !(songReady && beatMap && audioUrl) ? (
              <Spinner label="Analysing every beat of the song…" />
            ) : null}
          </Card>
        ) : (
          <Dropzone
            label="Drop your song here"
            hint="MP3, MPEG, WAV, M4A, AAC, OGG, OPUS, FLAC, AMR and more"
            accept={PICKER_AUDIO}
            disabled={busy}
            validate={isAudioFile}
            onReject={(n) => setError({ message: `Unsupported audio file: ${n.join(", ")}`, code: "UNSUPPORTED_MEDIA" })}
            onFiles={(files) => void pickSong(files[0])}
          />
        )}
        {!audio && (
          <SongPicker
            disabled={busy}
            onPick={(file) => void pickSong(file)}
          />
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={btnPrimary} disabled={busy || (!!audio && !songReady)} onClick={() => setStage("length")}>
            Next: Reel length
          </button>
          {!audio && !refMusic && (
            <button type="button" className="text-sm text-muted hover:underline" onClick={() => { setAudioMode("original"); setStage("length"); }}>
              Continue without music (use the clips&apos; own sound)
            </button>
          )}
        </div>
      </section>
      )}

      {stage === "length" && (
      <section className="space-y-4">
        <div className="space-y-3">
          <h2 className="text-sm font-medium">2 · Reel length</h2>
          <DurationSelector value={duration} onChange={changeDuration} disabled={busy} />
          <p className="text-xs text-muted">The part of the song is chosen to fit this length; your clips are then checked against it.</p>
        </div>
        {audio && usesMusic && songReady && pid && (
          <Card className="space-y-3">
            <h3 className="text-sm font-medium">The part of the song</h3>
            <SongPartPicker projectId={pid} file={audio} seconds={duration} value={audioStart} onChange={setAudioStart} />
          </Card>
        )}
        {audio && usesMusic && songReady && pid && (
          <Card className="space-y-3">
            <h3 className="text-sm font-medium">Where should cuts land?</h3>
            <div role="radiogroup" aria-label="Where should cuts land?" className="grid gap-2 sm:grid-cols-2">
              {CUT_ON.map((o) => (
                <button key={o.id} type="button" role="radio" aria-checked={everyBeat === o.every} disabled={busy} onClick={() => setEveryBeat(o.every)}
                  className={`rounded-xl border px-4 py-3 text-left ${everyBeat === o.every ? "border-accent bg-accent/15" : "border-border bg-surface hover:border-accent/50"}`}>
                  <span className="block text-sm font-medium">{o.label}</span>
                  <span className="block text-xs text-muted">{o.hint}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">Every cut gets a transition.</p>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={beatPlan} disabled={busy} onChange={(e) => setBeatPlan(e.target.checked)} />
              <span>
                <span className="font-medium">Follow the beat map exactly</span>
                <span className="block text-xs text-muted">
                  The cuts follow the plan below to the beat, with an impact on the drop, a fade-in and a hero shot that fades out.
                  Off: the AI director chooses the shots and timing itself, still cutting only where you chose above.
                </span>
              </span>
            </label>
            {everyBeat && (
              <label className="flex items-center gap-2 text-sm">
                <span className="font-medium">Shortest shot</span>
                <select className="rounded-lg border border-border bg-surface px-2 py-1 text-sm" value={minClip} disabled={busy}
                  onChange={(e) => setMinClip(Number(e.target.value) as MinClip)}>
                  <option value={0.25}>0.25 s (fastest)</option>
                  <option value={0.35}>0.35 s</option>
                  <option value={0.4}>0.40 s</option>
                  <option value={0.6}>0.60 s (calmer)</option>
                </select>
                <span className="text-xs text-muted">Beats faster than this are grouped: no cut is shorter.</span>
              </label>
            )}
            {beatPlan && planStart !== null && <ChosenPartPlan projectId={pid} start={planStart} seconds={duration} everyBeat={everyBeat} minClip={minClip} />}
          </Card>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={btnSecondary} disabled={busy} onClick={() => setStage("song")}>
            ‹ Back
          </button>
          <button type="button" className={btnPrimary} disabled={busy || (usesMusic && !!audio && audioStart === null)} onClick={() => setStage(check?.passed ? "rest" : "clips")}>
            Next: your clips
          </button>
          {usesMusic && audio && audioStart === null && <span className="text-xs text-muted">Choose a part of the song first (Use this part).</span>}
        </div>
      </section>
      )}

      {stage === "rest" && (<>
      <section className="space-y-3" aria-label="Social media">
        <h2 className="text-sm font-medium">Where will you post it?</h2>
        <div role="radiogroup" aria-label="Social media" className="grid gap-2 sm:grid-cols-2">
          {PLATFORMS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={platform === p.id} disabled={busy} onClick={() => setPlatform(p.id)}
              className={`rounded-xl border px-4 py-3 text-left ${platform === p.id ? "border-accent bg-accent/15" : "border-border bg-surface hover:border-accent/50"}`}>
              <span className="block text-sm font-medium">{p.label}</span>
              <span className="block text-xs text-muted">{p.hint}</span>
            </button>
          ))}
        </div>
        {platform === "instagram" && (
          <Card className="space-y-4">
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted" aria-label="What Instagram mode does">
              {INSTAGRAM_RULES.map((r) => <li key={r}>{r}</li>)}
            </ul>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Hook text <span className="font-normal text-muted">(recommended)</span></span>
                <input aria-label="Hook text" value={hookText} maxLength={66} disabled={busy} onChange={(e) => setHookText(e.target.value)}
                  placeholder="e.g. 3 mistakes every new runner makes" className="w-full rounded-xl border border-border bg-surface px-3 py-2 outline-none focus:border-accent" />
                <span className="mt-1 block text-xs text-muted">The first words on screen: a question or a promise. Short works best (up to 7 words); longer text wraps onto more lines. Marathi and Hindi work too.</span>
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Closing line <span className="font-normal text-muted">(optional)</span></span>
                <input aria-label="Closing line" value={ctaText} maxLength={66} disabled={busy} onChange={(e) => setCtaText(e.target.value)}
                  placeholder="e.g. Save this for your next run" className="w-full rounded-xl border border-border bg-surface px-3 py-2 outline-none focus:border-accent" />
                <span className="mt-1 block text-xs text-muted">Shown on the last 2 seconds.</span>
              </label>
            </div>
            <p className="text-xs text-muted">
              Tip: in the instructions below, say who the Reel is for and the one thing it shows. Reels made for a specific person get sent to them, and
              sends are what Instagram uses most to reach new people.
            </p>
          </Card>
        )}
      </section>

      <section className="space-y-3" aria-label="Creative direction">
        <h2 className="text-sm font-medium">Creative direction</h2>
        <div role="radiogroup" aria-label="Creative direction" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {DIRECTIONS.map((d) => (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={concept === d.id}
              disabled={busy}
              onClick={() => setConcept(d.id)}
              className={`rounded-2xl border p-4 text-left transition-all ${concept === d.id ? "border-accent bg-accent/10" : "border-border hover:border-accent/50"}`}
            >
              <span className="block font-display text-lg">{d.label}</span>
              <span className="mt-1 block text-xs text-muted">{d.blurb}</span>
            </button>
          ))}
        </div>
      </section>

      {project && <ReferenceStatus projectId={project.id} />}

      <section className="space-y-4" aria-label="Brand and instructions">
        {(brands.data?.length ?? 0) > 0 && (
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Brand <span className="font-normal text-muted">(optional)</span></span>
          <select aria-label="Brand" value={brandId} disabled={busy} onChange={(e) => setBrandId(e.target.value)} className={SELECT}>
            <option value="">None</option>
            {brands.data?.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </label>
        )}
        <div className="space-y-2">
          <label htmlFor="ai-instructions" className="block text-sm font-medium">
            Tell the AI what you want <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="ai-instructions"
            aria-label="Instructions for the AI"
            value={brief}
            maxLength={1000}
            rows={4}
            disabled={busy}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="e.g. Luxury gold necklace collection. Slow and elegant, lots of close-ups of the details, end on the full look. Add text: New Collection."
            aria-describedby="ai-instructions-count"
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 outline-none focus:border-accent"
          />
          <p id="ai-instructions-count" className={`text-right text-xs ${brief.length > 950 ? "text-warning" : "text-muted"}`}>
            {brief.length} / 1000
          </p>
          <div className="flex flex-wrap gap-2" aria-label="Instruction ideas">
            {INSTRUCTION_IDEAS.map((idea) => (
              <button
                key={idea}
                type="button"
                disabled={busy || brief.length + idea.length > 998}
                onClick={() => setBrief((b) => (b.trim() ? `${b.trim().replace(/[.,;]?$/, ".")} ${idea}` : idea))}
                className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:border-accent/50 hover:text-foreground disabled:opacity-50"
              >
                + {idea}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">
            The AI reads this together with your clips and song, and decides the style, pace, colour, shots, effects and text. After the
            Reel is made you can keep changing it with words.
          </p>
        </div>
      </section>

      {admin && learned.data && learned.data.length > 0 && (
        <section className="space-y-2">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Edit like</span>
            <select aria-label="Edit like" value={reference} disabled={busy} onChange={(e) => setReference(e.target.value)} className={SELECT}>
              <option value="auto">AI picks from my trends</option>
              {learned.data.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
              <option value="none">None (the AI decides freely)</option>
            </select>
          </label>
          <p className="text-xs text-muted">Your trends are learned from trending Reels you uploaded (My trends). The AI copies their rhythm and feel.</p>
        </section>
      )}

      <details className="group rounded-xl border border-border bg-surface/50 px-4 py-3">
        <summary className="cursor-pointer select-none text-sm font-medium">
          More options <span className="font-normal text-muted">(optional: captions, sound effects, privacy)</span>
        </summary>
        <div className="mt-4 space-y-8">
          <section className="grid gap-4 sm:grid-cols-2" aria-label="Reel setup">
        {admin && (<>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Start from a template <span className="font-normal text-muted">(optional)</span></span>
          <select
            aria-label="Template"
            value={templateId}
            disabled={busy}
            onChange={(e) => {
              setTemplateId(e.target.value);
              const t = templates.data?.find((x) => x.id === e.target.value);
              if (t) applyTemplate(t);
            }}
            className={SELECT}
          >
            <option value="">None</option>
            {templates.data?.map((t) => (
              <option key={t.id} value={t.id}>{t.favorite ? "★ " : ""}{t.name}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Audio</span>
          <select aria-label="Audio mode" value={audioMode} disabled={busy} onChange={(e) => setAudioMode(e.target.value as AudioModeId)} className={SELECT}>
            {AUDIO_MODES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          {(audioMode === "voice" || audioMode === "voice_music") && (
            <span className="mt-1 block text-xs text-muted">Write the script and generate the voice in the editor after the first render.</span>
          )}
        </label>
        </>)}
        {(admin || captions) && (
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">{admin ? "Language" : "Caption language"}</span>
          <select aria-label="Language" value={language} disabled={busy} onChange={(e) => setLanguage(e.target.value as Language)} className={SELECT}>
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </label>
        )}
          </section>

      {admin && (<>
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Pace</h2>
        <PaceSelector withAuto value={pace} onChange={setPace} disabled={busy} />
        <p className="text-xs text-muted">How quickly the edit cuts. &quot;AI decides&quot; follows your instructions and the music.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Style</h2>
        <StyleSelector value={style} onChange={setStyle} disabled={busy} />
      </section>
      </>)}

      {admin && trends.data && trends.data.length > 0 && (
        <section className="space-y-2">
          <label htmlFor="trend" className="block text-sm font-medium">
            Trend preset <span className="font-normal text-muted">(optional)</span>
          </label>
          <select
            id="trend"
            value={trendId}
            disabled={busy}
            onChange={(e) => {
              const id = e.target.value;
              setTrendId(id);
              const t = trends.data?.find((x) => x.id === id);
              if (t) {
                if ([15, 30, 60].includes(t.recommendedDuration)) setDuration(t.recommendedDuration);
                setCaptionStyle(t.captionStyle);
              }
            }}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 outline-none focus:border-accent sm:w-auto"
          >
            <option value="">None</option>
            {trends.data.map((t) => (
              <option key={t.id} value={t.id}>
                {t.trendName}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted">Overrides the style&apos;s cut pacing and transitions, and pre-fills duration and captions.</p>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        {[
          { id: "captions", label: "Captions", value: captions, set: setCaptions, on: FEATURES.captions, todo: "Not available yet (Phase 9)", hint: "" },
          {
            id: "ai",
            label: "AI assist",
            value: ai,
            set: setAi,
            on: FEATURES.ai,
            todo: "Not available yet (Phase 10)",
            hint: "Looks at every clip before choosing shots (which is good, what it shows, the best order) instead of guessing from file names. With a cloud AI (Gemini/OpenAI) this takes seconds; a local model can take a few minutes per clip — turn it off for a fast draft.",
          },
          {
            id: "aiDirector",
            label: "AI director",
            value: aiDirector,
            set: setAiDirector,
            on: FEATURES.ai && ai,
            todo: "Needs AI assist",
            hint: "The AI plans every shot — which moment, where to cut on the beat, effect, transition, text and colour — and the app checks every choice before editing. Off: the built-in editor cuts, the AI only helps.",
          },
          {
            id: "autoReview",
            label: "Quality reviewer",
            value: autoReview,
            set: setAutoReview,
            on: true,
            todo: "",
            hint: "Scores the edit like a creative director (hook, pacing, story, variety, beat, ending) and fixes what it can before rendering: up to 2 rounds, kept only when the score improves.",
          },
          {
            id: "soundEffects",
            label: "Sound effects",
            value: soundEffects,
            set: setSoundEffects,
            on: true,
            todo: "",
            hint: "A whoosh on moving transitions, a riser and impact on the drop, a pop when text appears. Made on this computer, mixed under the music.",
          },
          {
            id: "deleteMedia",
            label: "Delete my uploads after rendering",
            value: deleteMedia,
            set: setDeleteMedia,
            on: true,
            todo: "",
            hint: "Privacy: once the final Reel is made, your clips and music are deleted from this computer. The Reel stays; a new version needs a new upload.",
          },
        ].filter((t) => admin || !["ai", "aiDirector", "autoReview"].includes(t.id)).map((t) => (
          <label
            key={t.id}
            className={`flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 ${t.on ? "" : "opacity-60"}`}
          >
            <span>
              <span className="block text-sm font-medium">{t.label}</span>
              {!t.on ? <span className="block text-xs text-muted">{t.todo}</span> : t.value && t.hint ? <span className="block max-w-xs text-xs text-muted">{t.hint}</span> : null}
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={t.on && t.value}
              disabled={!t.on || busy}
              onChange={(e) => t.set(e.target.checked)}
              className="h-5 w-5 accent-[var(--accent)]"
            />
          </label>
        ))}
      </section>

      {FEATURES.captions && captions && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Caption style</h2>
          <div role="radiogroup" aria-label="Caption style" className="flex flex-wrap gap-2">
            {CAPTION_STYLES.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={captionStyle === c}
                disabled={busy}
                onClick={() => setCaptionStyle(c)}
                className={`rounded-full border px-3 py-1 text-sm capitalize ${
                  captionStyle === c ? "border-accent bg-accent/15" : "border-border text-muted hover:text-foreground"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">
            Captions transcribe the lyrics or speech in your music track (the first run downloads the speech model).
          </p>
        </section>
      )}
        </div>
      </details>

      </>)}

      {log && <TaskLog log={log} onClose={closeLog} onRetry={() => retry.current?.()} reviewLabel="Review" />}

      {notice && (
        <p role="status" className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          {notice}
        </p>
      )}
      {error && <ErrorBanner title="Could not create the Reel" message={error.message} code={error.code} />}

      <div className="space-y-3">
        {busy && (
          <div aria-live="polite">
            <p className="mb-1 text-sm text-muted">{STEP_LABEL[step]}</p>
            {(step === "videos" || step === "audio") && <ProgressBar value={uploadPct * 100} label="Upload progress" showEta />}
          </div>
        )}
        {stage === "rest" && (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={btnSecondary} disabled={busy} onClick={() => setStage("clips")}>
              ‹ Back
            </button>
            <button type="submit" disabled={!canSubmit} className={`${btnPrimary} w-full py-3 text-base sm:w-auto`}>
              {busy ? "Working…" : "✦ Generate Reel"}
            </button>
          </div>
        )}
        {stage === "rest" && !canSubmit && !busy && (
          <p className="text-xs text-muted">{needsMusic && !audio ? "Add a song in step 2 (or choose an audio mode without music) to continue." : "Add at least one clip in step 1 to continue."}</p>
        )}
      </div>
    </form>
  );
}

/** The cut plan for the chosen part of the song (Reel time, from 0:00). */
function ChosenPartPlan({ projectId, start, seconds, everyBeat, minClip }: { projectId: string; start: number; seconds: number; everyBeat: boolean; minClip: MinClip }) {
  const q = useQuery({ queryKey: ["beatPlan", projectId, start, seconds, everyBeat, minClip], queryFn: () => api.beatPlan(projectId, start, seconds, everyBeat, minClip), staleTime: Infinity });
  if (q.isLoading) return <Spinner label="Planning the cuts…" />;
  if (!q.data) return null;
  const cuts = q.data.rows.filter((r) => r.kind === "cut").length;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        Your {seconds}s Reel: {cuts} shots, cut on {everyBeat ? "every beat" : "the key beats"}, each with its transition. Times are from the start
        of the Reel; your clips are placed in the shots after you add them.
      </p>
      <PlanTable rows={q.data.rows} offset={start} />
    </div>
  );
}
