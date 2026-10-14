"use client";

import { PageHeader } from "@/components/molecules";
import { SongsPage } from "@/components/organisms/Songs";

export default function Songs() {
  return (
    <>
      <PageHeader title="Songs" subtitle="Your song library: upload once and reuse, pick up new songs from a folder, or find free music by name or mood." />
      <SongsPage />
    </>
  );
}
