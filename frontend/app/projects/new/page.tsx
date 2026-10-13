import { Suspense } from "react";
import { NewReel } from "@/components/molecules/NewReel";
import { PageHeader } from "@/components/molecules";

export const metadata = { title: "Create Reel · AI Reel Maker" };

export default function NewProjectPage() {
  return (
    <>
      <PageHeader title="Create Reel" subtitle="Make a Reel from your video clips, or direct one from product photos." />
      <Suspense>
        <NewReel />
      </Suspense>
    </>
  );
}
