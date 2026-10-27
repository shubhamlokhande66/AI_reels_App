"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./editor.module.css";

const categories = ["Media", "Stickers", "Filters", "Style", "Shots", "Music", "Text", "Captions", "Background", "Layers", "Voice", "Motion"];
const tools = ["Transition", "Effect", "Speed", "Split", "Duplicate", "Freeze", "Other moment", "Volume", "Extract audio", "Crop", "Reverse", "Rotate", "Mirror", "Flip", "Fit", "Canvas", "Border", "Adjust", "Speed curve", "Stabilize", "Beauty", "Fade", "Mosaic", "Magnifier", "Slip", "Trim", "Reset", "Delete"];
const options: Record<string, string[]> = {
  Media: ["Your clips", "Upload media", "Recent", "Stock library"], Stickers: ["Trending", "Emoji", "Shapes", "Recently used"], Filters: ["Original", "Golden", "Warm film", "Soft fade", "Noir"], Style: ["Auto edit", "Smooth", "Fast cuts", "Cinematic"], Shots: ["Beat sync", "Even pacing", "Long moments", "Short cuts"], Music: ["Choose a song", "My library", "Trending", "Extracted audio"], Text: ["Title", "Subtitle", "Callout", "Brand text"], Captions: ["Auto captions", "Caption style", "Upload SRT", "Translate"], Background: ["Blur fill", "Solid color", "Gradient", "Image"], Layers: ["Add a layer", "Arrange", "Blend mode", "Opacity"], Voice: ["Record voice", "Voiceover", "Clean audio", "Text to speech"], Motion: ["Pan & zoom", "Smooth camera", "Tracking", "Keyframes"],
  Transition: ["None", "Fade", "Dissolve", "Swipe", "Zoom", "Blur", "Glitch"], Effect: ["None", "Film grain", "Soft glow", "Vintage", "VHS", "RGB split", "Light leak"], Speed: ["0.25×", "0.5×", "0.75×", "1×", "1.5×", "2×", "4×"], Split: ["At playhead", "Split in half", "Split into thirds"], Duplicate: ["Duplicate once", "Duplicate twice", "Copy to end"], Freeze: ["Current frame", "Choose a frame", "Freeze duration"], "Other moment": ["Find best moment", "Earlier moment", "Later moment", "Choose frame"], Volume: ["Mute", "25%", "50%", "75%", "100%", "150%"], "Extract audio": ["Extract audio", "Keep video sound", "Extract voice"], Crop: ["Original", "9:16 portrait", "1:1 square", "16:9 wide", "Free crop"], Reverse: ["Reverse clip", "Reverse selection", "Preview reverse"], Rotate: ["90° clockwise", "180°", "90° counter-clockwise"], Mirror: ["Horizontal mirror", "Vertical mirror"], Flip: ["Flip horizontal", "Flip vertical"], Fit: ["Fit", "Fill", "Stretch"], Canvas: ["9:16 Reel", "1:1 Square", "4:5 Portrait", "16:9 Landscape"], Border: ["No border", "Fine line", "Soft edge", "Film frame"], Adjust: ["Exposure", "Contrast", "Temperature", "Saturation", "Highlights"], "Speed curve": ["Montage", "Hero moment", "Bullet", "Smooth", "Custom curve"], Stabilize: ["Off", "Light", "Balanced", "Strong"], Beauty: ["Off", "Natural", "Soft", "Smooth"], Fade: ["Fade in", "Fade out", "Fade both", "No fade"], Mosaic: ["Pixel mosaic", "Soft blur", "Circle mask", "Custom area"], Magnifier: ["1.2×", "1.5×", "2×", "Choose area"], Slip: ["Earlier frames", "Later frames", "Center selection"], Trim: ["Trim start", "Trim end", "Fine trim"], Reset: ["Reset effects", "Reset framing", "Reset speed", "Reset all"], Delete: ["Keep this shot", "Remove shot"],
};
const paths: Record<string, string> = { Media: "M4 5h16v14H4zM8 15l3-3 2 2 2-3 3 4", Stickers: "M12 3a9 9 0 1 0 9 9h-6a3 3 0 0 1-3-3zM15 3v5h5", Filters: "M4 6h16M7 12h10M10 18h4", Style: "m12 3 2 6 6 3-6 2-2 7-2-7-6-2 6-3z", Shots: "M4 4h16v16H4zM8 4v16M16 4v16", Music: "M9 18V5l12-2v13M9 18a3 3 0 1 1-3-3", Text: "M4 6V4h16v2M12 4v16", Captions: "M4 5h16v14H4zM7 10h4M13 10h4M7 14h3", Background: "M4 6h16v12H4zM7 15l3-3 2 2 3-4", Layers: "m12 3 9 5-9 5-9-5zM3 12l9 5 9-5", Voice: "M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6M6 10v1a6 6 0 0 0 12 0v-1", Motion: "M4 12h4l2-7 4 14 2-7h4", Transition: "M4 6l7 6-7 6zM20 6l-7 6 7 6z", Effect: "m12 3 2 6 6 3-6 2-2 7-2-7-6-2 6-3z", Speed: "M12 3v9l6 3", Split: "M12 3v18M5 8l7 4 7-4M5 16l7-4 7 4", Duplicate: "M8 8h12v12H8zM4 16V4h12", Freeze: "M12 3v18M4 7l16 10M4 17 20 7", Volume: "M4 10v4h4l5 4V6l-5 4zM17 9a5 5 0 0 1 0 6", Crop: "M6 3v15a3 3 0 0 0 3 3h12M3 6h15a3 3 0 0 1 3 3", play: "M8 5v14l11-7z" };

