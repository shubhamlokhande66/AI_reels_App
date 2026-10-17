"use client";

import { useId, useRef, useState } from "react";

interface Props {
  label: string;
  hint: string;
  accept: string;
  multiple?: boolean;
  /** Return true for files that should be kept; rejected names are reported via onReject. */
  validate: (file: File) => boolean;
  onFiles: (files: File[]) => void;
  onReject?: (names: string[]) => void;
  disabled?: boolean;
}

export function Dropzone({ label, hint, accept, multiple = false, validate, onFiles, onReject, disabled }: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function handle(list: FileList | null) {
    if (!list || disabled) return;
    const files = Array.from(list);
    const ok = files.filter(validate);
    const bad = files.filter((f) => !validate(f)).map((f) => f.name);
    if (bad.length) onReject?.(bad);
    if (ok.length) onFiles(multiple ? ok : ok.slice(0, 1));
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        handle(e.dataTransfer.files);
      }}
      className={`card items-center text-center transition-colors ${over ? "!border-[var(--accent)] !bg-[var(--chip-on)]" : ""} ${disabled ? "opacity-50" : ""}`}
      style={{ borderStyle: "dashed", borderWidth: 1.5 }}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => handle(e.target.files)}
      />
      <label htmlFor={inputId} className="flex cursor-pointer flex-col items-center gap-1.5">
        <b className="sm">{label}</b>
        <span className="mu xs">{hint}</span>
        <span className="btn sm mt-1.5">Choose files</span>
      </label>
    </div>
  );
}
