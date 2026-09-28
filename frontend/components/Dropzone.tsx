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
      className={`rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
        over ? "border-accent bg-accent/10" : "border-border bg-surface"
      } ${disabled ? "opacity-50" : ""}`}
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
      <label htmlFor={inputId} className="cursor-pointer">
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-1 block text-xs text-muted">{hint}</span>
        <span className="mt-3 inline-block rounded-xl border border-border bg-surface-2 px-3 py-1.5 text-sm hover:border-accent/60">
          Browse files
        </span>
      </label>
    </div>
  );
}