function Glyph({ name, size = 18 }: { name: string; size?: number }) {
  const d = paths[name] ?? "m12 3 2 6 6 3-6 2-2 7-2-7-6-2 6-3z";
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

function Waveform({ compact = false }: { compact?: boolean }) {
  return <span className={styles.waveform} aria-hidden="true">{Array.from({ length: compact ? 48 : 100 }, (_, i) => <i key={i} style={{ height: `${18 + Math.abs(Math.sin(i * .41) * Math.cos(i * .13)) * 78}%` }} />)}</span>;
}

export function EditorPreview() {
  const [category, setCategory] = useState("Style");
  const [tool, setTool] = useState("Transition");
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [shot, setShot] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(100);
  useEffect(() => { if (!open) return; const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); }, [open]);
  const choices = open ? options[open] ?? [] : [];
  const pro = ["Background", "Layers", "Voice", "Motion"];
  return <main className={styles.editor}>
    <header className={styles.projectBar}><div className={styles.projectIdentity}><span className={styles.projectMark}><Glyph name="Shots" /></span><span className={styles.projectCopy}><small>REEL STUDIO <i /> INTERACTIVE PREVIEW</small><strong>Golden hour memories</strong></span></div><div className={styles.projectActions}><button className={styles.undoButton} aria-label="Undo">↶</button><button className={styles.undoButton} aria-label="Redo">↷</button><button className={styles.shareButton}><Glyph name="Transition" /> Share</button><button className={styles.exportButton}>Export <Glyph name="Transition" /></button></div></header>
    <div className={styles.workbench}><section className={styles.previewPanel}><div className={styles.previewHeader}><span><i /> PREVIEW</span><button>9:16 <span>⌄</span></button></div><div className={styles.previewStage}><div className={styles.videoFrame}><div className={styles.sceneSky}/><div className={styles.sceneSun}/><div className={styles.sceneCity}><i/><i/><i/><i/><i/></div><div className={styles.scenePerson}><i/><b/><span/></div><div className={styles.sceneCaption}>golden hour <span>✦</span></div><button className={styles.previewPlay} aria-label="Play preview" onClick={() => setPlaying(!playing)}><Glyph name={playing ? "Freeze" : "play"} size={20}/></button><div className={styles.frameCounter}>{String(shot + 1).padStart(2,"0")} / 08</div></div></div><div className={styles.transport}><span className={styles.timeCurrent}>00:04.8</span><span className={styles.timeDivider}>/</span><span className={styles.timeTotal}>00:29.6</span><button className={styles.transportSkip}>|◂</button><button className={styles.transportPlay} onClick={() => setPlaying(!playing)}><Glyph name={playing ? "Freeze" : "play"} size={16}/></button><button className={styles.transportSkip}>▸|</button><span className={styles.transportSpacer}/><span className={styles.soundState}><Glyph name="Music" size={14}/> SOUND ON</span></div><div className={styles.previewProgress}><i style={{width:"19%"}}/></div></section>
    <aside className={styles.inspector}><div className={styles.inspectorHead}><div><span className={styles.eyebrow}>CLIP CONTROLS</span><h2>Shot {String(shot + 1).padStart(2,"0")}</h2></div><span className={styles.durationPill}>10.7 s</span></div><div className={styles.shotToolGrid}>{tools.map((name) => <button key={name} className={`${styles.shotTool} ${tool === name ? styles.shotToolActive : ""} ${name === "Delete" ? styles.deleteTool : ""}`} onClick={() => {setTool(name);setOpen(name);}}><Glyph name={name}/><span>{name}</span></button>)}</div><div className={styles.activeToolNote}><i className={styles.noteDot}/> {tool} selected for Shot {String(shot + 1).padStart(2,"0")}</div></aside>
    </div>
    <section className={styles.timelineCard}><header className={styles.timelineHeader}><div className={styles.timelineTitle}><span className={styles.timelineIcon}><Glyph name="Shots"/></span><span><b>Timeline</b><small>8 clips · 5 layers</small></span></div><div className={styles.timelineActions}><span className={styles.timelineTime}>00:04.8 / 00:29.6</span><button onClick={() => setZoom(Math.max(50,zoom-10))}>−</button><span className={styles.zoomValue}>{zoom}%</span><button onClick={() => setZoom(Math.min(150,zoom+10))}>+</button><button className={styles.fitButton} onClick={() => setZoom(100)}>Fit</button></div></header><div className={styles.timelineScroll}><div className={styles.timelineCanvas}><div className={styles.rulerRow}><div className={styles.trackLabelSpacer}>TRACKS</div><div className={styles.ruler}>{["00:00","00:05","00:10","00:15","00:20","00:25","00:30"].map(x=><span key={x}>{x}</span>)}<i style={{left:"19%"}}/></div></div>{["Effects","Video","Text","Voice","Music"].map((name,i)=><div className={styles.trackRow} key={name}><div className={styles.trackLabel}><Glyph name={name === "Video" ? "Shots" : name === "Music" ? "Music" : name === "Text" ? "Text" : name === "Voice" ? "Voice" : "Effect"} size={14}/><span>{name}</span><button>+</button></div><div className={`${styles.trackContent} ${[styles.effectTrack,"",styles.textTrack,styles.voiceTrack,styles.musicTrack][i]}`}>{name === "Video" ? ["00:00","00:03","00:06","00:09","00:12","00:16","00:20","00:24"].map((time,j)=><button key={time} onClick={()=>setShot(j)} className={`${styles.videoClip} ${styles[`scene${j%4}`]} ${shot===j?styles.videoClipSelected:""}`} style={{flex:[1.05,1.1,.9,1.2,1.05,1.15,.9,1.2][j]}}><span className={styles.clipTime}>{time}</span><span className={styles.clipPlay}><Glyph name="play" size={10}/></span></button>) : name === "Effects" ? <><span className={styles.effectBlock} style={{left:"2%",width:"15%"}}>✦ Slow drift</span><span className={styles.effectBlock} style={{left:"22%",width:"18%"}}>✦ Zoom burst</span><span className={styles.effectBlock} style={{left:"48%",width:"14%"}}>✦ Film glow</span></> : name === "Text" ? <><span style={{left:"4%",width:"24%"}}>golden hour memories</span><span style={{left:"55%",width:"19%"}}>little moments ✦</span></> : name === "Voice" ? <div className={styles.voiceClip}><Waveform compact/></div> : <div className={styles.musicClip}><Waveform/><span>♫ Golden Hour — JVKE</span><i className={styles.beatOne}/><i className={styles.beatTwo}/><i className={styles.beatThree}/></div>}</div></div>)}<div className={styles.playhead} style={{left:"calc(126px + (100% - 126px) * .19)"}}><i/></div></div></div><footer className={styles.timelineFooter}><span><i/> All changes saved</span><span>Drag clips to rearrange · Select a shot to edit</span></footer></section>
    <nav className={styles.toolDock} aria-label="Editor tools">{categories.map((name)=> <button key={name} className={`${styles.categoryTool} ${category===name?styles.categoryActive:""}`} onClick={()=>{setCategory(name);setOpen(name);}}><Glyph name={name}/><span>{name}</span>{pro.includes(name)&&<i className={styles.proTag}>PRO</i>}</button>)}</nav>
    {open && typeof document !== "undefined" && createPortal(
      <div className={styles.sheetBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(null); }}>
        <section className={styles.optionSheet} role="dialog" aria-modal="true" aria-labelledby="tool-sheet-title">
          <div className={styles.sheetGrip} />
          <header className={styles.sheetHeader}>
            <div className={styles.sheetHeading}>
              <span className={styles.sheetIcon}><Glyph name={open} /></span>
              <span><small>{categories.includes(open) ? "EDITOR TOOL" : `SHOT ${String(shot + 1).padStart(2, "0")}`}</small><h2 id="tool-sheet-title">{open}</h2></span>
            </div>
            <button type="button" className={styles.sheetClose} aria-label="Close options" onClick={() => setOpen(null)}>×</button>
          </header>
          <p className={styles.sheetDescription}>Choose an option for your Reel. Your selection is ready to preview.</p>
          <div className={styles.optionGrid}>
            {choices.map((choice, index) => <button type="button" key={choice} className={`${styles.optionCard} ${(selected[open] ?? choices[0]) === choice ? styles.optionSelected : ""}`} aria-pressed={(selected[open] ?? choices[0]) === choice} onClick={() => setSelected((current) => ({ ...current, [open]: choice }))}>
              <span className={styles.optionPreview}>
                {open === "Transition" ? <span className={`${styles.transitionPreview} ${styles[`transition${index}`]}`}><i /><b>→</b><i /></span> : open === "Effect" || open === "Filters" ? <span className={`${styles.effectPreview} ${styles[`effect${index % 4}`]}`}><i /></span> : <Glyph name={open} />}
              </span>
              <span className={styles.optionLabel}>{choice}</span>
              {(selected[open] ?? choices[0]) === choice && <span className={styles.optionCheck}>✓</span>}
            </button>)}
          </div>
          <footer className={styles.sheetFooter}><span>Preview selection · Shot {String(shot + 1).padStart(2, "0")}</span><button type="button" className={styles.applyOption} onClick={() => setOpen(null)}>Done <Glyph name="Transition" size={15} /></button></footer>
        </section>
      </div>,
      document.body,
    )}
  </main>;
}
